// 17.11.2026 (Konrad task_d4pdwppg, "Videos im Chat flüssig"): the light preview copy of stored videos (host op media.preview). An on-demand hidden
// window of its own (sandboxed, no preload, strict CSP, a private in-memory session that reaches nothing but the preview routes – the same
// window rules as the media analyzer, media-analyzer-window.ts, but its own session and queue, so a long conversion never holds up a keyframe or a
// sound job) loads src/main/preview/page.ts: it reads the job's blob with ranges, converts it with the browser's own codecs (WebCodecs, mediabunny) to
// H.264 in MP4 with its index in front, the short edge at most 720 px, about 2.5 Mbit/s (shared/model/video-preview.ts), and posts the copy back in
// pieces into a temp file in main's own folder. One job at a time, at most PREVIEW_LIMITS.waiting waiting; a job ends after PREVIEW_LIMITS.jobMs or
// after PREVIEW_LIMITS.stallMs without a sign of life; the window is reused while jobs follow and destroyed after 60 s idle, and at once after a
// timeout, a crash, a failed job or on quit.
// Owns: the job queue, the job timers, the window's lifetime and the temp folder (old leftovers are swept at the first job).
// Never: imports electron values, keeps a blob open after its job, keeps a window without a job longer than the idle time, or deletes a finished copy
// (the runtime stores it and removes the file).

import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { WorkforceError } from '../shared/errors.ts';
import { PREVIEW_LIMITS, previewRequest } from '../shared/model/video-preview.ts';
import type { PreviewRequest, VideoPreview } from '../shared/model/video-preview.ts';
import type { AnalyzerWindow, Serve } from './media-analyzer.ts';
import { newPreviewJob, PREVIEW_ORIGIN, servePreview } from './media-preview-routes.ts';
import type { PreviewJob } from './media-preview-routes.ts';
import { blobPath } from './protocols/rules.ts';

export const PREVIEW_IDLE_MS = 60_000;
/** A copy nobody took (the runtime ended before it did) is swept after this. */
const LEFTOVER_MS = 6 * 60 * 60_000;

