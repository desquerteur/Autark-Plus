// B-082 – the hidden marks of a draft (ui/chat/composer/draft-marks.ts): a take goes in at its target with its spans,
// edits elsewhere move them, an edit that touches an unsure place drops it (also typed onto it as one word), a
// dictated part loses only the edited piece, typing right before a dictated part moves it along, a menu choice replaces
// exactly that place, and the send takes only the spans inside the sent text.
// Owns: these assertions only. Never: a DOM or the draft store.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpanMark, TextMarks } from '../../../src/shared/voice/marks.ts';
import { insertMarked, markAt, marksFor, replaceMark, shiftMarks } from '../../../src/ui/chat/composer/draft-marks.ts';

const at = (start: number, end = start) => ({ start, end, focused: true });
const unsure = (text: string, word: string, from = 0): SpanMark => {
  const start = text.indexOf(word, from);
  return { start, end: start + word.length, pct: 55, alts: [{ t: 'Kotex', pct: 30 }] };
};
const words = (text: string, marks: TextMarks | undefined) => (marks?.uncertain ?? []).map((mark) => text.slice(mark.start, mark.end));
const spoken = (text: string, marks: TextMarks | undefined) => (marks?.dictated ?? []).map((span) => text.slice(span.start, span.end));

test('insertMarked: a take into an empty draft keeps its unsure spans (leading space and capital letter included)', () => {
  const piece = { text: ' codex works here', marks: { uncertain: [{ start: 1, end: 6, pct: 60, alts: [{ t: 'Kodex', pct: 25 }] }] } };
  const out = insertMarked('', undefined, null, piece, false);
  assert.equal(out.text, 'Codex works here');
  assert.deepEqual(words(out.text, out.marks), ['Codex']);
  assert.deepEqual(spoken(out.text, out.marks), ['Codex works here']);
  assert.equal(out.caret, out.text.length);
});

test('insertMarked: into typed text at the caret – the old spans move, the new take gets a dictated span', () => {
  const text = 'Send Codex the plan';
  const marks = { uncertain: [unsure(text, 'plan')] };
  const piece = { text: 'today maybe', marks: { uncertain: [{ start: 6, end: 11, pct: 40, alts: [] }] } };
  const out = insertMarked(text, marks, at(10), piece, true);
  assert.equal(out.text, 'Send Codex today maybe the plan');
  assert.deepEqual(words(out.text, out.marks), ['maybe', 'plan']);
  assert.deepEqual(spoken(out.text, out.marks), ['today maybe']);
  assert.equal(out.caret, 'Send Codex today maybe'.length);
});

test('insertMarked: over a selection the replaced unsure place goes; appended when the field was not focused', () => {
  const text = 'call Kodex now';
  const marks = { uncertain: [unsure(text, 'Kodex')] };
  const replaced = insertMarked(text, marks, at(5, 10), { text: 'Codex' }, true);
  assert.equal(replaced.text, 'call Codex now');
  assert.equal(replaced.marks?.uncertain, undefined, 'the selected place is gone');
  const appended = insertMarked(text, marks, { start: 0, end: 0, focused: false }, { text: 'please' }, true);
  assert.equal(appended.text, 'call Kodex now please');
  assert.deepEqual(words(appended.text, appended.marks), ['Kodex']);
  assert.deepEqual(insertMarked(text, marks, at(3), { text: '  ' }, true), { text, marks, caret: 3 }, 'no words: nothing changes');
});

test('shiftMarks: edits before and after move or keep a span; an edit inside or glued to it drops it', () => {
  const text = 'the Kodex app';
  const marks = { uncertain: [unsure(text, 'Kodex')] };
  const before = shiftMarks(text, 'see the Kodex app', marks);
  assert.deepEqual(words('see the Kodex app', before), ['Kodex']);
  assert.deepEqual(words('the Kodex app now', shiftMarks(text, 'the Kodex app now', marks)), ['Kodex']);
  assert.equal(shiftMarks(text, 'the Kodax app', marks), undefined, 'edited inside');
  assert.equal(shiftMarks(text, 'the Kodexs app', marks), undefined, 'typed onto its end');
  assert.equal(shiftMarks(text, 'the xKodex app', marks), undefined, 'typed onto its start');
  assert.equal(shiftMarks(text, 'the Kodexapp', marks), undefined, 'the space after it deleted: glued to the next word');
  assert.equal(shiftMarks(text, 'the app', marks), undefined, 'deleted');
  assert.equal(shiftMarks(text, '', marks), undefined, 'emptied');
  assert.equal(shiftMarks(text, text, marks), marks);
});

