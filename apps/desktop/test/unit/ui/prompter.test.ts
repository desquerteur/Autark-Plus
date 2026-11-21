// Teleprompter: short scripts fit (no scrolling), long ones scroll; the scroll step is bounded. F23: the script follows
// the speaker – the last script word the heard words reached, their words per minute, the pace in px/s and the pull.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTER_SPEEDS, followScript, followSpeed, prompterPace, prompterScrolls, prompterStep, wordSpans, wordsOf, wordsPerMinute } from '../../../src/ui/blocks/ui/prompter.ts';

test('a script that fits the capped box does not scroll; a longer one does', () => {
  // Box max 300px incl. 32px padding → 268px of text fit.
  assert.equal(prompterScrolls(113, 300, 32), false, 'three lines');
  assert.equal(prompterScrolls(268, 300, 32), false, 'exactly full');
  assert.equal(prompterScrolls(269, 300, 32), false, 'sub-pixel rounding tolerated');
  assert.equal(prompterScrolls(400, 300, 32), true);
  assert.equal(prompterScrolls(280, 300), false, 'no padding given');
});

test('without a known cap the prompter keeps the scrolling behaviour', () => {
  assert.equal(prompterScrolls(50, Number.NaN, 32), true);
  assert.equal(prompterScrolls(50, 0, 32), true);
});

test('scroll step follows speed and time, stops at the end and ignores long gaps', () => {
  assert.equal(prompterStep(0, 30, 16, 1000), 0.48);
  assert.ok(Math.abs(prompterStep(990, 56, 100, 1000) - 995.6) < 1e-9);
  assert.equal(prompterStep(999, 56, 100, 1000), 1000, 'never past the end');
  assert.equal(prompterStep(10, 30, 5000, 1000), 13, 'a hidden tab does not jump');
  assert.equal(prompterStep(10, 30, -20, 1000), 10);
  assert.equal(prompterStep(0, 30, 16, -5), 0, 'nothing to scroll');
  assert.deepEqual([...PROMPTER_SPEEDS], [12, 20, 30, 42, 56]);
});

test('words of a text: letters and digits in lower case with their places; markup and punctuation are no words', () => {
  assert.deepEqual(wordsOf('**Hallo**, Welt! Wir’re 3 Über-Schritte.'), ['hallo', 'welt', "wir're", '3', 'über', 'schritte']);
  assert.deepEqual(wordSpans('Ein Test.'), [{ start: 0, end: 3, word: 'ein' }, { start: 4, end: 8, word: 'test' }]);
  assert.deepEqual(wordsOf('Übermorgen'), wordsOf('Übermorgen'), 'composed and decomposed umlauts are one word');
  assert.deepEqual(wordsOf(''), []);
});

test('the script follows the heard words forward, passing over what stands nowhere in it', () => {
  const script = wordsOf('Heute zeige ich euch, wie man in drei Minuten eine Aufnahme macht und sie direkt verschickt.');
  assert.equal(followScript(script, []), -1, 'nothing heard yet');
  assert.equal(followScript(script, wordsOf('Heute zeige ich')), 2);
  assert.equal(followScript(script, wordsOf('Okay los, heute zeige ich euch')), 3, 'words before the script are passed over');
  assert.equal(followScript(script, wordsOf('heute zeige ich euch wie man in drei Minuten eine Aufnahmen')), 10, 'a heard ending may differ');
  assert.equal(followScript(script, wordsOf('heute zeige ich euch äh wie man')), 5, 'a filler is passed over');
  assert.equal(followScript(script, wordsOf('heute zeige ich euch die man')), 5, 'a misheard word is skipped, the next one matches');
  assert.equal(followScript(script, wordsOf('heute zeige ich euch Aufnahme')), 10, 'a long word a few words ahead moves the place there');
});

test('a short word counts only as one of the next two script words or right after the heard word before it', () => {
  const script = wordsOf('wir gehen heute in den Park und dann in die Stadt');
  assert.equal(followScript(script, wordsOf('wir gehen')), 1);
  assert.equal(followScript(script, wordsOf('wir gehen die')), 1, '"die" eight words ahead with nothing before it is no proof');
  assert.equal(followScript(script, wordsOf('wir gehen heute in')), 3);
  assert.equal(followScript(script, wordsOf('wir gehen dann in')), 8, '"in" right after the matched "dann"');
});

test('three heard words in a row further on than the look-ahead move the place there (a skipped part)', () => {
  const script = wordsOf(`Am Anfang steht die Begrüßung. ${'Dann kommt ein langer Teil voller Worte. '.repeat(4)}Zum Schluss bedanke ich mich herzlich bei allen.`);
  const end = script.indexOf('herzlich');
  assert.equal(followScript(script, wordsOf('am anfang steht die begrüßung zum schluss bedanke ich mich herzlich')), end);
  assert.equal(followScript(script, wordsOf('am anfang steht die begrüßung ich mich')), 4, 'two short words far ahead are no proof');
});

test('words per minute: the heard words over the length of their pieces, the last half minute, from eight words on', () => {
  assert.equal(wordsPerMinute([]), undefined);
  assert.equal(wordsPerMinute([{ ms: 3000, text: 'eins zwei drei' }]), undefined, 'too few words');
  const pieces = Array.from({ length: 4 }, () => ({ ms: 3000, text: 'eins zwei drei vier fünf sechs sieben' })); // 7 words / 3 s
  assert.equal(wordsPerMinute(pieces), 140);
  assert.equal(wordsPerMinute([...pieces, { ms: 3000, error: 'not heard' }, { ms: 2000, text: '  ' }]), 140, 'pieces without words say nothing');
  const slowThenFast = [...Array.from({ length: 20 }, () => ({ ms: 6000, text: 'langsam gesprochen' })), ...Array.from({ length: 11 }, () => ({ ms: 3000, text: 'eins zwei drei vier fünf sechs sieben acht' }))];
  assert.equal(wordsPerMinute(slowThenFast), 160, 'only about the last half minute counts');
});

test('pace: words per minute become px per second on the script; the pull closes the gap, never backwards', () => {
  assert.equal(prompterPace(120, 10), 20, '2 words/s × 10 px per word');
  assert.equal(prompterPace(150, 8), 20);
  assert.equal(prompterPace(0, 10), 0);
  assert.equal(prompterPace(140, 0), 0, 'an empty script');
  assert.equal(prompterPace(Number.NaN, 10), 0);
  assert.equal(followSpeed(20, 0), 20, 'on the reading line: the speaker\'s pace');
  assert.equal(followSpeed(20, 30), 30, 'behind by 30 px: 10 px/s more');
  assert.equal(followSpeed(20, -30), 10, 'ahead: slower');
  assert.equal(followSpeed(20, -300), 0, 'far ahead: it waits, never scrolls back');
  assert.equal(followSpeed(20, 5000), 160, 'far behind: capped');
  assert.equal(followSpeed(Number.NaN, 10), 0);
});
