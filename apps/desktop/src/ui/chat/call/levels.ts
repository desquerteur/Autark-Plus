// B-085: how loud a realtime call is right now, for the call card's speaking ring (CallCard.tsx). Realtime voice
// (realtime-call.ts) pushes the microphone's level per captured block and queues each answer piece's level for the
// time it actually plays (playback runs ahead of the clock). The card reads both on its own short interval and writes
// the ring straight on its DOM – no signal, no re-render. Levels are 0..1 (pcm.ts meterLevel). Times are
// performance.now() milliseconds.
// Owns: the two meters and the pure ring rules. Never: audio nodes, analysers or the DOM.

/** A level that rises at once and falls at FALL_PER_S per second. */
export class LevelMeter {
  private level = 0;
  private at = 0;

  push(level: number, now: number): void {
    this.level = Math.max(this.read(now), level);
    this.at = now;
  }

  read(now: number): number {
    return Math.max(0, this.level - ((now - this.at) / 1000) * FALL_PER_S);
  }

  clear(): void { this.level = 0; }
}

/** Answer audio scheduled ahead: each piece's level counts from when it starts playing until it ends. */
export class PlaybackMeter {
  private pieces: Array<{ from: number; to: number; level: number }> = [];

  queue(level: number, from: number, ms: number): void {
    if (this.pieces.length >= MAX_PIECES) this.pieces.shift();
    this.pieces.push({ from, to: from + ms, level });
  }

  read(now: number): number {
    while (this.pieces.length && this.pieces[0].to <= now) this.pieces.shift();
    const piece = this.pieces.find((one) => one.from <= now);
    return piece ? piece.level : 0;
  }

  /** Audio is still queued to play after `now`. */
  playing(now: number): boolean {
    return this.pieces.some((one) => one.to > now);
  }

  clear(): void { this.pieces = []; }
}

const FALL_PER_S = 2.4;
const MAX_PIECES = 400;
/** Below this a side counts as quiet. */
export const SPEAKER_FLOOR = 0.18;

/** The microphone of this device's realtime call. */
export const micMeter = new LevelMeter();
/** The realtime answer as it plays. */
export const playMeter = new PlaybackMeter();

/** Who is heard: the agent when its answer is at least as loud as the microphone, else the person, else nobody. */
export function speakerOf(mic: number, out: number): 'agent' | 'person' | undefined {
  if (out >= SPEAKER_FLOOR && out >= mic) return 'agent';
  return mic >= SPEAKER_FLOOR ? 'person' : undefined;
}

/** The speaking ring's scale for a level: 1 when quiet, up to 1.18. */
export function ringScale(level: number): number {
  return 1 + 0.18 * Math.max(0, Math.min(1, level));
}
