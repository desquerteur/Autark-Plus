// B-082 (decision 8): the two small models of the conversation's turn detector (turn-detect.ts TurnModels) as
// onnxruntime-web sessions, loaded by `loadTurnModels` only when a conversation starts (this module and ort are a lazy
// chunk of their own): Silero VAD – the file the app pulls with a local speech model (catalog SILERO_VAD, sherpa-onnx's
// export: x [1,512], h/c [2,1,64] -> prob, new_h, new_c; the official v4 export with `sr` works too) – and Smart Turn
// v3.2 int8 (catalog SMART_TURN): the last 8 s left-padded with zeros, normalized, as Whisper's 80-bin log-mel
// spectrogram [1,80,800] -> the probability that the line is finished (pipecat's inference.py). Checked against the
// real Silero file and a numpy reference of Whisper's features (max diff 3e-6). Files come from this page's origin by
// fixed name (TURN_ROUTE: app://app/turn/ on the desktop, the runtime's /turn/ on a phone); ort runs single-threaded
// (no SharedArrayBuffer). The iPhone web app's shell has no 'wasm-unsafe-eval' – nothing is fetched there.
// Owns: tensor shapes, model state, the mel features and the page's model loading (one session per model per page).
// Never: downloads or stores a model.

import { SILERO_VAD, SMART_TURN, TURN_ROUTE } from '../../shared/model/local-speech-models.ts';
import { hostedShell } from '../pwa/hosted.ts';
import type { TurnModels } from './turn-detect.ts';

type Ort = typeof import('onnxruntime-web/wasm');

/**
 * Both models as TurnModels; one that does not load (not downloaded yet, wasm refused) is left out, and with neither
 * this rejects (the detector keeps its level fallback).
 */
export async function loadTurnModels(): Promise<TurnModels> {
  if (hostedShell()) throw new Error('The iPhone web app cannot run WebAssembly models.');
  const ort: Ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = TURN_ROUTE;
  const open = (file: string) => cachedSession(file, () => ort.InferenceSession.create(`${TURN_ROUTE}${file}`, { executionProviders: ['wasm'] }));
  const [vad, turn] = await Promise.allSettled([open(SILERO_VAD.files[0]), open(SMART_TURN.files[0])]);
  if (vad.status === 'rejected' && turn.status === 'rejected') throw vad.reason;
  return {
    ...(vad.status === 'fulfilled' ? { speech: sileroSpeech(ort as unknown as OrtTensors, vad.value) } : {}),
    ...(turn.status === 'fulfilled' ? { finished: smartTurn(ort as unknown as OrtTensors, turn.value) } : {}),
  };
}

/**
 * Review fix: one session per model file for the page's life, shared by its conversations (each gets fresh adapters,
 * so Silero's state starts new). ort's wasm memory never shrinks, so a released session gives nothing back, and a new
 * session per conversation grew the page by the models' size each time. A load that failed is tried again next time.
 */
const sessions = new Map<string, Promise<unknown>>();
export function cachedSession<T>(file: string, create: () => Promise<T>): Promise<T> {
  let session = sessions.get(file) as Promise<T> | undefined;
  if (!session) {
    session = create();
    sessions.set(file, session);
    session.catch(() => { if (sessions.get(file) === session) sessions.delete(file); });
  }
  return session;
}

/** The part of onnxruntime-web the adapters use. */
export interface OrtTensors {
  Tensor: new (type: 'float32' | 'int64', data: Float32Array | BigInt64Array, dims: readonly number[]) => unknown;
}
export interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
}

/** Silero VAD as TurnModels.speech: one 512-sample frame -> speech probability; its recurrent state carries over. */
export function sileroSpeech(ort: OrtTensors, session: OrtSession): (frame: Float32Array) => Promise<number> {
  const [input, ...rest] = session.inputNames;
  const sr = rest.includes('sr') ? new ort.Tensor('int64', BigInt64Array.from([16_000n]), [1]) : undefined;
  const [hName, cName] = rest.filter((name) => name !== 'sr');
  const [probName, hOut, cOut] = session.outputNames;
  let h = new Float32Array(128);
  let c = new Float32Array(128);
  return async (frame) => {
    const feeds: Record<string, unknown> = {
      [input]: new ort.Tensor('float32', frame, [1, frame.length]),
      [hName]: new ort.Tensor('float32', h, [2, 1, 64]),
      [cName]: new ort.Tensor('float32', c, [2, 1, 64]),
    };
    if (sr) feeds.sr = sr;
    const out = await session.run(feeds);
    h = Float32Array.from(out[hOut].data as Float32Array);
    c = Float32Array.from(out[cOut].data as Float32Array);
    return Number((out[probName].data as Float32Array)[0]);
  };
}

/** Smart Turn as TurnModels.finished: the line's audio -> probability that it is finished. */
export function smartTurn(ort: OrtTensors, session: OrtSession): (audio: Float32Array) => Promise<number> {
  return async (audio) => {
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', whisperFeatures(audio), [1, MELS, FRAMES]) });
    return Number((out[session.outputNames[0]].data as Float32Array)[0]);
  };
}

const RATE = 16_000;
const SAMPLES = 8 * RATE;
const N_FFT = 400;
const HOP = 160;
const BINS = N_FFT / 2 + 1;
const MELS = 80;
const FRAMES = SAMPLES / HOP; // 800 (Whisper drops the last of 801)

