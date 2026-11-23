// B-041 track A2: the focus timer and the person's estimate (runtime/day/focus.ts through the day service) – one
// timer at a time, stop adds the time, checking off stops it at the finish, the person's estimate is stored, and
// only the person's own to-dos are touched.
// Owns: checks of day.focus / day.setEstimate and the task.upserted listener only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { agent, dayFixture } from './fixture.ts';

const MIN = 60_000;
const done = { summary: 'Done', evidence: [], verification: 'reported_by_human' as const };

test('start, start again, stop: the time adds up; starting another one stops the running one', async () => {
  const f = dayFixture();
  const [wash, kitchen] = (await f.day.add({ text: 'Wäsche waschen\nKüche aufräumen' }, HUMAN_ID)).tasks;
  const t0 = f.clock.now();
  assert.equal(f.day.focus(wash.id, 'start', HUMAN_ID).timerStartedAt, t0);
  f.clock.advance(5 * MIN);
  assert.equal(f.day.focus(wash.id, 'start', HUMAN_ID).timerStartedAt, t0, 'running already: unchanged');
  const stopped = f.day.focus(wash.id, 'stop', HUMAN_ID);
  assert.deepEqual([stopped.spentMs, stopped.timerStartedAt], [5 * MIN, undefined]);
  assert.equal(f.day.focus(wash.id, 'stop', HUMAN_ID).spentMs, 5 * MIN, 'stopping a stopped timer changes nothing');
  f.day.focus(wash.id, 'start', HUMAN_ID);
  f.clock.advance(2 * MIN);
  f.day.focus(kitchen.id, 'start', HUMAN_ID);
  assert.deepEqual([f.s.tasks.get(wash.id)!.spentMs, f.s.tasks.get(wash.id)!.timerStartedAt], [7 * MIN, undefined], 'one timer at a time');
  assert.equal(f.s.tasks.get(kitchen.id)!.timerStartedAt, f.clock.now());
});

test('checking off stops the timer at the finish', async () => {
  const f = dayFixture();
  for (const minutes of [20, 30]) {
    const [kitchen] = (await f.day.add({ text: 'Küche aufräumen' }, HUMAN_ID)).tasks;
    f.day.focus(kitchen.id, 'start', HUMAN_ID);
    f.clock.advance(minutes * MIN);
    f.s.tasks.finish(kitchen.id, { status: 'done' as const, ...done }, HUMAN_ID);
    const finished = f.s.tasks.get(kitchen.id)!;
    assert.deepEqual([finished.status, finished.spentMs, finished.timerStartedAt], ['done', minutes * MIN, undefined]);
    f.bus.emit('task.upserted', finished); // the same view again teaches nothing more
  }
});

test("only the person's own to-dos: an agent's task, an unknown id and a finished to-do are refused", async () => {
  const f = dayFixture();
  f.org.add(agent('ag_x', 'Mara', { createdAt: 1 }));
  const chat = f.s.chats.create({ agentIds: ['ag_x'], humans: true, createdBy: HUMAN_ID }).id;
  const work = f.s.tasks.create({ conversationId: chat, title: 'Research flights', assigneeKind: 'agent', assigneeId: 'ag_x', createdBy: HUMAN_ID });
  assert.throws(() => f.day.focus(work.id, 'start', HUMAN_ID), { code: 'bad_request' });
  assert.throws(() => f.day.setEstimate(work.id, 30, HUMAN_ID), { code: 'bad_request' });
  assert.throws(() => f.day.focus('task_missing00000', 'start', HUMAN_ID), { code: 'not_found' });
  const [wash] = (await f.day.add({ text: 'Wäsche waschen' }, HUMAN_ID)).tasks;
  f.s.tasks.finish(wash.id, { status: 'done' as const, ...done }, HUMAN_ID);
  assert.throws(() => f.day.focus(wash.id, 'start', HUMAN_ID), { code: 'conflict' });
});
