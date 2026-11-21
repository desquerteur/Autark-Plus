// B-080 – a part that waits says why (runtime/splits/runner.ts noteWaiting, results.ts QUEUED_TEXT and statusText,
// the agent's results): every ready part starts at once up to the agent's SPLIT_LIMITS.runningPerAgent; one beyond it is
// queued with QUEUED_TEXT as its reason (one write), cleared when it starts; the agent reads it in its own words, a part
// waiting for an account reads so.
// Owns: these checks. Never: an engine or the real dispatcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPLIT_LIMITS } from '../../../src/shared/model/splits.ts';
import { QUEUED_TEXT } from '../../../src/runtime/splits/results.ts';
import { WAIT_TEXT } from '../../../src/runtime/splits/holds.ts';
import { part, splitAndEnd, world } from './fixture.ts';

test('a 6-part group: four run at once, two wait with the reason; it is cleared when one starts', () => {
  const w = world();
  const groupId = splitAndEnd(w, Array.from({ length: 6 }, (_, index) => part(`P${index + 1}`)));
  const view = () => w.splits.list({ groupId })[0];
  assert.equal(SPLIT_LIMITS.runningPerAgent, 4);
  assert.deepEqual(view().splits.map((split) => [split.idx, split.status, split.error]), [
    [1, 'running', undefined], [2, 'running', undefined], [3, 'running', undefined], [4, 'running', undefined],
    [5, 'queued', QUEUED_TEXT], [6, 'queued', QUEUED_TEXT],
  ]);
  assert.match(QUEUED_TEXT, /^4 of its agent's parts run at once; it starts as soon as one ends\.$/);

  // One write per part: a pump that changes nothing announces nothing.
  const announced = w.of('split.upserted').length;
  w.splits.pump();
  assert.equal(w.of('split.upserted').length, announced);

  // The agent reads the reason in its own words.
  const text = w.splits.results('ag_ava', { groupId });
  assert.match(text, /### #5 P5 – waiting – 4 of my parts run at once; this one starts when one ends/);
  assert.match(text, /6 parts: 4 running, 2 queued/);

  // One part ends: the fifth starts at once and its reason goes; the sixth still waits with it.
  w.lanes.end(w.lanes.started[0], 'done', { answer: 'P1 done.' });
  const [fifth, sixth] = view().splits.slice(4);
  assert.deepEqual([fifth.status, fifth.error], ['running', undefined]);
  assert.deepEqual([sixth.status, sixth.error], ['queued', QUEUED_TEXT]);
  while (w.lanes.lanes.size) w.lanes.end([...w.lanes.lanes.keys()][0], 'done', { answer: 'ok' });
  assert.equal(view().splits.every((split) => split.status === 'done' && split.error === undefined), true);
});

test('queued for another reason: an account, a retry, or nothing yet – each in my words; a reason already set stays', () => {
  const w = world();
  w.lanes.answers = ['busy'];
  const groupId = splitAndEnd(w, [part('A'), part('B')]);
  const [a, b] = w.splits.list({ groupId })[0].splits;
  assert.deepEqual([a.status, a.error], ['queued', undefined], "the dispatcher's 'busy' is no cap of its own: no reason written");
  assert.match(w.splits.results('ag_ava', { groupId }), /### #1 A – not started yet/);
  w.deps.repo.updateSplit(a.id, { error: WAIT_TEXT });
  w.deps.repo.updateSplit(b.id, { error: 'The attempt failed; the part runs once more.' });
  const text = w.splits.results('ag_ava', { groupId });
  assert.match(text, /### #1 A – waiting for an account/);
  assert.match(text, /### #2 B – waiting – The attempt failed; the part runs once more\./);

  // A part beyond the four that already carries a reason keeps it.
  const v = world();
  const group = v.splits.create(v.ctx(), { goal: 'Many', parts: Array.from({ length: 5 }, (_, index) => part(`Q${index + 1}`)) });
  v.deps.repo.updateSplit(group.splits[4].id, { error: 'The attempt failed; the part runs once more.' });
  v.runs.finish('run_parent', { status: 'done', endedAt: v.clock.now() });
  v.splits.afterParentTurn('run_parent', 'done');
  assert.deepEqual(v.splits.list({ groupId: group.id })[0].splits.map((split) => split.error), [undefined, undefined, undefined, undefined, 'The attempt failed; the part runs once more.']);
});
