// A routine's task is made by the schedule, not in a turn of mine: the wake that starts it says what it is, also when the
// routine has no note of its own (wave-3b review R5 – tasks/give.ts gives work an agent "gives itself" a bare wake, and a
// routine's task carries the agent as its maker). Owns: these assertions only. Never: real timers or models.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';
import { fireSchedule } from '../../../src/runtime/schedules/fire.ts';

const NINE = Date.UTC(2026, 9, 17, 9, 0, 0);

test('a routine without a note of its own wakes its agent with the task it made, not a bare wake (wave-3b review R5)', () => {
  const h = harness();
  h.org.add(agent('ag_tom', 'Tom'));
  const routine = h.scheduler.create({
    ownerId: 'ag_tom', kind: 'routine', title: 'Support inbox', spec: { everyMs: 30 * 60_000, tz: 'UTC' }, payload: { taskTemplate: { title: 'Check the support inbox' } },
  });
  fireSchedule(routine, NINE, h.services);
  const wakes = h.wakes.list('ag_tom').filter((wake) => wake.claimedAt === undefined && wake.taskId);
  assert.equal(wakes.length, 1, 'one wake starts the occurrence');
  assert.match(wakes[0].note ?? '', /Check the support inbox/, 'the wake says which work it starts');
});