/** Whisper's log-mel input (WhisperFeatureExtractor, chunk 8 s, do_normalize) of the last 8 s, mel-major [80 x 800]. */
export function whisperFeatures(audio: Float32Array): Float32Array {
  const x = new Float32Array(SAMPLES);
  const tail = audio.subarray(Math.max(0, audio.length - SAMPLES));
  x.set(tail, SAMPLES - tail.length); // zeros in front (audio_utils.truncate_audio_to_last_n_seconds)
  let mean = 0;
  for (const v of x) mean += v;
  mean /= SAMPLES;
  let variance = 0;
  for (const v of x) variance += (v - mean) * (v - mean);
  const scale = 1 / Math.sqrt(variance / SAMPLES + 1e-7);
  for (let i = 0; i < SAMPLES; i++) x[i] = (x[i] - mean) * scale;

  const { window, mel, from, to } = tables();
  const out = new Float32Array(MELS * FRAMES);
  const frame = new Float64Array(N_FFT);
  const real = new Float64Array(N_FFT);
  const imag = new Float64Array(N_FFT);
  const power = new Float64Array(BINS);
  const padStart = SAMPLES - tail.length; // frames wholly inside the padding are all alike: computed once
  let padded: Float64Array | null = null;
  let max = -Infinity;
  for (let f = 0; f < FRAMES; f++) {
    const start = f * HOP - N_FFT / 2; // centered, reflect padding at both ends
    const inPad = start >= 0 && start + N_FFT <= padStart;
    let column: Float64Array | null = inPad ? padded : null;
    if (!column) {
      for (let n = 0; n < N_FFT; n++) frame[n] = x[reflect(start + n)] * window[n];
      transform(frame, 0, 1, N_FFT, real, imag, 0);
      for (let k = 0; k < BINS; k++) power[k] = real[k] * real[k] + imag[k] * imag[k];
      column = new Float64Array(MELS);
      for (let m = 0; m < MELS; m++) {
        let sum = 0;
        const row = m * BINS;
        for (let k = from[m]; k < to[m]; k++) sum += mel[row + k] * power[k];
        column[m] = Math.log10(Math.max(sum, 1e-10));
      }
      if (inPad) padded = column;
    }
    for (let m = 0; m < MELS; m++) { out[m * FRAMES + f] = column[m]; if (column[m] > max) max = column[m]; }
  }
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], max - 8) + 4) / 4;
  return out;
}

const reflect = (i: number) => (i < 0 ? -i : i >= SAMPLES ? 2 * (SAMPLES - 1) - i : i);

/**
 * The 400-point DFT of x[off + n*stride] into out[at..at+size): halves by decimation in time down to the odd size 25,
 * which is summed directly (~7x fewer operations than the plain DFT).
 */
function transform(x: Float64Array, off: number, stride: number, size: number, outR: Float64Array, outI: Float64Array, at: number): void {
  const { cos, sin } = tables();
  if (size % 2) {
    for (let k = 0; k < size; k++) {
      let r = 0;
      let i = 0;
      for (let n = 0, nk = 0; n < size; n++, nk += k) {
        if (nk >= size) nk -= size; // k < size
        const v = x[off + n * stride];
        r += v * cos[nk * stride];
        i -= v * sin[nk * stride];
      }
      outR[at + k] = r;
      outI[at + k] = i;
    }
    return;
  }
  const half = size / 2;
  transform(x, off, stride * 2, half, outR, outI, at);
  transform(x, off + stride, stride * 2, half, outR, outI, at + half);
  for (let k = 0; k < half; k++) {
    const t = k * stride;
    const wr = cos[t];
    const wi = -sin[t];
    const a = at + k;
    const b = a + half;
    const tr = outR[b] * wr - outI[b] * wi;
    const ti = outR[b] * wi + outI[b] * wr;
    outR[b] = outR[a] - tr; outI[b] = outI[a] - ti;
    outR[a] += tr; outI[a] += ti;
  }
}

let cached: { cos: Float64Array; sin: Float64Array; window: Float64Array; mel: Float64Array; from: Uint16Array; to: Uint16Array } | undefined;

function tables() {
  if (cached) return cached;
  const cos = Float64Array.from({ length: N_FFT }, (_, t) => Math.cos((2 * Math.PI * t) / N_FFT));
  const sin = Float64Array.from({ length: N_FFT }, (_, t) => Math.sin((2 * Math.PI * t) / N_FFT));
  const window = Float64Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT)); // periodic Hann
  // Slaney mel scale and norm (librosa / transformers mel_filter_bank), 0–8 kHz.
  const toMel = (hz: number) => (hz < 1000 ? (3 * hz) / 200 : 15 + (Math.log(hz / 1000) * 27) / Math.log(6.4));
  const toHz = (m: number) => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp(((m - 15) * Math.log(6.4)) / 27));
  const top = toMel(RATE / 2);
  const edges = Array.from({ length: MELS + 2 }, (_, i) => toHz((top * i) / (MELS + 1)));
  const mel = new Float64Array(MELS * BINS);
  const from = new Uint16Array(MELS); // each filter's nonzero bins
  const to = new Uint16Array(MELS);
  for (let m = 0; m < MELS; m++) {
    const [lower, center, upper] = [edges[m], edges[m + 1], edges[m + 2]];
    const norm = 2 / (upper - lower);
    for (let k = 0; k < BINS; k++) {
      const hz = (k * RATE) / N_FFT;
      const weight = Math.max(0, Math.min((hz - lower) / (center - lower), (upper - hz) / (upper - center))) * norm;
      mel[m * BINS + k] = weight;
      if (weight > 0) { if (!to[m]) from[m] = k; to[m] = k + 1; }
    }
  }
  cached = { cos, sin, window, mel, from, to };
  return cached;
}
