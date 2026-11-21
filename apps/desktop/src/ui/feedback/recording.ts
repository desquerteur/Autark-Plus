// The voice of a feedback dictation (feedback 16.11.2026, F15: a badly transcribed take can be listened to again): while
// the feedback mic or the cell's talk records, the same microphone stream (lib/dictation.ts `stream`) also runs the
// browser's MediaRecorder – Opus in WebM at RECORDING_BITS, MP4 where WebM is not recorded (the iPhone). No codec code
// of ours. A take that is kept becomes one RecordedTake of the draft (draft.ts); one the dictation dropped (cancelled, or
// a newer dictation took the microphone) is discarded with it. recordingDictation joins the words and the voice of one
// feedback take: the voice is kept before the words are heard, so a take nobody could transcribe still has its voice.
// Owns: the recorder of the one running take and that join. Never: uploads, stores or plays anything, or opens the
// microphone.

import type { FeedbackAudioType } from '../../shared/model/feedback-delivery.ts';
import { TakeNotTranscribed } from '../lib/dictation.ts';
import type { ButtonDictation } from './bridge.ts';

/** About 1.5 kB per second of speech: some 5 minutes fit a sealed letter beside a screenshot. */
export const RECORDING_BITS = 12_000;
/** How long a stopped recorder may take to hand over its last audio. */
const STOP_WAIT_MS = 1500;
/** What the team's inbox accepts (the runtime checks the bytes). */
export type RecordingMime = FeedbackAudioType;

/** One kept take: its audio and its length. */
export interface RecordedTake {
  blob: Blob;
  mime: RecordingMime;
  ms: number;
}

