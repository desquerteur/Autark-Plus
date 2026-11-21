// B-086 (live 05.–09.11.: a done-criterion stood in 31 of 170 splits; no return path showed the origin its brief beside
// the result): under each part's head in the origin's "Split results" block and in agents.split_results stands
// "Asked: <brief>", with " → back: <returns>" when the part was told what to bring back (splits/results.ts askedLine);
// a dependant's notes and agents.split_results {steps} keep their heads as they were.
// Owns: these checks. Never: an engine or the real dispatcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askedLine } from '../../../src/runtime/splits/results.ts';
import { CHAT, part, splitAndEnd, world } from './fixture.ts';

test('askedLine: the brief on one line, cut at 300 characters; returns after an arrow, cut at 160', () => {
  assert.equal(askedLine({ brief: 'Check the docs\n  for dead links.' }), 'Asked: Check the docs for dead links.');
  assert.equal(askedLine({ brief: 'Check the docs.', returns: 'A list of dead links' }), 'Asked: Check the docs. → back: A list of dead links');
  const long = askedLine({ brief: 'b'.repeat(4000), returns: 'r'.repeat(400) });
  assert.equal(long, `Asked: ${'b'.repeat(299)}… → back: ${'r'.repeat(159)}…`);
});

test('the origin reads each part\'s brief under its head, in the block and in agents.split_results', () => {
  const w = world();
  const groupId = splitAndEnd(w, [part('Docs', { returns: 'dead links' }), part('Tests')]);
  const [docs, tests] = w.lanes.started;
  w.lanes.end(docs, 'done', { answer: 'Two dead links.' });
  w.lanes.end(tests, 'done', { answer: 'All green.' });
  const block = w.splits.pendingResults('ag_ava', CHAT)!.text;
  assert.match(block, /### #1 Docs – done · [^\n]+\nAsked: Do docs\. → back: dead links\nTwo dead links\./);
  assert.match(block, /### #2 Tests – done · [^\n]+\nAsked: Do tests\.\nAll green\./, 'no returns: no arrow');
  assert.match(w.splits.results('ag_ava', { groupId, idx: 1 }), /### #1 Docs – done · [^\n]+\nAsked: Do docs\. → back: dead links\nTwo dead links\.$/);
});

test('a dependant\'s notes keep the plain head – the brief is its origin\'s', () => {
  const w = world();
  splitAndEnd(w, [part('Collect'), part('Sum', { after: [1] })]);
  w.lanes.end(w.lanes.started[0], 'done', { answer: 'Collected: 42 rows' });
  const second = w.lanes.turns.find((entry) => entry.turn.idx === 2)!;
  const deps = second.notes.find((note) => note.text.startsWith('Results of the parts mine builds on'))!;
  assert.doesNotMatch(deps.text, /^Asked:/m);
});
