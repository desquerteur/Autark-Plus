// Voice-over lines of a `record` block with a `video` (task_2xr88cmc, 17.11.2026): what the person says and when,
// as the agent writes it – [{text, start, end}] in seconds of the video – checked and shaped here for both the block
// validator (validate.ts / shape.ts: the agent gets the problem as its error and writes the block again) and the
// recorder's page (blocks/ui/voiceover.ts), so both read the same lines.
// Owns: the limits and the rules for the lines. Never: looks at the video, the clock or the microphone.

export interface Cue {
  text: string;
  /** Seconds from the start of the video. */
  start: number;
  end: number;
}

export const CUE_LIMITS = { lines: 200, text: 400, seconds: 6 * 3600, overlap: 0.3 } as const;

export type CuesResult = { cues: Cue[]; problem?: undefined } | { cues?: undefined; problem: string };

const number = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(value)) return Number(value.replace(',', '.'));
  return undefined;
};

/** A time as the agent may write it: seconds (12.5, "12,5") or "m:ss(.s)" / "h:mm:ss". */
export function secondsOf(value: unknown): number | undefined {
  const plain = number(value);
  if (plain !== undefined) return plain;
  if (typeof value !== 'string') return undefined;
  const parts = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2}(?:[.,]\d+)?)\s*$/.exec(value);
  if (!parts) return undefined;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3].replace(',', '.'));
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * The lines of a block: 1–200, text up to 400 characters, 0 ≤ start < end ≤ 6 h, sorted by start; lines may overlap by
 * up to 0.3 s (one ends as the next starts, rounding), not more. The first problem comes back as a sentence naming the
 * line (1-based, in the order written) so the agent can correct exactly that one.
 */
export function parseCues(raw: unknown): CuesResult {
  if (!Array.isArray(raw) || raw.length === 0) return { problem: '"cues" must be a list of {text, start, end}' };
  if (raw.length > CUE_LIMITS.lines) return { problem: `"cues" has ${raw.length} lines, at most ${CUE_LIMITS.lines}` };
  const cues: Array<Cue & { at: number }> = [];
  for (const [index, item] of raw.entries()) {
    const at = index + 1;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { problem: `cue ${at} must be {text, start, end}` };
    const line = item as Record<string, unknown>;
    const text = typeof line.text === 'string' ? line.text.replace(/\s+\n/g, '\n').trim() : '';
    if (!text) return { problem: `cue ${at} has no text` };
    if (text.length > CUE_LIMITS.text) return { problem: `cue ${at} has ${text.length} characters, at most ${CUE_LIMITS.text}` };
    const start = secondsOf(line.start);
    const end = secondsOf(line.end);
    if (start === undefined || end === undefined) return { problem: `cue ${at} needs "start" and "end" in seconds (12.5) or m:ss` };
    if (start < 0 || end > CUE_LIMITS.seconds) return { problem: `cue ${at} lies outside 0 s … ${CUE_LIMITS.seconds} s` };
    if (end <= start) return { problem: `cue ${at} must end after it starts (${round(start)} s … ${round(end)} s)` };
    cues.push({ text, start: round(start), end: round(end), at });
  }
  cues.sort((a, b) => a.start - b.start || a.at - b.at);
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start < cues[i - 1].end - CUE_LIMITS.overlap) {
      return { problem: `cue ${cues[i].at} starts at ${cues[i].start} s while cue ${cues[i - 1].at} runs until ${cues[i - 1].end} s` };
    }
  }
  return { cues: cues.map(({ text, start, end }) => ({ text, start, end })) };
}
