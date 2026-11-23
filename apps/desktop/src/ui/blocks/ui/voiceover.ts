// The pure parts of the voice-over recorder (record block with `video` + `cues`, blocks/ui/Voiceover.tsx; task_2xr88cmc,
// 17.11.2026): which line the video is at, how far it is through it, how fast it has to be spoken, a tape for raw
// microphone blocks that is cut at the moment the video started, and the WAV file that comes out.
// Why raw audio and not a MediaRecorder: its first data comes up to a second after start() and its WebM clock has no fixed
// relation to the video; the tape counts samples, so "second 0 of the file" is "second 0 of the video" (to within one block).
// Owns: arithmetic on lines, samples and bytes. Never: touches the DOM, the microphone or the video element.

import type { Cue } from '../../../shared/blocks/cues.ts';

/** What the screen shows at one time of the video. */
export interface Moment {
  /** Index of the line being spoken now (start ≤ t < end); -1 between lines, before the first and after the last. */
  current: number;
  /** Index of the line that comes next (the one after `current`, or the first one starting after t); -1 when none is left. */
  next: number;
  /** 0…1 through the current line; 0 when there is none. */
  fraction: number;
  /** Seconds left of the current line (0 when none); in a gap: seconds until the next line starts. */
  remaining: number;
  /** True in a gap before a line that is yet to come. */
  waiting: boolean;
}

/** The line at `t` (cues sorted by start, as parseCues returns them); a short overlap resolves to the later line. */
export function momentAt(cues: readonly Cue[], t: number): Moment {
  let current = -1;
  for (let i = 0; i < cues.length; i++) {
    if (t >= cues[i].start && t < cues[i].end) current = i; // the later line wins in an overlap of rounding size
    else if (cues[i].start > t) break;
  }
  if (current >= 0) {
    const cue = cues[current];
    const next = current + 1 < cues.length ? current + 1 : -1;
    return { current, next, fraction: clamp((t - cue.start) / (cue.end - cue.start)), remaining: Math.max(0, cue.end - t), waiting: false };
  }
  const next = cues.findIndex((cue) => cue.start > t);
  return { current: -1, next, fraction: 0, remaining: next >= 0 ? cues[next].start - t : 0, waiting: next >= 0 };
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** Words in a line, the way they are counted for speaking pace (letters or digits in a run; "can't" is one). */
export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

/** The pace a line asks for, in words per minute, rounded to 5; 0 for a line without words. */
export function targetWpm(cue: Cue): number {
  const words = wordCount(cue.text);
  const seconds = cue.end - cue.start;
  return words > 0 && seconds > 0 ? Math.round((words / seconds) * 60 / 5) * 5 : 0;
}

/** "ahead", "on pace" or "slow down" against the asked pace; undefined while the speaker's pace is not known (live-words.ts). */
export function paceHint(asked: number, spoken: number | undefined): 'faster' | 'on pace' | 'slower' | undefined {
  if (!spoken || !asked) return undefined;
  const ratio = spoken / asked;
  return ratio < 0.8 ? 'faster' : ratio > 1.25 ? 'slower' : 'on pace';
}

/**
 * Raw microphone blocks in the order they arrive. `mark()` is the number of samples seen so far – the index at which the
 * video began to play – and `slice(from)` is the voice from there; a block is the unit of error (about 20 ms).
 */
export class SampleTape {
  private readonly blocks: Float32Array[] = [];
  private frames = 0;
  readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  push(block: Float32Array): void {
    this.blocks.push(block);
    this.frames += block.length;
  }

  mark(): number {
    return this.frames;
  }

  get length(): number {
    return this.frames;
  }

  /** Samples [from, to) as one array (to: the end); a `from` beyond the end gives nothing. */
  slice(from: number, to: number = this.frames): Float32Array {
    const start = Math.max(0, Math.min(from, this.frames));
    const end = Math.max(start, Math.min(to, this.frames));
    const out = new Float32Array(end - start);
    let at = 0;
    for (const block of this.blocks) {
      const blockEnd = at + block.length;
      if (blockEnd > start && at < end) {
        const a = Math.max(start, at) - at;
        const b = Math.min(end, blockEnd) - at;
        out.set(block.subarray(a, b), Math.max(start, at) - start);
      }
      at = blockEnd;
      if (at >= end) break;
    }
    return out;
  }
}

/** A 16-bit mono PCM WAV (44-byte header, little-endian) of `samples` (−1…1, clipped). */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples.length * 2));
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff), true);
  }
  return bytes;
}

/** Seconds a WAV of `frames` samples lasts. */
export const wavSeconds = (frames: number, sampleRate: number): number => (sampleRate > 0 ? frames / sampleRate : 0);
