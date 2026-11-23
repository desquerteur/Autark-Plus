// B-080 (wake-routing C, live: 14 reminder runs in a chat their agent had left after B-078 D7 moved the task; no-working
// D): a reminder wakes in its task's chat while its owner is a member there (schedules/fire.ts), moveTaskChat takes the
// schedules set in the task's chat along and announces them (tasks/owners.ts), and a colleague's line handed over from another PC is folded into the running turn like a
// local one – 'important' stays for people's lines (chat/delivery-route.ts deliverHandedOver).
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { deliverHandedOver } from '../../../src/runtime/chat/delivery-route.ts';
import { moveTaskChat } from '../../../src/runtime/tasks/owners.ts';
import { agent, harness } from './harness.ts';

const H = 3_600_000;

test('a reminder on a task moved by moveTaskChat wakes in the task\'s new chat; the schedule row moved with it, one set for another chat stays', () => {
  const h = harness();
  h.org.add(agent('ag_konrad', 'Konrad'));
  h.org.add(agent('ag_lena', 'Lena'));
  const old = h.chats.create({ agentIds: ['ag_konrad', 'ag_lena'], humans: false, createdBy: 'ag_lena' });
  const room = h.chats.create({ agentIds: ['ag_konrad'], createdBy: 'human' });
  const team = h.chats.create({ title: 'Kernteam', agentIds: ['ag_konrad', 'ag_lena'], createdBy: 'human' });
  const task = h.tasks.create({ conversationId: old.id, title: 'Send the proposals', assigneeKind: 'agent', assigneeId: 'ag_konrad', createdBy: 'ag_lena' });
  const at = h.clock.now() + H;
  const reminder = h.scheduler.create({ ownerId: 'ag_konrad', conversationId: old.id, taskId: task.id, kind: 'reminder', title: 'Look again', spec: { at }, payload: { note: 'Look again' } });
  const post = h.scheduler.create({ ownerId: 'ag_konrad', conversationId: team.id, taskId: task.id, kind: 'message', title: 'Status', spec: { at }, payload: { body: 'Status' } });
  const elsewhere = h.scheduler.create({ ownerId: 'ag_konrad', conversationId: team.id, taskId: task.id, kind: 'reminder', title: 'Ask Lena', spec: { at }, payload: { note: 'Ask Lena' } });
  const announced = h.of('schedule.upserted').length;
  moveTaskChat(h.services, task.id, room.id);
  assert.equal(h.tasks.get(task.id)!.conversationId, room.id);
  assert.equal(h.scheduler.get(reminder.id)!.conversationId, room.id, 'the reminder set in the task\'s chat moved with it');
  assert.deepEqual(h.of('schedule.upserted').slice(announced).map((schedule) => [schedule.id, schedule.conversationId]), [[reminder.id, room.id]], 'announced once: other PCs and the Schedules pane follow');
  assert.equal(h.scheduler.get(post.id)!.conversationId, team.id, 'a scheduled post for another chat still posts there');
  h.scheduler.runNow(reminder.id);
  h.scheduler.runNow(elsewhere.id);
  const wakes = h.wakeRows().filter((row) => row.reason === 'schedule');
  assert.deepEqual(wakes.map((row) => [row.note, row.conversation_id]), [['Look again', room.id], ['Ask Lena', room.id]], 'a reminder wakes where its task is now');
  const free = h.scheduler.create({ ownerId: 'ag_konrad', conversationId: team.id, kind: 'reminder', title: 'Without a task', spec: { at }, payload: { note: 'Without a task' } });
  h.scheduler.runNow(free.id);
  assert.equal(h.wakeRows().find((row) => row.note === 'Without a task')!.conversation_id, team.id, 'without a task: where it was set');
});

test('a reminder on a task whose chat its owner is not in wakes where it was set – a manager\'s reminder on a report\'s task', () => {
  const h = harness();
  h.org.add(agent('ag_konrad', 'Konrad'));
  h.org.add(agent('ag_lena', 'Lena', { mode: 'manager' }));
  const team = h.chats.create({ title: 'Kernteam', agentIds: ['ag_konrad', 'ag_lena'], createdBy: 'human' });
  const konrads = h.chats.create({ agentIds: ['ag_konrad'], createdBy: 'human' }); // the owner's 1:1 with Konrad
  const task = h.tasks.create({ conversationId: konrads.id, title: 'Send the proposals', assigneeKind: 'agent', assigneeId: 'ag_konrad', createdBy: 'human' });
  const check = h.scheduler.create({ ownerId: 'ag_lena', conversationId: team.id, taskId: task.id, kind: 'reminder', title: 'Ask Konrad', spec: { at: h.clock.now() + H }, payload: { note: 'Ask Konrad' } });
  h.scheduler.runNow(check.id);
  const wake = h.wakeRows().find((row) => row.note === 'Ask Konrad')!;
  assert.deepEqual([wake.agent_id, wake.conversation_id], ['ag_lena', team.id], 'not in Konrad\'s 1:1, which Lena is not in');
});

test('deliverHandedOver: a colleague\'s un-quiet line handed over from another PC is folded (steer); only a person\'s important line is urgent', () => {
  const h = harness();
  h.org.add(agent('ag_jonas', 'Jonas'));
  h.org.add(agent('ag_nora', 'Nora'));
  const pair = h.chats.create({ agentIds: ['ag_jonas', 'ag_nora'], humans: false, createdBy: 'ag_nora' });
  const calls: string[] = [];
  const s = {
    chats: h.chats, log: h.services.log,
    dispatcher: { urgent: async (agentId: string) => { calls.push(`urgent:${agentId}`); }, steer: async (agentId: string) => { calls.push(`steer:${agentId}`); return true; } },
  } as unknown as Pick<RuntimeServices, 'chats' | 'dispatcher' | 'log'>;
  const seen = () => h.chats.markRead(pair.id, 'ag_jonas', h.chats.messages(pair.id, { limit: 100 }).at(-1)!.seq);
  h.chats.send({ conversationId: pair.id, body: 'noted', authorId: 'ag_nora', silent: true });
  deliverHandedOver(s, 'ag_jonas', pair.id);
  assert.deepEqual(calls, [], 'a quiet line: the wake alone');
  h.chats.send({ conversationId: pair.id, body: 'Stop, YouTube refuses automated access.', authorId: 'ag_nora' });
  deliverHandedOver(s, 'ag_jonas', pair.id);
  assert.deepEqual(calls, ['steer:ag_jonas'], 'before B-080 only a person\'s line was folded');
  seen();
  h.chats.send({ conversationId: pair.id, body: 'Now!', authorId: 'ag_nora', priority: 'important' });
  deliverHandedOver(s, 'ag_jonas', pair.id);
  assert.deepEqual(calls, ['steer:ag_jonas', 'steer:ag_jonas'], 'a colleague\'s important line is folded, not urgent');
  seen();
  h.chats.send({ conversationId: pair.id, body: 'my own line', authorId: 'ag_jonas' });
  deliverHandedOver(s, 'ag_jonas', pair.id);
  assert.equal(calls.length, 2, 'the agent\'s own line: nothing');
});