export interface MediaPreviewDeps {
  /** A fresh hidden window whose session answers every request with `serve`. */
  open(serve: Serve): AnalyzerWindow;
  blobsDir: string; // the runtime's content-addressed store: <blobs>/ab/cd/<sha256>
  /** Main's own folder for the copies being written (made when needed). */
  dir: string;
  /** The page script's text (app/media-preview-page.js). */
  script(): string;
  /** One job's time and the time without a sign of life (tests); default PREVIEW_LIMITS. */
  timeoutMs?: number;
  stallMs?: number;
  idleMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export class MediaPreview {
  /** Answers the private session's requests (wf-file://media-preview/…). */
  readonly serve: Serve = (request) => servePreview(request, this.job, this.deps.script);
  private readonly deps: MediaPreviewDeps;
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private nextJob = 1;
  private job: PreviewJob | null = null;
  private window: AnalyzerWindow | null = null;
  private idle: unknown = null;
  private disposed = false;
  private swept = false;

  constructor(deps: MediaPreviewDeps) {
    this.deps = deps;
  }

  /** The preview copy of a stored video, queued behind a running job. Throws bad_request, conflict, not_found, timeout, unavailable. */
  preview(input: { fileId?: unknown; mime?: unknown }): Promise<VideoPreview> {
    let request: PreviewRequest;
    try { request = previewRequest(input); } catch (error) { return Promise.reject(error); }
    if (this.disposed) return Promise.reject(new WorkforceError('unavailable', 'The app is closing.'));
    // pending = the job that runs + those waiting behind it, so at most PREVIEW_LIMITS.waiting wait
    if (this.pending > PREVIEW_LIMITS.waiting) return Promise.reject(new WorkforceError('conflict', 'Several previews are being made already. Try again later.'));
    this.pending++;
    const run = this.chain.then(() => this.runOne(request));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** True while the hidden window exists (tests, the live check). */
  get windowOpen(): boolean {
    return this.window !== null;
  }

  /** Quit: the running job fails, the window goes. */
  dispose(): void {
    this.disposed = true;
    this.cancelIdle();
    this.job?.finish(new WorkforceError('unavailable', 'The app is closing.'));
    this.closeWindow();
  }

  private async runOne(request: PreviewRequest): Promise<VideoPreview> {
    this.cancelIdle();
    let out = '';
    let ok = false;
    try {
      if (this.disposed) throw new WorkforceError('unavailable', 'The app is closing.');
      const file = blobPath(this.deps.blobsDir, request.fileId);
      const size = await fileSize(file);
      if (size === null) throw new WorkforceError('not_found', 'The video is not in the file store on this PC.');
      await this.prepareDir();
      out = path.join(this.deps.dir, `preview-${randomBytes(8).toString('hex')}.tmp`);
      const handle = await open(out, 'w+'); // read too: the copy's first bytes are checked at the end
      if (this.disposed) { await handle.close().catch(() => undefined); throw new WorkforceError('unavailable', 'The app is closing.'); } // quit while the file was being made ready
      let stall: unknown = null;
      let job: PreviewJob | null = null;
      const arm = () => {
        if (stall !== null) this.clearTimer(stall);
        stall = this.setTimer(() => job?.finish(new WorkforceError('timeout', `The preview made no progress for ${Math.round((this.deps.stallMs ?? PREVIEW_LIMITS.stallMs) / 1000)} s.`)), this.deps.stallMs ?? PREVIEW_LIMITS.stallMs);
      };
      job = newPreviewJob(this.nextJob++, file, size, request.mime ?? 'video/mp4', out, handle, arm);
      this.job = job;
      const ms = this.deps.timeoutMs ?? PREVIEW_LIMITS.jobMs;
      const limit = this.setTimer(() => job?.finish(new WorkforceError('timeout', `Making the preview took longer than ${Math.round(ms / 60_000)} minutes.`)), ms);
      arm();
      try {
        const window = this.windowFor();
        window.load(`${PREVIEW_ORIGIN}/job/${job.id}/`).catch(() => job?.finish(new WorkforceError('unavailable', 'The preview maker did not start.')));
        const result = await job.done;
        ok = true;
        return result;
      } catch (error) {
        this.closeWindow(); // after a timeout, a crash or a failure the next job starts in a fresh window
        throw error;
      } finally {
        this.clearTimer(limit);
        if (stall !== null) this.clearTimer(stall);
        if (this.job === job) this.job = null;
        for (const stream of job.streams) stream.destroy();
        await job.handle.close().catch(() => undefined);
      }
    } finally {
      if (!ok && out) await rm(out, { force: true }).catch(() => undefined); // a failed job leaves no half copy
      this.pending--;
      this.scheduleIdle();
    }
  }

  private async prepareDir(): Promise<void> {
    await mkdir(this.deps.dir, { recursive: true });
    if (this.swept) return;
    this.swept = true;
    const now = Date.now();
    for (const name of await readdir(this.deps.dir).catch(() => [] as string[])) {
      if (!/^preview-[0-9a-f]{16}\.tmp$/.test(name)) continue;
      const file = path.join(this.deps.dir, name);
      const info = await stat(file).catch(() => null);
      if (info && now - info.mtimeMs > LEFTOVER_MS) await rm(file, { force: true }).catch(() => undefined);
    }
  }

  private windowFor(): AnalyzerWindow {
    if (this.window) return this.window;
    let window: AnalyzerWindow;
    try { window = this.deps.open(this.serve); } catch {
      throw new WorkforceError('unavailable', 'The preview maker could not be opened.');
    }
    this.window = window;
    window.onGone(() => {
      if (this.window !== window) return;
      this.closeWindow(); // a crashed renderer leaves its hidden window behind otherwise
      this.job?.finish(new WorkforceError('unavailable', 'The preview maker stopped; the file may be damaged or too large for the memory left.'));
    });
    return window;
  }

  private closeWindow(): void {
    const window = this.window;
    this.window = null;
    try { window?.destroy(); } catch { /* already gone */ }
  }

  private scheduleIdle(): void {
    if (this.pending > 0 || !this.window || this.disposed) return;
    this.cancelIdle();
    this.idle = this.setTimer(() => {
      this.idle = null;
      if (this.pending === 0) this.closeWindow();
    }, this.deps.idleMs ?? PREVIEW_IDLE_MS);
  }

  private cancelIdle(): void {
    if (this.idle === null) return;
    this.clearTimer(this.idle);
    this.idle = null;
  }

  private setTimer(fn: () => void, ms: number): unknown {
    if (this.deps.setTimer) return this.deps.setTimer(fn, ms);
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return handle;
  }

  private clearTimer(handle: unknown): void {
    if (this.deps.clearTimer) this.deps.clearTimer(handle);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

async function fileSize(file: string): Promise<number | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}
