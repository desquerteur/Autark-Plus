// One opened team letter as an inbox item (B-055 Q2; split from inbox.ts 16.11.2026): a letter is untrusted input,
// so every field is checked and bounded again, images and recordings must be what their type says (magic bytes), and
// whatever does not fit is dropped – never the whole report for a bad attachment.
// 16.11.2026: also where it was written (`client`), the sending company's folder (`company`), the writing device's own
// diagnostics, whether the text was dictated, and up to FEEDBACK_AUDIO_MAX recorded takes (WebM / MP4).
// Owns: that check and the file name of a recorded take. Never: reads or writes files, opens a letter.

import type { FeedbackKind } from '../../shared/model/system.ts';
import {
  FEEDBACK_AUDIO_EXT, FEEDBACK_AUDIO_MAX, FEEDBACK_AUDIO_TYPES, FEEDBACK_CLIENT_DIAGNOSTICS_MAX, FEEDBACK_CLIENT_MAX, FEEDBACK_IMAGE_TYPES,
  type FeedbackAudioType, type FeedbackImageType, type FeedbackInboxItem,
} from '../../shared/model/feedback-delivery.ts';

const KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'change', 'praise'];

/** The image really is what its type says. */
export function imageMatches(mime: FeedbackImageType, bytes: Buffer): boolean {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
}

/** The recording's container by its magic bytes: EBML (WebM) or an ISO box 'ftyp' (MP4); undefined for anything else. */
export function audioType(bytes: Uint8Array): FeedbackAudioType | undefined {
  if (bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (bytes.length > 12 && Buffer.from(bytes.subarray(4, 8)).toString('latin1') === 'ftyp') return 'audio/mp4';
  return undefined;
}

/** Take `n` (1-based) of report `id` beside its JSON. */
export const audioFile = (id: string, n: number, mime: FeedbackAudioType): string => `${id}.a${n}.${FEEDBACK_AUDIO_EXT[mime]}`;

const str = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined);

/** An opened letter as an inbox item, its screenshot and recordings apart; undefined when it is no v1 report. */
export function itemOf(id: string, value: unknown, receivedAt: number): { item: FeedbackInboxItem; image?: Buffer; audio?: Buffer[] } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const text = str(o.text, 20_000);
  if (o.v !== 1 || !text) return undefined;
  const item: FeedbackInboxItem = {
    id, receivedAt, text,
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : receivedAt,
    appVersion: str(o.appVersion, 120) ?? '', os: str(o.os, 120) ?? '',
  };
  if (KINDS.includes(o.kind as FeedbackKind)) item.kind = o.kind as FeedbackKind;
  const view = str(o.view, 120);
  if (view) item.view = view;
  if (o.fromAgent === true) item.fromAgent = true;
  const client = str(o.client, FEEDBACK_CLIENT_MAX)?.replace(/\s+/g, ' ');
  if (client) item.client = client;
  const company = str(o.company, 64);
  if (company && /^[a-z0-9][a-z0-9-]*$/.test(company)) item.company = company;
  if (o.dictated === true) item.dictated = true;
  const diagnostics = str(o.diagnostics, 12_000);
  if (diagnostics) item.diagnostics = diagnostics;
  const clientDiagnostics = str(o.clientDiagnostics, FEEDBACK_CLIENT_DIAGNOSTICS_MAX);
  if (clientDiagnostics) item.clientDiagnostics = clientDiagnostics;
  const opened: { item: FeedbackInboxItem; image?: Buffer; audio?: Buffer[] } = { item };
  const shot = o.screenshot as { mime?: unknown; base64?: unknown } | undefined;
  if (shot && (FEEDBACK_IMAGE_TYPES as readonly unknown[]).includes(shot.mime) && typeof shot.base64 === 'string') {
    const image = Buffer.from(shot.base64, 'base64');
    if (image.length && imageMatches(shot.mime as FeedbackImageType, image)) {
      item.screenshot = { mime: shot.mime as FeedbackImageType, size: image.length };
      opened.image = image;
    }
  }
  const takes = Array.isArray(o.audio) ? o.audio.slice(0, FEEDBACK_AUDIO_MAX) as Array<{ mime?: unknown; base64?: unknown } | null> : [];
  const audio: Buffer[] = [];
  const stored: NonNullable<FeedbackInboxItem['audio']> = [];
  for (const take of takes) {
    if (!take || !(FEEDBACK_AUDIO_TYPES as readonly unknown[]).includes(take.mime) || typeof take.base64 !== 'string') continue;
    const bytes = Buffer.from(take.base64, 'base64');
    if (audioType(bytes) !== take.mime) continue; // the bytes must be the container the letter claims
    const mime = take.mime as FeedbackAudioType;
    audio.push(bytes);
    stored.push({ mime, size: bytes.length, file: audioFile(id, audio.length, mime) });
  }
  if (audio.length) { item.audio = stored; opened.audio = audio; }
  return opened;
}
