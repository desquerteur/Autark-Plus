// A finished (done or dropped) task is not reopened by an agent – tasks.update {status} is refused with the way on (a new
// task); the person may still reopen it.
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { agent, center } from '../task-center/fixture.ts';

function setup() {
  const h = center({});
  h.org.add(agent('ag_lea', 'Lea', { role: 'Assistant', createdAt: 1 }));
  return h;
}


test('finished work stays finished for an agent – new work is a new task; the person may reopen it', () => {
  const h = setup();
  const task = h.tasks.create({ title: 'Draft the mail', assigneeKind: 'agent', assigneeId: 'ag_lea', createdBy: HUMAN_ID });
  h.tasks.finish(task.id, { status: 'dropped', summary: 'Not needed any more.' }, HUMAN_ID);
  assert.throws(() => h.tasks.update(task.id, { status: 'open' }, 'ag_lea'), /new work is a new task/);
  assert.equal(h.tasks.update(task.id, { status: 'open' }, HUMAN_ID).status, 'open');
});
