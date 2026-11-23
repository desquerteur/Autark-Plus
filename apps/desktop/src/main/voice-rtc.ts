// Owner 07.11.2026: the host side of the voice.rtc* ops – a dictation heard by the person's Codex plan over WebRTC
// (runtime/voice/codex-hear.ts runs the Codex side). WebRTC exists only in Chromium, so one hidden window of its own
// (voice-rtc-window.ts: a private in-memory session apart from the media analyzer's, whose rule "only its own origin"
// stays as it is) runs the page (voice-rtc-page.ts). The take is decoded by the media analyzer first (media.audio's
// decode, 16 kHz mono PCM16, at most RTC_LIMITS.maxMs – a longer take is refused). Then:
//   voice.rtcOffer  → the window opens, its page builds the peer connection and posts its offer → {jobId, sdp, durationMs}
//   voice.rtcAnswer → the server's answer goes to the page's long-poll; resolves when the page says the take was sent
//                     (connect + lead + the take in real time + tail, within a timer of that length plus a margin)
//   voice.rtcClose  → the window goes (the connection with it); B-082: answers the voice's own session meter as the
//                     page saw it last (route 'usage': usage.audio_duration_ms of session.usage.updated, a number only)
//                     and windowMs, the connection's own time from the server's answer to this close (the meter
//                     updates only about every 15 s, so sessionMs stays below what the session was open).
// One job at a time (another one is 'conflict'); a job without its answer after RTC_LIMITS.answerMs, a page failure,
// a crash or a timeout ends it and destroys the window. The page's HTTP reaches only wf-file://voice-rtc (session
// rule and CSP); its peer connection reaches the far side named in the answer – the realtime endpoint Codex's own
// server negotiated – and nothing else is sent: the take into the track, never a speaker.
// Owns: the job, the op arguments' checks, the routes and their limits. Never: imports electron values, trusts the
// page's posts unchecked, keeps the take or the window after the job.

import { RTC_LIMITS } from '../shared/api/host-bridge.ts';
import type { DecodedAudio, HostOps } from '../shared/api/host-bridge.ts';
import { WorkforceError } from '../shared/errors.ts';
import { audioRequest, type AudioRequest } from './media-audio.ts';
import { RTC_CSP, RTC_HTML, RTC_SCRIPT, type RtcPageSpec } from './voice-rtc-page.ts';

const HOST = 'voice-rtc';
export const RTC_ORIGIN = `wf-file://${HOST}`;
const ROUTE = /^\/job\/(\d{1,9})\/(spec|pcm|offer|answer|sent|usage|fail)?$/;
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
const GATHER_MS = 5_000;
const MARGIN_MS = 10_000;

const FAILURES: Record<string, string> = {
  decode: 'The recording could not be prepared for the plan\'s voice.',
  offer: 'The voice connection could not be prepared.',
  connect: 'The voice connection to the plan did not open.',
  send: 'The voice connection dropped while the recording was sent.',
};

type Result<O extends keyof HostOps> = HostOps[O]['result'];

/** The hidden voice window (Electron in the app, a fake in tests). */
export interface RtcWindow { load(url: string): Promise<void>; onGone(listener: () => void): void; destroy(): void }
export type RtcServe = (request: Request) => Promise<Response>;

export interface VoiceRtcDeps {
  /** A fresh hidden window whose session answers every request with `serve`. */
  open(serve: RtcServe): RtcWindow;
  /** The take as 16 kHz mono PCM16 (the media analyzer's decode). */
  decode(request: AudioRequest): Promise<DecodedAudio>;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  now?(): number;
}

const bad = (message: string) => new WorkforceError('bad_request', message);

/** voice.rtcOffer's arguments: a blob id and an audio/video MIME type or none (media-audio.ts audioRequest), the whole take up to RTC_LIMITS.maxMs. */
export function rtcOfferRequest(args: { fileId?: unknown; mime?: unknown }): AudioRequest {
  return audioRequest({ fileId: args.fileId, mime: args.mime, startMs: 0, maxMs: RTC_LIMITS.maxMs });
}

