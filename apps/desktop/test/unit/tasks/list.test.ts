// TaskService.list with `completedSince` ("Recently done" windows: finished tasks only, newest
// finish first) and reopening clearing `completedAt` so reopened work leaves those windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';

const RESULT = { summary: 'Done', evidence: [{ kind: 'note' as const, label: 'ok' }], verification: 'claimed_by_agent' as const };

function setup() {
  const h = harness();
  h.org.add(agent('ag_ava', 'Ava'));
  const chat = h.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  const make = (title: string) => h.tasks.create({ conversationId: chat.id, title, assigneeId: 'ag_ava', createdBy: 'human' });
  return { ...h, chat, make };
}

test('completedSince: only tasks finished in the window, newest finish first', () => {
  const h = setup();
  const old = h.make('Old');
  const a = h.make('A');
  const b = h.make('B');
  const c = h.make('C');
  const open = h.make('Still open');
  h.tasks.finish(old.id, { status: 'done' as const, ...RESULT }, 'ag_ava');
  h.clock.advance(60_000);
  const since = h.clock.now();
  h.tasks.finish(b.id, { status: 'done' as const, ...RESULT }, 'ag_ava');
  h.clock.advance(1000);
  h.tasks.finish(c.id, { status: 'dropped' as const, summary: 'Dropped' }, 'human');
  h.clock.advance(1000);
  h.tasks.finish(a.id, { status: 'done' as const, ...RESULT }, 'ag_ava');

  const recent = h.tasks.list({ completedSince: since });
  assert.deepEqual(recent.map((task) => task.title), ['A', 'C', 'B'], 'old finished and open tasks are left out');
  assert.deepEqual(h.tasks.list({ completedSince: since, status: ['done'] }).map((task) => task.title), ['A', 'B']);
  assert.deepEqual(h.tasks.list({ completedSince: since, conversationId: h.chat.id, limit: 1 }).map((task) => task.title), ['A']);
  assert.equal(h.tasks.list({ completedSince: h.clock.now() + 1 }).length, 0);
  assert.ok(h.tasks.list().some((task) => task.id === open.id), 'without the filter the board order is unchanged');
  assert.equal(h.tasks.list()[0].id, open.id, 'open work still ranks before finished work');
});

test('reopening a finished task clears completedAt (it leaves the recently-done window)', () => {
  const h = setup();
  const done = h.make('Export');
  const cancelled = h.make('Draft');
  h.tasks.finish(done.id, { status: 'done' as const, ...RESULT }, 'ag_ava');
  h.tasks.finish(cancelled.id, { status: 'dropped' as const, summary: 'Dropped' }, 'human');
  assert.ok(h.tasks.get(done.id)!.completedAt);
  assert.ok(h.tasks.get(cancelled.id)!.completedAt);
  const since = h.clock.now();

  h.clock.advance(1000);
  assert.equal(h.tasks.update(done.id, { status: 'open' as const }, 'human').completedAt, undefined);
  assert.equal(h.tasks.update(cancelled.id, { status: 'open' as const }, 'human').completedAt, undefined); // B-054 fix: only the person reopens what they cancelled
  assert.equal(h.tasks.list({ completedSince: since }).length, 0);
  h.tasks.finish(cancelled.id, { status: 'dropped' as const, summary: 'Dropped' }, 'human');
  assert.equal(h.tasks.get(cancelled.id)!.completedAt, h.clock.now(), 'cancelling again stamps the new time');
});
