// B-082: the hidden marks of a draft (shared/voice/marks.ts TextMarks: unsure places and dictated parts as spans in the
// plain text). A take goes in at its target with its spans (insertMarked); every other edit moves the spans along
// (shiftMarks, the prefix/suffix diff of dictation-insert.ts). An edit that touches an unsure place – inside it, over
// it, or glued to it as one word – drops that mark: the person has dealt with it. A dictated span loses only the
// edited part. Picking a word in the mark menu replaces exactly that place (replaceMark); the send takes the spans
// that lie in the sent text (marksFor).
// Owns: these pure span rules. Never: reads the DOM or the draft store (draft.ts, Composer.tsx, voice.ts do).

import type { MarkedText, SpanMark, TextMarks } from '../../../shared/voice/marks.ts';
import { diff, insertDictation, type DictationTarget } from './dictation-insert.ts';

interface Span { start: number; end: number }

const WORDLIKE = /[\p{L}\p{N}]/u;
const word = (char: string | undefined) => char !== undefined && WORDLIKE.test(char);
const MAX_SLIDE = 64;

/** Undefined when nothing is left, so a draft without marks carries none. */
function tidy(uncertain: SpanMark[], dictated: Span[]): TextMarks | undefined {
  uncertain.sort((a, b) => a.start - b.start);
  dictated.sort((a, b) => a.start - b.start);
  const joined: Span[] = [];
  for (const span of dictated) {
    const last = joined[joined.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else joined.push({ ...span });
  }
  if (!uncertain.length && !joined.length) return undefined;
  return { ...(uncertain.length ? { uncertain } : {}), ...(joined.length ? { dictated: joined } : {}) };
}

/**
 * The marks after `before[from, to)` became `after[from, to + delta)`. `stretch`: a dictated span around the edit
 * keeps it (a word the AI offered for that place), else it loses the edited part.
 */
function edit(before: string, after: string, marks: TextMarks, from: number, to: number, stretch = false): TextMarks | undefined {
  const delta = after.length - before.length;
  const uncertain: SpanMark[] = [];
  for (const mark of marks.uncertain ?? []) {
    if (mark.end <= from) {
      if (mark.end === from && word(before[mark.end - 1]) && word(after[from])) continue; // typed onto its end
      uncertain.push(mark);
    } else if (mark.start >= to) {
      if (mark.start === to && word(before[mark.start]) && word(after[to + delta - 1])) continue; // typed onto its start
      uncertain.push({ ...mark, start: mark.start + delta, end: mark.end + delta });
    }
  }
  const dictated: Span[] = [];
  for (const span of marks.dictated ?? []) {
    if (span.end <= from) dictated.push(span);
    else if (span.start >= to) dictated.push({ start: span.start + delta, end: span.end + delta });
    else if (stretch && span.start <= from && span.end >= to) dictated.push({ start: span.start, end: span.end + delta });
    else {
      if (span.start < from) dictated.push({ start: span.start, end: from });
      if (span.end > to) dictated.push({ start: to + delta, end: span.end + delta });
    }
  }
  return tidy(uncertain, dictated);
}

/** Unsure places kept count most; then a dictated part left whole beats one cut in two. */
const kept = (marks: TextMarks | undefined) => (marks?.uncertain?.length ?? 0) * 1000 - (marks?.dictated?.length ?? 0);

/**
 * The marks of `before` moved to `after` (one edit, found by the prefix/suffix diff). A pure insertion or deletion
 * next to equal letters fits in several places ("offer| today" + " t"); the place that keeps the most marks whole
 * wins, so typing beside an unsure word never drops it by chance.
 */
export function shiftMarks(before: string, after: string, marks?: TextMarks): TextMarks | undefined {
  if (!marks || before === after) return marks;
  if (!after) return undefined;
  const { prefix, suffix } = diff(before, after);
  const to = before.length - suffix;
  let best = edit(before, after, marks, prefix, to);
  const pure = prefix === to || prefix === after.length - suffix;
  if (!pure) return best;
  const n = Math.abs(after.length - before.length);
  const grows = after.length > before.length;
  for (let p = prefix; p > 0 && prefix - p < MAX_SLIDE; p--) {
    const same = grows ? before[p - 1] === after[p - 1 + n] : before[p - 1 + n] === after[p - 1];
    if (!same) break;
    const moved = edit(before, after, marks, p - 1, grows ? p - 1 : p - 1 + n);
    if (kept(moved) > kept(best)) best = moved;
  }
  return best;
}

/**
 * A take (plain text + its spans) put into the draft at `target` (dictation-insert.ts: spacing, capital letter;
 * no target or not focused: appended). The take gets a dictated span, so typed and spoken parts stay apart
 * through later edits; `_typedBefore` (today's wrapDictation rule) is not needed for that – the send drops a
 * dictated span that covers the whole text. Marks the insert touches go (a replaced selection).
 */
export function insertMarked(text: string, marks: TextMarks | undefined, target: DictationTarget | null, piece: MarkedText, _typedBefore?: boolean): { text: string; marks?: TextMarks; caret: number } {
  const append = !target || !target.focused;
  const start = append ? text.length : Math.max(0, Math.min(target.start, text.length));
  const end = append ? text.length : Math.max(start, Math.min(target.end, text.length));
  const inserted = insertDictation(text, target, piece.text);
  if (!inserted.dictated) return { text, ...(marks ? { marks } : {}), caret: inserted.caret };
  const from = Math.min(start, inserted.offset); // a space before closing punctuation may have gone
  const base = edit(text, inserted.text, marks ?? {}, from, end);
  const lead = piece.text.length - piece.text.trimStart().length;
  const length = piece.text.trim().length;
  const grown = inserted.dictated.length - length; // a capital letter that is longer ("ß" → "SS")
  const own: SpanMark[] = [];
  for (const mark of piece.marks?.uncertain ?? []) {
    let s = Math.max(0, mark.start - lead);
    let e = Math.min(length, mark.end - lead);
    if (e <= s) continue;
    if (s > 0) s += grown;
    e += grown;
    own.push({ ...mark, start: inserted.offset + s, end: inserted.offset + e });
  }
  const spoken = { start: inserted.offset, end: inserted.offset + inserted.dictated.length };
  const result = tidy([...(base?.uncertain ?? []), ...own], [...(base?.dictated ?? []), spoken]);
  return { text: inserted.text, ...(result ? { marks: result } : {}), caret: inserted.caret };
}

/**
 * The mark menu's choice: the unsure place `index` becomes `value`, its mark goes, the caret after it. `typed`
 * (the person's own words): a dictated span around it loses that part; a word the AI offered stays dictated.
 */
export function replaceMark(text: string, marks: TextMarks, index: number, value: string, typed: boolean): { text: string; marks?: TextMarks; caret: number } | null {
  const mark = marks.uncertain?.[index];
  if (!mark || mark.end > text.length) return null;
  const next = text.slice(0, mark.start) + value + text.slice(mark.end);
  const result = edit(text, next, marks, mark.start, mark.end, !typed);
  return { text: next, ...(result ? { marks: result } : {}), caret: mark.start + value.length };
}

/**
 * The marks for a sent `body` (the draft's text trimmed, or a level command's text): the spans inside it, moved to
 * its start. A dictated span that holds every word of it goes – the message is marked as spoken anyway.
 */
export function marksFor(text: string, marks: TextMarks | undefined, body: string): TextMarks | undefined {
  if (!marks || !body) return undefined;
  const tail = text.trimEnd().length - body.length; // the body ends the text ("/silent t": the "t" of the arg, not of "silent")
  const at = tail >= 0 && text.startsWith(body, tail) ? tail : text.indexOf(body);
  if (at < 0) return undefined;
  const stop = at + body.length;
  const uncertain = (marks.uncertain ?? []).filter((mark) => mark.start >= at && mark.end <= stop).map((mark) => ({ ...mark, start: mark.start - at, end: mark.end - at }));
  const dictated = (marks.dictated ?? []).map((span) => ({ start: Math.max(span.start, at) - at, end: Math.min(span.end, stop) - at })).filter((span) => span.end > span.start);
  const tidied = tidy(uncertain, dictated);
  const spoken = tidied?.dictated;
  if (spoken && body.split('').every((char, i) => /\s/u.test(char) || spoken.some((span) => i >= span.start && i < span.end))) {
    return uncertain.length ? { uncertain } : undefined;
  }
  return tidied;
}

/** The unsure place the collapsed caret `at` is in (its ends included), or -1. */
export function markAt(marks: TextMarks | undefined, at: number): number {
  return marks?.uncertain?.findIndex((mark) => at >= mark.start && at <= mark.end) ?? -1;
}
