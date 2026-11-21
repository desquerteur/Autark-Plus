// 17.11.2026 (Konrad task_d4pdwppg, "Videos im Chat flüssig"): the light preview copy of a stored video – its limits, the checked request
// of the host op media.preview, what the preview page is told (its spec), the size of the picture and its bitrate, and whether a video is
// heavy enough to need a copy at all (the runtime asks before it calls, runtime/media/preview.ts; main's page checks again).
// A preview is H.264 in MP4 with its index (moov) in front, the short edge at most 720 px (never scaled up), about 2.5 Mbit/s at 720×1280,
// at most 30 frames a second, the sound taken over as it is. The original stays as it is.
// Owns: these numbers and rules, shared by main (the preview window) and the runtime (when to ask). Never: reads a file, imports electron,
// or trusts a page's numbers unchecked.

import { WorkforceError } from '../errors.ts';

/**
 * Limits of `media.preview`: the picture's short edge, the video bitrate (target at 720×1280, floor and ceiling), the frame rate, the
 * longest video a copy is made of (the copy is built in memory), the smallest file that gets one, the bitrate above which a video counts as
 * heavy, the size of the pieces the page sends back, one job's time and the time without a sign of life, and jobs waiting behind the running one.
 */
export const PREVIEW_LIMITS = {
  shortEdge: 720, targetBitrate: 2_500_000, minBitrate: 800_000, maxBitrate: 3_000_000, maxFps: 30,
  maxDurationMs: 15 * 60_000, minBytes: 6 * 1024 * 1024, heavyBitrate: 4_000_000, chunkBytes: 1024 * 1024,
  jobMs: 40 * 60_000, stallMs: 90_000, waiting: 4, maxOutputBytes: 512 * 1024 * 1024,
} as const;

/** A finished copy: the temp file main wrote it to (the runtime stores it and removes the file), its size, picture, length and type. */
export interface VideoPreview {
  file: string;
  size: number;
  width: number;
  height: number;
  durationMs: number;
  mime: 'video/mp4' | 'video/webm';
}

const FILE_ID = /^[a-f0-9]{64}$/;
const VIDEO_MIME = /^video\/[a-z0-9][a-z0-9.+-]{0,63}$/i;

export interface PreviewRequest { fileId: string; mime?: string }

/** The host op's arguments, checked: a blob id and an optional video MIME type. */
export function previewRequest(input: { fileId?: unknown; mime?: unknown }): PreviewRequest {
  if (typeof input.fileId !== 'string' || !FILE_ID.test(input.fileId)) throw new WorkforceError('bad_request', 'A preview needs the id of a stored video.');
  if (input.mime !== undefined && (typeof input.mime !== 'string' || !VIDEO_MIME.test(input.mime))) throw new WorkforceError('bad_request', 'A preview is made of a video.');
  return { fileId: input.fileId, ...(typeof input.mime === 'string' ? { mime: input.mime.toLowerCase() } : {}) };
}

/** What the preview page is told: the numbers it works to (it never decides them from the file). */
export interface PreviewSpec {
  task: 'preview';
  shortEdge: number;
  targetBitrate: number;
  minBitrate: number;
  maxBitrate: number;
  maxFps: number;
  maxDurationMs: number;
  chunkBytes: number;
  size: number;
  mime: string;
}

export function previewSpec(size: number, mime: string): PreviewSpec {
  return {
    task: 'preview', shortEdge: PREVIEW_LIMITS.shortEdge, targetBitrate: PREVIEW_LIMITS.targetBitrate, minBitrate: PREVIEW_LIMITS.minBitrate,
    maxBitrate: PREVIEW_LIMITS.maxBitrate, maxFps: PREVIEW_LIMITS.maxFps, maxDurationMs: PREVIEW_LIMITS.maxDurationMs, chunkBytes: PREVIEW_LIMITS.chunkBytes, size, mime,
  };
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** The preview's picture size: the short edge at most `shortEdge`, the aspect kept, both edges even (H.264 needs it); never larger than the source. */
export function previewSize(width: number, height: number, shortEdge: number = PREVIEW_LIMITS.shortEdge): { width: number; height: number } {
  const short = Math.min(width, height);
  const scale = short > shortEdge ? shortEdge / short : 1;
  return { width: even(width * scale), height: even(height * scale) };
}

/** The preview's video bitrate: the target at 720×1280, by the number of pixels for other sizes, kept between the minimum and the maximum. */
export function previewBitrate(width: number, height: number): number {
  const scaled = PREVIEW_LIMITS.targetBitrate * ((width * height) / (720 * 1280));
  return Math.round(Math.min(PREVIEW_LIMITS.maxBitrate, Math.max(PREVIEW_LIMITS.minBitrate, scaled)));
}

/** Facts of a stored video the runtime knows from its probe (media/probe-container.ts). */
export interface VideoFacts { size?: number; width?: number; height?: number; durationMs?: number }

/**
 * Whether a video needs a copy: undefined = yes; otherwise why not – 'small' (too little to matter), 'light' (already about as light as
 * a preview would be), 'long' (the copy is built in memory: videos over PREVIEW_LIMITS.maxDurationMs get none), 'unknown' (no length yet).
 */
export function previewVerdict(facts: VideoFacts): 'small' | 'light' | 'long' | 'unknown' | undefined {
  if ((facts.size ?? 0) < PREVIEW_LIMITS.minBytes) return 'small';
  if (!facts.durationMs || facts.durationMs <= 0) return 'unknown';
  if (facts.durationMs > PREVIEW_LIMITS.maxDurationMs) return 'long';
  const bitrate = ((facts.size ?? 0) * 8) / (facts.durationMs / 1000);
  const bigPicture = Math.min(facts.width ?? 0, facts.height ?? 0) > PREVIEW_LIMITS.shortEdge;
  return bitrate > PREVIEW_LIMITS.heavyBitrate || (bigPicture && bitrate > PREVIEW_LIMITS.targetBitrate * 1.3) ? undefined : 'light';
}
