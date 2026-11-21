// B-054 (owner 29.10.2026 "To-dos gehören ja nicht zum Chat"): TaskService.create without a chat
// (src/runtime/tasks/create.ts) – no anchor, nobody joins a chat, space from the parent or the
// creating agent, origin from the input / the creating run / the person; a step takes its parent's chat
// only when its creator is a member there; a colleague gets chat-free work only from the owner; the
// anchor send failing removes the task again (compensation). Also no status lines for chat-free tasks
// (TaskService.line, P12), an always-woken assigner (tasks/assigner.ts) and taskSpace (tasks/space.ts).
// Owns: these assertions only. Never: real timers or model calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';
import { HUMAN_ID, SYSTEM_ID } from '../../../src/shared/ids.ts';
import { taskSpace } from '../../../src/runtime/tasks/space.ts';
import type { ChatService } from '../../../src/runtime/contracts.ts';
import { findDirect } from '../../../src/runtime/chat/direct.ts';

function setup() {
  const h = harness();
  h.org.add(agent('ag_mara', 'Mara', { mode: 'manager', createdAt: 1, spaceId: 'spc_home' }));
  h.org.add(agent('ag_tom', 'Tom', { managerId: 'ag_mara', createdAt: 2 }));
  const messages = () => h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages')!.n;
  const memberships = () => h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM members')!.n;
  return { ...h, messages, memberships };
}

test('a task for an agent without a chat: no anchor, no chat joined, origin todo-list, woken on the task only', () => {
  const h = setup();
  const chats = h.chats.list().length;
  const [messages, memberships] = [h.messages(), h.memberships()];
  const task = h.tasks.create({ title: 'Summarise the Travel Desk items', assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: HUMAN_ID });
  assert.equal(task.conversationId, undefined);
  assert.equal(task.messageId, undefined, 'no anchor message');
  assert.equal(task.conversationTitle, '');
  assert.deepEqual(task.origin, { source: 'todo-list', label: 'To-do area' });
  assert.equal(task.spaceId, undefined, 'the person has no space of their own');
  assert.deepEqual([h.chats.list().length, h.messages(), h.memberships()], [chats, messages, memberships], 'no chat, no message, nobody joined');
  assert.deepEqual(h.wakeRows().map((row) => [row.agent_id, row.reason, row.conversation_id, row.task_id]), [['ag_mara', 'task', null, task.id]]);
  assert.equal(h.tasks.get(task.id)?.conversationId, undefined, 'the stored row has no chat');
});

test('space: the creating agent\'s, else the parent\'s; origin: the input, else the creating run\'s, else system', () => {
  const h = setup();
  const own = h.tasks.create({ title: 'Reply to Maria', createdBy: 'ag_mara', assigneeId: 'ag_mara' });
  assert.equal(own.spaceId, 'spc_home', 'the creating agent\'s space');
  assert.deepEqual(own.origin, { source: 'system', label: 'System' }, 'no run, no input: system');
  assert.equal(taskSpace(h.services, own), 'spc_home');
  const step = h.tasks.create({ title: 'Look up the price', createdBy: 'ag_tom', assigneeId: 'ag_tom', parentId: own.id });
  assert.equal(step.spaceId, 'spc_home', 'a sub-task keeps its parent\'s space');
  h.running.push({ agentId: 'ag_tom', runId: 'run_1', note: '', startedAt: 0, origin: { source: 'app:mail_1', label: 'New mail in office@example.com' } });
  const fromMail = h.tasks.create({ title: 'Offer by Friday', createdBy: 'ag_tom', assigneeId: 'ag_tom' });
  assert.deepEqual(fromMail.origin, { source: 'app:mail_1', label: 'New mail in office@example.com' }, 'the creating run\'s origin');
  const given = h.tasks.create({ title: 'Approve', assigneeKind: 'human', createdBy: SYSTEM_ID, origin: { source: 'approvals', label: '  Mara: Delete item 8  ' } });
  assert.deepEqual(given.origin, { source: 'approvals', label: 'Mara: Delete item 8' }, 'the caller\'s, cleaned');
});

test('a chat keeps working as before: the anchor is posted; an owner outside a chat of the person gets it in the 1:1 of the giver (KI-Runde 17.11.2026); a missing chat is still refused', () => {
  const h = setup();
  const chat = h.chats.create({ title: 'Launch', agentIds: ['ag_tom'], createdBy: HUMAN_ID });
  const task = h.tasks.create({ conversationId: chat.id, title: 'Prepare the offer', assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: HUMAN_ID });
  assert.equal(task.conversationId, findDirect(h.services, HUMAN_ID, 'ag_mara'), 'a chat of the person keeps its members: the work is in their 1:1 with Mara');
  assert.ok(task.messageId, 'anchored');
  assert.equal(h.chats.message(task.messageId!)?.kind, 'task');
  assert.ok(!h.chats.members(chat.id).some((member) => member.memberId === 'ag_mara'), 'nobody is seated in a chat of the person');
  assert.equal(h.tasks.create({ conversationId: chat.id, title: 'Draft', assigneeKind: 'agent', assigneeId: 'ag_tom', createdBy: HUMAN_ID }).conversationId, chat.id, 'a member keeps the chat');
  assert.equal(task.origin, undefined, 'a chat task needs no origin');
  assert.throws(() => h.tasks.create({ conversationId: 'conv_missing', title: 'x', createdBy: HUMAN_ID }), /Chat not found/);
});

test('a step takes its parent\'s chat only when its creator is a member there', () => {
  const h = setup();
  const chat = h.chats.create({ title: 'Private plans', agentIds: ['ag_tom'], createdBy: HUMAN_ID });
  const parent = h.tasks.create({ conversationId: chat.id, title: 'Plan the holiday', assigneeId: 'ag_tom', createdBy: HUMAN_ID });
  const inside = h.tasks.create({ title: 'Book the hotel', assigneeId: 'ag_tom', createdBy: 'ag_tom', parentId: parent.id });
  assert.equal(inside.conversationId, chat.id, 'a member\'s sub-task stays in the chat');
  const outside = h.tasks.create({ title: 'Check the budget', assigneeId: 'ag_mara', createdBy: 'ag_mara', parentId: parent.id });
  assert.equal(outside.conversationId, undefined, 'a non-member\'s sub-task is chat-free');
  assert.ok(!h.chats.members(chat.id).some((member) => member.memberId === 'ag_mara'), 'and nobody was brought into the chat');
});


test('the anchor send failing removes the task and its steps again (compensation) and re-throws', () => {
  const h = setup();
  const chat = h.chats.create({ title: 'Launch', agentIds: ['ag_tom'], createdBy: HUMAN_ID });
  const before = h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n;
  const send = h.chats.send.bind(h.chats);
  (h.chats as unknown as { send: ChatService['send'] }).send = () => { throw new Error('delivery down'); };
  assert.throws(() => h.tasks.create({ conversationId: chat.id, title: 'Prepare', plan: ['One', 'Two'], createdBy: HUMAN_ID, assigneeId: 'ag_tom' }), /delivery down/);
  (h.chats as unknown as { send: ChatService['send'] }).send = send;
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n, before, 'no row and no step left behind');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks_fts WHERE tasks_fts MATCH 'Prepare'")!.n, 0, 'no search rows either');
});

