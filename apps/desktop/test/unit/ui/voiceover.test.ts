// Voice-over (record block with video + cues; task_2xr88cmc): the lines, the moment, the pace, the tape and the WAV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUE_LIMITS, parseCues, secondsOf } from '../../../src/shared/blocks/cues.ts';
import { SampleTape, encodeWav, momentAt, paceHint, targetWpm, wavSeconds, wordCount } from '../../../src/ui/blocks/ui/voiceover.ts';

const cues = [
  { text: 'Welcome to the drone test.', start: 0, end: 3 },
  { text: 'Here the camera turns to the left and shows the whole valley below.', start: 3.5, end: 9 },
  { text: 'Thanks for watching.', start: 12, end: 14 },
];

test('parseCues: seconds, m:ss and decimal commas; sorted by start; the lines come back trimmed', () => {
  const result = parseCues([
    { text: ' Second ', start: '0:04', end: '0:06,5' },
    { text: 'First', start: 1, end: '3' },
  ]);
  assert.deepEqual(result.cues, [{ text: 'First', start: 1, end: 3 }, { text: 'Second', start: 4, end: 6.5 }]);
  assert.equal(secondsOf('1:02:03.5'), 3723.5);
  assert.equal(secondsOf('abc'), undefined);
});

test('parseCues: the first problem names the line the way the agent wrote it', () => {
  assert.match(parseCues(undefined).problem ?? '', /list of \{text, start, end\}/);
  assert.match(parseCues([]).problem ?? '', /list of/);
  assert.match(parseCues([{ text: 'a', start: 0, end: 1 }, { text: '', start: 1, end: 2 }]).problem ?? '', /^cue 2 has no text/);
  assert.match(parseCues([{ text: 'a', start: 5, end: 5 }]).problem ?? '', /^cue 1 must end after it starts/);
  assert.match(parseCues([{ text: 'a', start: 'x', end: 2 }]).problem ?? '', /^cue 1 needs "start" and "end"/);
  assert.match(parseCues([{ text: 'a', start: -1, end: 2 }]).problem ?? '', /^cue 1 lies outside/);
  assert.match(parseCues([{ text: 'x'.repeat(CUE_LIMITS.text + 1), start: 0, end: 2 }]).problem ?? '', /^cue 1 has 401 characters/);
  assert.match(parseCues(Array.from({ length: CUE_LIMITS.lines + 1 }, (_, i) => ({ text: 'a', start: i, end: i + 1 }))).problem ?? '', /at most 200/);
});

test('parseCues: overlap up to 0.3 s is rounding, more is a problem that names both lines', () => {
  assert.ok(parseCues([{ text: 'a', start: 0, end: 3 }, { text: 'b', start: 2.8, end: 5 }]).cues);
  const bad = parseCues([{ text: 'b', start: 2, end: 5 }, { text: 'a', start: 0, end: 3 }]);
  assert.match(bad.problem ?? '', /^cue 1 starts at 2 s while cue 2 runs until 3 s/);
});

test('momentAt: the line, its progress, the next line and the gaps between', () => {
  assert.deepEqual(momentAt(cues, 1.5), { current: 0, next: 1, fraction: 0.5, remaining: 1.5, waiting: false });
  assert.equal(momentAt(cues, 3).waiting, true, 'at 3.0 the first line is over (end is exclusive), the second starts in 0.5 s');
  assert.deepEqual(momentAt(cues, 3), { current: -1, next: 1, fraction: 0, remaining: 0.5, waiting: true });
  assert.equal(momentAt(cues, 3.5).current, 1);
  assert.equal(momentAt(cues, 13).next, -1, 'the last line has no next');
  assert.deepEqual(momentAt(cues, 20), { current: -1, next: -1, fraction: 0, remaining: 0, waiting: false });
  assert.deepEqual(momentAt(cues, -2).next, 0, 'before the first line it waits for it');
  assert.equal(momentAt(cues, 0).current, 0, 'a line is on from its start second');
});

test('momentAt: two lines that overlap by rounding show the later one', () => {
  const touching = [{ text: 'a', start: 0, end: 3.2 }, { text: 'b', start: 3, end: 5 }];
  assert.equal(momentAt(touching, 3.1).current, 1);
  assert.equal(momentAt(touching, 2.9).current, 0);
});

test('words and pace: a line asks for words per minute, rounded to 5; the hint compares the speaker with it', () => {
  assert.equal(wordCount("Here's the 3 big ones – (really)"), 6);
  assert.equal(targetWpm({ text: 'one two three four five six', start: 0, end: 3 }), 120);
  assert.equal(targetWpm({ text: '…', start: 0, end: 3 }), 0);
  assert.equal(paceHint(120, 90), 'faster');
  assert.equal(paceHint(120, 125), 'on pace');
  assert.equal(paceHint(120, 170), 'slower');
  assert.equal(paceHint(120, undefined), undefined);
  assert.equal(paceHint(0, 100), undefined);
});

test('the tape cuts at the sample the video began; slices cross block borders', () => {
  const tape = new SampleTape(8);
  tape.push(Float32Array.from([0, 1, 2, 3]));
  const began = tape.mark();
  tape.push(Float32Array.from([4, 5, 6]));
  tape.push(Float32Array.from([7, 8, 9, 10]));
  assert.equal(began, 4);
  assert.equal(tape.length, 11);
  assert.deepEqual([...tape.slice(began)], [4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([...tape.slice(2, 6)], [2, 3, 4, 5]);
  assert.deepEqual([...tape.slice(9, 100)], [9, 10]);
  assert.deepEqual([...tape.slice(50)], []);
  assert.deepEqual([...tape.slice(-5, 2)], [0, 1]);
});

test('encodeWav: a 44-byte header, 16-bit mono, clipped samples, exact length', () => {
  const wav = encodeWav(Float32Array.from([0, 1, -1, 2, -2, 0.5]), 48000);
  assert.equal(wav.length, 44 + 12);
  const view = new DataView(wav.buffer);
  const word = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  assert.deepEqual([word(0), word(8), word(12), word(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.equal(view.getUint32(4, true), 36 + 12);
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 96000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767, -32768, 16384]);
  assert.equal(wavSeconds(96000, 48000), 2);
  assert.equal(wavSeconds(10, 0), 0);
});
