// KI-Runde 17.11.2026, decision 7.4: what the call voice's plain text means (src/runtime/calls/voice-text.ts) – the tags
// are read out of it and never spoken, and while the model writes, the finished sentences of the part that is already
// speech are what the reader gets (shared/voice/conversation-parts.ts sentencesDone).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVoice, sayableSoFar, sentencesDone } from '../../../src/runtime/calls/voice-text.ts';

test('the tags are read out of the answer and never spoken', () => {
  const whole = readVoice('<as name="Ava">Ich schaue nach, einen Moment. <main now>Stop the deploy.</main>');
  assert.deepEqual(whole, { as: 'Ava', say: 'Ich schaue nach, einen Moment.', now: 'Stop the deploy.' });
  const next = readVoice('Notiere ich.\n<main next>Use blue for the banner.</main>\n');
  assert.deepEqual(next, { say: 'Notiere ich.', next: 'Use blue for the banner.' });
  assert.deepEqual(readVoice('Ja, alles fertig.'), { say: 'Ja, alles fertig.' }, 'plain speech has no tags');
  assert.equal(readVoice('   ').say, '', 'nothing or whitespace is silence');
  assert.equal(readVoice('<as name="">   ').say, '', 'a tag naming nobody and no words: silence');
  assert.equal(readVoice('<as name="Ben">Ok. <main now>a</main><main now>b</main>').now, 'a', 'the first of a kind counts');
  assert.equal(readVoice('Ok <main weird>x</main> dann.').say, 'Ok x dann.', 'an unknown tag is no hand-over, its words are said');
});

// FIXES-3 E1 (18.11.2026): Haiku spoke its silence on an aside ("Das Gespräch ist nicht für mich …"), 2 of 2.
test('silence has a form: an answer with <silent/> says nothing, names nobody and passes nothing on', () => {
  const silent = { say: '', silent: true };
  assert.deepEqual(readVoice('<silent/>'), silent);
  assert.deepEqual(readVoice(' <silent />\n'), silent);
  assert.deepEqual(readVoice('<as name="Ava"><silent/>'), silent, 'nobody speaks, so no listening agent joins');
  assert.deepEqual(readVoice('<silent></silent> <main next>Den Kellerschlüssel suchen</main>'), silent, 'nothing goes on');
  assert.deepEqual(readVoice('Das Gespräch ist nicht für mich. <silent/>'), silent, 'words written before it are silence too');
  assert.equal(sayableSoFar('<sil'), '', 'never read while it is written');
  assert.equal(sayableSoFar('<silent/>'), '');
});

test('while it writes: the part that is already speech, and of it the finished sentences', () => {
  assert.equal(sayableSoFar('<as name="Ava">Ich schaue nach. <main'), 'Ich schaue nach. ');
  assert.equal(sayableSoFar('<as name="Av'), '', 'the opening tag is not finished yet');
  assert.equal(sayableSoFar('<ma'), '', 'a tag being written says nothing');
  assert.equal(sayableSoFar('Ich schaue nach.'), 'Ich schaue nach.');
  assert.equal(sentencesDone('Der Build läuft noch durch. Danach schi'), 'Der Build läuft noch durch.');
  assert.equal(sentencesDone('Der Build läuft'), '', 'no finished sentence yet');
  assert.equal(sentencesDone('Ich prüfe das mit z.B. den Zahlen'), '', 'an abbreviation inside a sentence ends none');
  assert.equal(sentencesDone('Ja, das passt so weit!\nUnd das zweite'), 'Ja, das passt so weit!');
});

// The review's cases (review2/V1-voice/tags.test.ts, r2-2 findings 3, 10 and 11).
test('a hand-over tag that is not closed, closed with other words or written with an underscore is passed on and never said', () => {
  const sure = { say: 'Ich schau nach.', now: 'Find the October numbers' };
  assert.deepEqual(readVoice('Ich schau nach. <main now>Find the October numbers'), sure, 'not closed');
  assert.deepEqual(readVoice('Ich schau nach. <main now>Find the October numbers</main now>'), sure, 'closed with other words');
  assert.deepEqual(readVoice('Ich schau nach. <main_now>Find the October numbers</main_now>'), sure, 'an underscore');
  assert.deepEqual(readVoice('Ok. <main now>a <main next>b'), { say: 'Ok.', now: 'a', next: 'b' }, 'an unclosed tag ends at the next one');
  assert.deepEqual(readVoice('Ich schau nach. <main now>X</main> Bis gleich.'), { say: 'Ich schau nach. Bis gleich.', now: 'X' }, 'words after a closed tag are said');
  const long = 'Ein Satz der lang ist. '.repeat(80).trim();
  assert.equal(readVoice(long).say, long, 'a long answer is not cut below what was read while it streamed');
});

test('common short abbreviations and a dot a lowercase word follows end no sentence', () => {
  assert.equal(sentencesDone('Das dauert noch ca. zehn Minuten. Und'), 'Das dauert noch ca. zehn Minuten.');
  assert.equal(sentencesDone('Das dauert noch ca.'), '', 'while it streams, "ca." is no end');
  assert.equal(sentencesDone('Ich rufe gleich Dr. Weber an'), '');
  assert.equal(sentencesDone('Die Zahl ist 3.5 und das passt so.'), 'Die Zahl ist 3.5 und das passt so.');
  assert.equal(sentencesDone('Wir haben jetzt 12 Stück. Mehr kommt'), 'Wir haben jetzt 12 Stück.');
});
