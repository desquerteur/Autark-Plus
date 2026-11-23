// Teleprompter rules for the `record` widget (Record.tsx): a short script gets a box only as
// tall as its text (CSS keeps at least three lines), a long one the full box (min(40vh,300px))
// and scrolls by itself while recording; scrolling stops at the end.
// F23 (owner 16.11.2026: "in welcher Geschwindigkeit man das lesen soll … ob man schneller oder langsamer reden muss"):
// with the words heard while recording (live-words.ts) the script follows the speaker. followScript finds the last
// script word they reached (the box marks it); the scroll runs at their pace – words per minute times the script's
// height per word (prompterPace) – plus a pull that brings that word to the reading line READ_AT within CATCH_UP_S
// (followSpeed). Until a word is matched the chosen speed step scrolls, as before.
// Owns: the fit test, the speed steps, the per-frame scroll step, words of a text, the follow and the pace.
// Never: touches the DOM.

/** Auto-scroll speeds in px per second (the widget shows them as 1..5). */
export const PROMPTER_SPEEDS: readonly number[] = [12, 20, 30, 42, 56];

/** Longest frame gap that still counts as running (a hidden tab must not jump on return). */
const MAX_FRAME_MS = 100;

/**
 * True when the script is taller than the box can show at its maximum height, so it has to
 * scroll. `paddingY` is the box's top + bottom padding (inside its border-box max height).
 */
export function prompterScrolls(contentHeight: number, boxMaxHeight: number, paddingY = 0): boolean {
  if (!Number.isFinite(boxMaxHeight) || boxMaxHeight <= 0) return true; // no cap known: keep scrolling on
  return contentHeight > boxMaxHeight - paddingY + 1;
}

/** Scroll position after one frame of `elapsedMs` at `speed` px/s, never past `maxScroll`. */
export function prompterStep(position: number, speed: number, elapsedMs: number, maxScroll: number): number {
  const elapsed = Math.max(0, Math.min(MAX_FRAME_MS, elapsedMs));
  return Math.max(0, Math.min(maxScroll, position + (speed * elapsed) / 1000));
}

// ------------------------------------------------------------------ following the speaker (F23)

/** While following, the last heard script word sits this share of the box's height below its top (the reading line). */
export const READ_AT = 0.25;
/** A gap between that word and the reading line closes in about this many seconds. */
const CATCH_UP_S = 3;
/** The fastest follow scroll (px/s). */
const FOLLOW_MAX = 160;
/** How many script words ahead the next heard word is looked for (words the speaker or the hearing skipped). */
const AHEAD = 12;
/** Three heard words in a row found further on move the place there when they hold at least this many letters. */
const RUN_LETTERS = 12;
/** Words per minute count the heard speech of about the last half minute, from this many words on. */
const PACE_WINDOW_MS = 30_000;
const PACE_MIN_WORDS = 8;

const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

/** The words of a text with where they stand; `word` as compared: NFC, lower case, ’ as '. */
export function wordSpans(text: string): Array<{ start: number; end: number; word: string }> {
  return [...text.matchAll(WORD)].map((match) => ({
    start: match.index, end: match.index + match[0].length, word: match[0].normalize('NFC').toLowerCase().replace(/’/g, "'"),
  }));
}

/** The words of a text as compared. */
export function wordsOf(text: string): string[] {
  return wordSpans(text).map((span) => span.word);
}

/** One word heard as another: the same, or two long words with the same start (a heard ending often differs). */
function alike(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a === b || (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 3 && a.slice(0, 5) === b.slice(0, 5));
}

/**
 * The index of the last script word the heard words reached (-1: none yet). Only forward: each heard word is looked for
 * among the next AHEAD script words – one of three letters or fewer counts there only as one of the next two words or
 * right after the heard word before it –, and three heard words in a row found further on move the place there (a
 * skipped part). Heard words that stand nowhere in the script (said beside it, misheard) are passed over.
 */
export function followScript(script: readonly string[], heard: readonly string[]): number {
  let at = -1;
  for (let i = 0; i < heard.length; i++) {
    const word = heard[i];
    let found = -1;
    for (let j = at + 1; j < Math.min(script.length, at + 1 + AHEAD) && found < 0; j++) {
      if (alike(script[j], word) && (j <= at + 2 || word.length > 3 || alike(script[j - 1], heard[i - 1]))) found = j;
    }
    if (found < 0 && i >= 2 && word.length + heard[i - 1].length + heard[i - 2].length >= RUN_LETTERS) {
      for (let j = Math.max(at + 3, 2); j < script.length && found < 0; j++) {
        if (alike(script[j], word) && alike(script[j - 1], heard[i - 1]) && alike(script[j - 2], heard[i - 2])) found = j;
      }
    }
    if (found >= 0) at = found;
  }
  return at;
}

/** Words per minute of the heard pieces (`ms`: a piece's length) over about the last PACE_WINDOW_MS; undefined below PACE_MIN_WORDS words. */
export function wordsPerMinute(pieces: ReadonlyArray<{ ms: number; text?: string; error?: string }>): number | undefined {
  let words = 0;
  let ms = 0;
  for (let index = pieces.length - 1; index >= 0 && ms < PACE_WINDOW_MS; index--) {
    const count = wordsOf(pieces[index].text ?? '').length;
    if (!count) continue; // a piece not heard, or no words in it, says nothing about the pace
    words += count;
    ms += Math.max(0, pieces[index].ms);
  }
  return words >= PACE_MIN_WORDS && ms > 0 ? (words * 60_000) / ms : undefined;
}

/** The speaker's pace on the script in px per second: words per minute times the script's height per word. */
export function prompterPace(wpm: number, pxPerWord: number): number {
  return wpm > 0 && pxPerWord > 0 ? (wpm / 60) * pxPerWord : 0;
}

/** The follow speed (px/s): the pace plus a pull closing `gapPx` (from the scroll to the heard word's place; < 0: ahead) within CATCH_UP_S. */
export function followSpeed(pace: number, gapPx: number): number {
  const speed = Math.max(0, pace) + gapPx / CATCH_UP_S;
  return Number.isFinite(speed) ? Math.max(0, Math.min(FOLLOW_MAX, speed)) : 0;
}
