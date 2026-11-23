// 17.11.2026 (Konrad task_d4pdwppg, "Videos im Chat flüssig"): the light preview copy of heavy videos. A video whose probe says it is heavy – at least
// PREVIEW_LIMITS.minBytes and over ≈ 4 Mbit/s, or a short edge over 720 px at a bitrate a preview would shrink (shared/model/video-preview.ts
// previewVerdict) – and not longer than PREVIEW_LIMITS.maxDurationMs is queued; one at a time the host's preview window (host.media.preview, main/media-preview.ts)
// converts it to H.264/MP4 with its index in front, short edge ≤ 720 px, ≈ 2.5 Mbit/s, and this stores the file as a blob of its own and links it to the
// media row (`previewFileId`, event media.upserted): the players stream the copy, the original stays the download and the source of every other use.
// A video that needs none (small, light, long) gets its reason as state, so it is not asked again; one the host could not convert is 'failed' (not retried
// on its own); a host without windows, a closing app or a missing blob leaves the row undecided – the next start or arrival tries again.
// Owns: the decision, the queue, storing the copy and the row link. Never: converts anything itself, changes the original, throws out of the hook (it
// runs inside every upload), or lets the copy become a media row of its own (its hash is known before it is stored, `owns`).

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { MediaInfo } from '../../shared/model/media.ts';
import { previewVerdict } from '../../shared/model/video-preview.ts';
import type { RuntimeServices } from '../contracts.ts';
import { blobHere } from './dictation.ts';
import { MediaRepo } from './repo.ts';

/** Videos queued per start (the rest is left for the next). */
const AT_START = 200;

export interface PreviewMakerDeps {
  services: () => RuntimeServices;
  /** Announces a changed row (media.upserted). */
  emit: (info: MediaInfo) => void;
}

/** The sha256 of a file, streamed. */
async function hashOf(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 }) as AsyncIterable<Buffer>) hash.update(chunk);
  return hash.digest('hex');
}

/** A file name for the copy: the video's own name without its type, then "-preview.mp4" (webm). */
export function previewName(name: string, mime: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\p{L}\p{N} ._-]/gu, '_').trim().slice(0, 80) || 'video';
  return `${base}-preview.${mime === 'video/webm' ? 'webm' : 'mp4'}`;
}

export class PreviewMaker {
  private readonly deps: PreviewMakerDeps;
  private readonly queue = new Set<string>();
  /** Hashes of copies being stored right now: the media hook does not take them as media of their own. */
  private readonly storing = new Set<string>();
  private running?: Promise<void>;
  private scanAtStart = true;

  constructor(deps: PreviewMakerDeps) { this.deps = deps; }

  /** True while `fileId` is a preview copy being stored (media/service.ts onFileStored skips it). */
  owns(fileId: string): boolean {
    return this.storing.has(fileId);
  }

  /** Decides about one video row (after its probe, or when its facts came with the file): queued when heavy, else its reason is kept. */
  consider(fileId: string): void {
    try {
      const repo = new MediaRepo(this.deps.services().db);
      const info = repo.get(fileId);
      if (!info || info.kind !== 'video' || info.previewFileId || repo.previewState(fileId) === 'failed') return; // one that failed is not tried again on its own
      const verdict = previewVerdict({ size: info.size, width: info.width, height: info.height, durationMs: info.durationMs });
      if (verdict === 'unknown') return; // its probe is still to come
      if (verdict) { repo.setPreviewState(fileId, verdict); return; }
      if (typeof this.deps.services().host?.media?.preview !== 'function') return; // a host without windows: decided on a PC that has them
      this.queue.add(fileId);
      this.running ??= this.drain();
    } catch (error) {
      this.warn('video preview not considered', { id: fileId, error: String(error) });
    }
  }

  /** Once at start: the videos nobody has decided about yet (uploaded while no window existed, or before this feature). */
  queueStored(): void {
    if (!this.scanAtStart) return;
    this.scanAtStart = false;
    try {
      for (const id of new MediaRepo(this.deps.services().db).undecidedVideos(AT_START)) this.consider(id);
    } catch (error) {
      this.warn('waiting videos not queued', { error: String(error) });
    }
  }

  /** Resolves when nothing is queued or being made (tests, orderly shutdown). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve)); // let the upload finish first
    for (;;) {
      const next = this.queue.values().next();
      if (next.done) { this.running = undefined; return; }
      this.queue.delete(next.value);
      try {
        await this.make(next.value);
      } catch (error) {
        this.warn('video preview failed', { id: next.value, error: String(error) });
      }
    }
  }

  private async make(fileId: string): Promise<void> {
    const s = this.deps.services();
    const repo = new MediaRepo(s.db);
    const info = repo.get(fileId);
    const media = s.host?.media;
    if (!info || info.kind !== 'video' || info.previewFileId || !media?.preview || !s.files) return;
    if (!(await blobHere(s, fileId))) return; // stored on another PC and not pulled: its arrival asks again
    const started = Date.now();
    let made;
    try {
      made = await media.preview({ fileId, mime: info.mime });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'unavailable' || code === 'conflict') { this.warn('video preview not made now', { id: fileId, error: String(error) }); return; } // a closing app, a busy maker: undecided
      repo.setPreviewState(fileId, 'failed');
      this.warn('video preview not made', { id: fileId, error: String(error) });
      return;
    }
    try {
      const named = path.join(path.dirname(made.file), previewName(info.name, made.mime));
      await rename(made.file, named).catch(() => undefined);
      const file = (await exists(named)) ? named : made.file;
      const id = await hashOf(file);
      if (id === fileId) { repo.setPreviewState(fileId, 'light'); return; } // the same bytes: nothing was lightened
      // these bytes are a file of their own already: not linked, or removing the video would remove that file too
      if (s.db.get('SELECT 1 AS x FROM files WHERE id = ?', [id])) { repo.setPreviewState(fileId, 'shared'); return; }
      this.storing.add(id);
      try {
        const ref = await s.files.putPath(file, made.mime);
        if (repo.setPreview(fileId, ref.id, s.clock.now())) {
          const next = repo.get(fileId);
          if (next) this.deps.emit(next);
        }
        s.log.info('video preview made', { id: fileId, from: info.size, to: ref.size, width: made.width, height: made.height, ms: Date.now() - started });
      } finally {
        this.storing.delete(id);
      }
    } finally {
      await rm(made.file, { force: true }).catch(() => undefined); // the temp copy of main's folder, stored or not
      await rm(path.join(path.dirname(made.file), previewName(info.name, made.mime)), { force: true }).catch(() => undefined);
    }
  }

  private warn(message: string, data: Record<string, unknown>): void {
    try { this.deps.services().log.warn(message, data); } catch { /* never throw from the hook */ }
  }
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}
