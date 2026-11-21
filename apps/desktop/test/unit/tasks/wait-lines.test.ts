// Task status lines (tasks/lifecycle.ts changed, chat/delivery-route.ts, KI-Runde 17.11.2026): a wait whose reason
// changed replaces the task's last wait line instead of adding one; a task that waits on the person stays waiting when
// they write – its owner is woken with it and moves it – while a colleague's line it waits on opens it.
// Owns: these assertions only. Never: engines or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';
import { findOrCreateDirect } from '../../../src/runtime/chat/direct.ts';

const waitOn = (who: string, why: string) => ({ status: 'waiting' as const, waitingOn: { on: 'who' as const, who, why } });

function setup() {
  const h = harness();
  h.org.add(agent('ag_ava', 'Ava'));
  h.org.add(agent('ag_bob', 'Bob'));
  const direct = findOrCreateDirect(h.services, 'human', 'ag_ava', { createdBy: 'human' });
  const task = h.tasks.create({ conversationId: direct, title: 'Social media start', assigneeId: 'ag_ava', createdBy: 'human' });
  const lines = () => h.chats.messages(direct, { limit: 100 }).filter((message) => message.kind === 'status' && message.meta.status?.details?.taskId === task.id).map((message) => message.body);
  return { h, direct, task, lines };
}

test('a wait whose reason changed replaces its last line; a new wait after an open adds one', () => {
  const { h, task, lines } = setup();
  h.tasks.update(task.id, waitOn('ag_bob', 'Bob gathers the accounts'), 'ag_ava');
  h.tasks.update(task.id, waitOn('ag_bob', 'Four strands run overnight'), 'ag_ava');
  h.tasks.update(task.id, waitOn('ag_bob', 'Two strands left'), 'ag_ava');
  assert.deepEqual(lines(), ['Waiting: Social media start · Two strands left'], 'one line per wait, with the newest reason');
  h.tasks.update(task.id, { status: 'open' }, 'ag_ava');
  h.tasks.update(task.id, waitOn('ag_bob', 'Last check'), 'ag_ava');
  assert.deepEqual(lines(), ['Waiting: Social media start · Two strands left', 'Open again: Social media start', 'Waiting: Social media start · Last check']);
});

test('a line of the person a task waits on wakes its owner with the task and leaves it waiting; a colleague\'s line opens it', () => {
  const { h, direct, task, lines } = setup();
  h.tasks.update(task.id, waitOn('human', 'Which account?'), 'ag_ava');
  h.chats.send({ conversationId: direct, authorId: 'human', authorKind: 'human', body: 'The company one' });
  assert.equal(h.tasks.get(task.id)!.status, 'waiting', 'the owner moves it, not the person\'s line');
  assert.ok(h.wakeRows().some((row) => row.agent_id === 'ag_ava' && row.task_id === task.id), 'the owner is woken with the task');
  assert.equal(lines().length, 1, 'no "Open again" line');

  const room = findOrCreateDirect(h.services, 'ag_ava', 'ag_bob', { createdBy: 'ag_ava' });
  const piece = h.tasks.create({ conversationId: room, title: 'Logo', assigneeId: 'ag_ava', createdBy: 'ag_ava' });
  h.tasks.update(piece.id, waitOn('ag_bob', 'The logo file'), 'ag_ava');
  h.chats.send({ conversationId: room, authorId: 'ag_bob', authorKind: 'agent', body: 'Here is the logo.' });
  assert.equal(h.tasks.get(piece.id)!.status, 'open', 'a colleague\'s line it waits on opens it');
});