/** voice.rtcAnswer's arguments: a job id and an SDP answer of at most RTC_LIMITS.sdpChars. */
export function rtcAnswerRequest(args: { jobId?: unknown; sdp?: unknown }): { jobId: number; sdp: string } {
  if (!Number.isSafeInteger(args.jobId) || (args.jobId as number) < 1) throw bad('Invalid voice job.');
  if (typeof args.sdp !== 'string' || !args.sdp.startsWith('v=0') || args.sdp.length > RTC_LIMITS.sdpChars || args.sdp.includes('\0')) throw bad('Invalid SDP answer.');
  return { jobId: args.jobId as number, sdp: args.sdp };
}

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: WorkforceError): void }
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: WorkforceError) => void = () => {};
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  promise.catch(() => undefined); // a job that ends before anyone waits is no unhandled rejection
  return { promise, resolve, reject };
}

interface RtcJob {
  id: number; pcm: Uint8Array; durationMs: number; window: RtcWindow | null; timer: unknown; ended: boolean; sessionMs?: number; answeredAt?: number;
  offer: Deferred<string>; answer: Deferred<string>; sent: Deferred<number>; offered: boolean; answered: boolean;
}

export class VoiceRtc {
  readonly serve: RtcServe = (request) => this.route(request);
  private readonly deps: VoiceRtcDeps;
  private job: RtcJob | null = null;
  private busy = false;
  private next = 1;

  constructor(deps: VoiceRtcDeps) { this.deps = deps; }

  async offer(args: { fileId?: unknown; mime?: unknown }): Promise<Result<'voice.rtcOffer'>> {
    const request = rtcOfferRequest(args);
    if (this.busy || this.job) throw new WorkforceError('conflict', 'A dictation is being heard by the plan already.');
    this.busy = true;
    try {
      const decoded = await this.deps.decode(request);
      if (decoded.partial) throw bad(`Dictations over ${Math.round(RTC_LIMITS.maxMs / 60_000)} minutes are not sent to the plan's voice.`);
      if (!decoded.pcm.byteLength) throw bad('The recording has no sound.');
      const job: RtcJob = {
        id: this.next++, pcm: decoded.pcm, durationMs: decoded.durationMs, window: null, timer: null, ended: false,
        offer: deferred(), answer: deferred(), sent: deferred(), offered: false, answered: false,
      };
      this.job = job;
      this.arm(job, RTC_LIMITS.offerMs, 'The voice connection could not be prepared in time.');
      try {
        const window = this.deps.open(this.serve);
        job.window = window;
        window.onGone(() => this.end(job, new WorkforceError('unavailable', 'The voice window stopped.')));
        window.load(`${RTC_ORIGIN}/job/${job.id}/`).catch(() => this.end(job, new WorkforceError('unavailable', 'The voice window did not start.')));
      } catch {
        this.end(job, new WorkforceError('unavailable', 'The voice window could not be opened.'));
      }
      const sdp = await job.offer.promise;
      this.arm(job, RTC_LIMITS.answerMs, 'The voice connection got no answer in time.');
      return { jobId: job.id, sdp, durationMs: job.durationMs };
    } catch (error) {
      if (this.job) this.end(this.job, error instanceof WorkforceError ? error : new WorkforceError('unavailable', FAILURES.offer));
      throw error;
    } finally { this.busy = false; }
  }

  async answer(args: { jobId?: unknown; sdp?: unknown }): Promise<Result<'voice.rtcAnswer'>> {
    const { jobId, sdp } = rtcAnswerRequest(args);
    const job = this.job;
    if (!job || job.id !== jobId || job.ended || !job.offered) throw new WorkforceError('not_found', 'This voice job is not running.');
    if (job.answered) throw new WorkforceError('conflict', 'This voice job has its answer already.');
    job.answered = true;
    job.answeredAt = (this.deps.now ?? Date.now)(); // the connection – the billed session – starts with the server's answer
    this.arm(job, RTC_LIMITS.connectMs + RTC_LIMITS.leadMs + job.durationMs + RTC_LIMITS.tailMs + MARGIN_MS, 'Sending the recording to the plan\'s voice took too long.');
    job.answer.resolve(sdp);
    try {
      return { durationMs: await job.sent.promise };
    } catch (error) {
      this.end(job, error as WorkforceError);
      throw error;
    }
  }