test('shiftMarks: typing right before an unsure word with equal letters never drops it by chance', () => {
  const text = 'offer today';
  const marks = { uncertain: [unsure(text, 'today')] };
  const typed = 'offer t today'; // " t" typed after "offer" – the diff alone would place it inside "today"
  assert.deepEqual(words(typed, shiftMarks(text, typed, marks)), ['today']);
  const removed = shiftMarks(typed, text, shiftMarks(text, typed, marks));
  assert.deepEqual(words(text, removed), ['today'], 'and deleting it again');
});

test('shiftMarks: a dictated span loses only the edited part; typing right before it moves it along', () => {
  const text = 'note: buy milk and bread';
  const marks: TextMarks = { dictated: [{ start: 6, end: text.length }] };
  const typedBefore = 'note: please buy milk and bread';
  assert.deepEqual(spoken(typedBefore, shiftMarks(text, typedBefore, marks)), ['buy milk and bread']);
  const typedInside = 'note: buy milk, eggs and bread';
  assert.deepEqual(spoken(typedInside, shiftMarks(text, typedInside, marks)), ['buy milk', ' and bread']);
  const typedAfter = `${text}!`;
  assert.deepEqual(spoken(typedAfter, shiftMarks(text, typedAfter, marks)), ['buy milk and bread']);
});

test('replaceMark: the menu choice replaces exactly that place, drops its mark, moves the others, caret after it', () => {
  const text = 'ask Kodex about Teidra today';
  const marks: TextMarks = { uncertain: [unsure(text, 'Kodex'), unsure(text, 'Teidra')], dictated: [{ start: 0, end: text.length }] };
  const picked = replaceMark(text, marks, 0, 'Codex', false);
  assert.ok(picked);
  assert.equal(picked.text, 'ask Codex about Teidra today');
  assert.deepEqual(words(picked.text, picked.marks), ['Teidra']);
  assert.deepEqual(spoken(picked.text, picked.marks), [picked.text], "the AI's word stays dictated");
  assert.equal(picked.caret, 'ask Codex'.length);
  const own = replaceMark(picked.text, picked.marks!, 0, 'Teydra Lab', true);
  assert.ok(own);
  assert.equal(own.text, 'ask Codex about Teydra Lab today');
  assert.equal(own.marks?.uncertain, undefined);
  assert.deepEqual(spoken(own.text, own.marks), ['ask Codex about ', ' today'], 'the typed word is not dictated');
  assert.equal(replaceMark(text, marks, 5, 'x', true), null);
});

test('marksFor: only the spans inside the sent text, moved to its start; a dictated span over all of it goes', () => {
  const text = '  hello Kodex  ';
  const marks: TextMarks = { uncertain: [unsure(text, 'Kodex')], dictated: [{ start: 2, end: 13 }] };
  assert.deepEqual(marksFor(text, marks, 'hello Kodex'), { uncertain: [{ ...unsure(text, 'Kodex'), start: 6, end: 11 }] });
  const mixed: TextMarks = { dictated: [{ start: 8, end: 13 }] };
  assert.deepEqual(marksFor(text, mixed, 'hello Kodex'), { dictated: [{ start: 6, end: 11 }] });
  const slash = '/important call Kodex';
  assert.deepEqual(words('call Kodex', marksFor(slash, { uncertain: [unsure(slash, 'Kodex')] }, 'call Kodex')), ['Kodex']);
  const short = '/silent t ';
  assert.deepEqual(marksFor(short, { uncertain: [{ start: 8, end: 9, pct: 50, alts: [] }] }, 't'), { uncertain: [{ start: 0, end: 1, pct: 50, alts: [] }] },
    'the body is the end of the text, not the first equal letters in the command');
  assert.equal(marksFor(text, undefined, 'hello'), undefined);
  assert.equal(marksFor(text, marks, 'other'), undefined);
});

test('markAt: the unsure place the caret is in, its ends included', () => {
  const text = 'the Kodex app';
  const marks = { uncertain: [unsure(text, 'Kodex')] };
  assert.equal(markAt(marks, 4), 0);
  assert.equal(markAt(marks, 9), 0);
  assert.equal(markAt(marks, 2), -1);
  assert.equal(markAt(undefined, 4), -1);
});