/** The part of MediaRecorder a take uses (a fake in tests). */
export interface RecorderLike {
  readonly state: string;
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface RecorderEnv {
  /** null where this page has no MediaRecorder. */
  create(stream: MediaStream, options: { mimeType?: string; audioBitsPerSecond?: number }): RecorderLike | null;
  isTypeSupported(type: string): boolean;
  now(): number;
}

/** The type to ask the recorder for, and the plain type the take is stored as; null when neither is recorded here. */
export function recordingMime(isTypeSupported: (type: string) => boolean): { request: string; mime: RecordingMime } | null {
  for (const [request, mime] of [['audio/webm;codecs=opus', 'audio/webm'], ['audio/webm', 'audio/webm'], ['audio/mp4', 'audio/mp4']] as const) {
    try { if (isTypeSupported(request)) return { request, mime }; } catch { /* not answerable: try the next */ }
  }
  return null;
}

/** The plain type of what a recorder actually wrote, or null when the inbox would not take it. */
export function plainMime(type: string): RecordingMime | null {
  const base = type.split(';')[0]!.trim().toLowerCase();
  return base === 'audio/webm' || base === 'audio/mp4' ? base : null;
}

/** "0:42", "1:05:03" – a take's length. */
export function recordingLength(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface Running {
  recorder: RecorderLike;
  chunks: Blob[];
  mime: RecordingMime | null;
  startedAt: number;
  stopped: Promise<void>;
}

/** The recorder of one take at a time: begin() on the take's stream, keep() at its end, cancel() when it is dropped. */
export class TakeRecorder {
  private readonly env: RecorderEnv;
  private running: Running | null = null;

  constructor(env: RecorderEnv) {
    this.env = env;
  }

  /** Starts recording `stream` (a running take is cancelled first); without a recorder here nothing happens. */
  begin(stream: MediaStream | undefined): void {
    this.cancel();
    if (!stream) return;
    const type = recordingMime((value) => this.env.isTypeSupported(value));
    const mimeType = type ? { mimeType: type.request } : {};
    let recorder: RecorderLike | null = null;
    try {
      recorder = this.env.create(stream, { ...mimeType, audioBitsPerSecond: RECORDING_BITS });
    } catch {
      try { recorder = this.env.create(stream, mimeType); } catch { recorder = null; } // a browser refusing the rate records at its own
    }
    if (!recorder) return;
    const chunks: Blob[] = [];
    let ended: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => { ended = resolve; });
    recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => ended();
    recorder.onerror = () => ended();
    try { recorder.start(1000); } catch { return; }
    this.running = { recorder, chunks, mime: type?.mime ?? null, startedAt: this.env.now(), stopped };
  }

  /** Stops the take and gives its audio (null when nothing was recorded or the type is not one the inbox takes). */
  async keep(): Promise<RecordedTake | null> {
    const running = this.running;
    this.running = null;
    if (!running) return null;
    const ms = this.env.now() - running.startedAt;
    if (running.recorder.state !== 'inactive') { try { running.recorder.stop(); } catch { /* stopped already */ } }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([running.stopped, new Promise<void>((resolve) => { timer = setTimeout(resolve, STOP_WAIT_MS); })]); // a recorder that never ends never holds the words
    clearTimeout(timer);
    const mime = plainMime(running.recorder.mimeType) ?? running.mime;
    if (!mime || !running.chunks.length) return null;
    const blob = new Blob(running.chunks, { type: mime });
    return blob.size > 0 ? { blob, mime, ms } : null;
  }

  /** Drops the take (its audio is never kept). */
  cancel(): void {
    const running = this.running;
    this.running = null;
    if (!running) return;
    running.recorder.ondataavailable = null;
    if (running.recorder.state !== 'inactive') { try { running.recorder.stop(); } catch { /* stopped already */ } }
  }
}

/** Said when a take's words could not be heard but its recording went into the report. */
export const KEPT_NOT_HEARD = 'Not transcribed – the recording goes with the report.';

/** What a feedback take records into (the page's recorder and the draft; fakes in tests). */
export interface TakeRecording {
  /** "Recording" is on: this take keeps its voice. */
  wanted(): boolean;
  begin(stream: MediaStream | undefined): void;
  keep(): Promise<RecordedTake | null>;
  cancel(): void;
  /** The kept take joins the report. */
  add(take: RecordedTake): void;
}

/** The take's words (the page's dictation; a fake in tests). */
export interface TakeWords {
  start(onEnded: () => void): Promise<void>;
  readonly stream: MediaStream | undefined;
  finish(language?: string): Promise<{ text: string }>;
  cancel(): void;
}

/**
 * A feedback mic's dictation: the words, and – while "Recording" is on – the voice of the same take, kept before
 * the words are heard. A take whose words could not be heard but whose voice was kept says so (KEPT_NOT_HEARD).
 */
export function recordingDictation(words: TakeWords, recording: TakeRecording): ButtonDictation {
  return {
    start: async (onEnded) => {
      await words.start(() => { recording.cancel(); onEnded(); });
      if (recording.wanted()) recording.begin(words.stream);
    },
    finish: async (language) => {
      const take = await recording.keep(); // before the microphone closes
      if (take) recording.add(take);
      try {
        return (await words.finish(language)).text;
      } catch (error) {
        if (take && error instanceof TakeNotTranscribed) throw new Error(KEPT_NOT_HEARD);
        throw error;
      }
    },
    cancel: () => { recording.cancel(); words.cancel(); },
  };
}

type RecorderClass ={ new(stream: MediaStream, options?: { mimeType?: string; audioBitsPerSecond?: number }): RecorderLike; isTypeSupported(type: string): boolean };
const pageRecorder = (): RecorderClass | undefined => (globalThis as { MediaRecorder?: RecorderClass }).MediaRecorder;

/** This page's recorder (the browser's MediaRecorder; none where the page has it not). */
export const feedbackRecorder = new TakeRecorder({
  create: (stream, options) => { const Recorder = pageRecorder(); return Recorder ? new Recorder(stream, options) : null; },
  isTypeSupported: (type) => pageRecorder()?.isTypeSupported(type) === true,
  now: () => Date.now(),
});