  close(args: { jobId?: unknown }): Result<'voice.rtcClose'> {
    if (!Number.isSafeInteger(args.jobId)) throw bad('Invalid voice job.');
    const job = this.job;
    if (!job || job.id !== args.jobId) return { ok: true };
    const { sessionMs, answeredAt } = job;
    this.end(job, new WorkforceError('cancelled', 'The voice job was closed.'));
    const windowMs = answeredAt === undefined ? undefined : Math.max(0, (this.deps.now ?? Date.now)() - answeredAt);
    return { ok: true, ...(sessionMs === undefined ? {} : { sessionMs }), ...(windowMs === undefined ? {} : { windowMs }) };
  }

  /** True while a job's window exists (tests). */
  get windowOpen(): boolean { return Boolean(this.job?.window); }

  /** Quit: the running job ends, its window goes. */
  dispose(): void {
    if (this.job) this.end(this.job, new WorkforceError('unavailable', 'The app is closing.'));
  }

  /** (Re)arms the job's one timer: when it fires the job fails with `message`. */
  private arm(job: RtcJob, ms: number, message: string): void {
    if (job.timer !== null) this.clearTimer(job.timer);
    job.timer = this.setTimer(() => this.end(job, new WorkforceError('timeout', message)), ms);
  }

  private end(job: RtcJob, error: WorkforceError): void {
    if (job.ended) return;
    job.ended = true;
    if (job.timer !== null) this.clearTimer(job.timer);
    job.offer.reject(error);
    job.answer.reject(error);
    job.sent.reject(error);
    try { job.window?.destroy(); } catch { /* already gone */ }
    job.window = null;
    job.pcm = new Uint8Array(0);
    if (this.job === job) this.job = null;
  }

  private async route(request: Request): Promise<Response> {
    let url: URL;
    try { url = new URL(request.url); } catch { return status(400); }
    if (url.protocol !== 'wf-file:' || url.host !== HOST) return status(404);
    if (url.pathname === '/rtc.js') return request.method === 'GET' ? text(RTC_SCRIPT, 'text/javascript; charset=utf-8') : status(405);
    const match = ROUTE.exec(url.pathname);
    if (!match) return status(404);
    const job = this.job;
    if (!job || job.ended || job.id !== Number(match[1])) return status(410);
    const part = match[2] ?? '';
    const verb = ['', 'spec', 'pcm', 'answer'].includes(part) ? 'GET' : 'POST';
    if (request.method !== verb) return status(405);
    switch (part) {
      case '': return text(RTC_HTML, 'text/html; charset=utf-8', { 'Content-Security-Policy': RTC_CSP });
      case 'spec': return json({ rate: 16_000, leadMs: RTC_LIMITS.leadMs, tailMs: RTC_LIMITS.tailMs, gatherMs: GATHER_MS, connectMs: RTC_LIMITS.connectMs } satisfies RtcPageSpec);
      case 'pcm': return new Response(job.pcm.slice(), { status: 200, headers: { ...HEADERS, 'Content-Type': 'application/octet-stream' } });
      case 'offer': {
        const sdp = (await readJson(request))?.sdp;
        if (job.offered || job.ended) return status(409);
        if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > RTC_LIMITS.sdpChars) { this.end(job, new WorkforceError('unavailable', FAILURES.offer)); return status(400); }
        job.offered = true;
        job.offer.resolve(sdp);
        return status(204);
      }
      case 'answer': {
        try { return json({ sdp: await job.answer.promise }); } catch { return status(410); }
      }
      case 'sent': {
        const ms = (await readJson(request))?.durationMs;
        if (!job.answered || job.ended) return status(409);
        job.sent.resolve(typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : job.durationMs);
        return status(204);
      }
      case 'usage': { // B-082: the session meter, a number only
        const ms = (await readJson(request))?.ms;
        if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= 7_200_000) job.sessionMs = Math.round(ms);
        return status(204);
      }
      default: {
        const reason = (await readJson(request))?.reason;
        this.end(job, new WorkforceError('unavailable', FAILURES[typeof reason === 'string' && Object.hasOwn(FAILURES, reason) ? reason : 'decode']));
        return status(204);
      }
    }
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

const status = (code: number) => new Response(null, { status: code, headers: HEADERS });
const text = (body: string, type: string, extra: Record<string, string> = {}) => new Response(body, { status: 200, headers: { ...HEADERS, 'Content-Type': type, ...extra } });
const json = (value: unknown) => text(JSON.stringify(value), 'application/json');

/** A small JSON body (≤ 2 × the SDP limit), else null. */
async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.text();
    if (body.length > RTC_LIMITS.sdpChars * 2) return null;
    const value = JSON.parse(body) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
