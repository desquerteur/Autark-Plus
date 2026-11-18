// The card of a new task (tasks/create.ts anchorTask, KI-Runde 17.11.2026): a task an agent owns is posted silent – it
// stands in the chat for whoever looks, counts nothing unread and notifies nobody; a task for the person stays loud.
// Owns: these assertions only. Never: engines or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';
import { findOrCreateDirect } from '../../../src/runtime/chat/direct.ts';

test('an agent\'s own task card is silent; a to-do for the person is a loud card', () => {
  const h = harness();
  h.org.add(agent('ag_ava', 'Ava'));
  const direct = findOrCreateDirect(h.services, 'human', 'ag_ava', { createdBy: 'human' });
  const own = h.tasks.create({ conversationId: direct, title: 'Sort the backlog', assigneeId: 'ag_ava', createdBy: 'ag_ava' });
  const card = h.chats.messages(direct).find((message) => message.id === own.messageId)!;
  assert.equal(card.kind, 'task');
  assert.equal(card.silent, true, 'the agent\'s own card is silent');
  assert.equal(h.chats.summary(direct).unread, 0, 'nothing counts unread');
  assert.equal(h.notified.length, 0, 'nobody is notified');

  const todo = h.tasks.create({ conversationId: direct, title: 'Sign the contract', assigneeKind: 'human', createdBy: 'ag_ava' });
  const ask = h.chats.messages(direct).find((message) => message.id === todo.messageId)!;
  assert.equal(ask.silent, false, 'a task for the person stays loud');
  assert.equal(h.chats.summary(direct).unread, 1);
});

test('the person handing an agent work themselves is a loud card: it moves their chat and a colleague sees it', () => {
  const h = harness();
  h.org.add(agent('ag_ava', 'Ava'));
  const group = h.chats.create({ agentIds: ['ag_ava'], createdBy: 'human', title: 'Mobile apps' });
  h.clock.advance(1000);
  h.chats.send({ conversationId: group.id, authorId: 'human', authorKind: 'human', body: 'Morgen' });
  const spoke = h.chats.get(group.id)!.lastMessageAt ?? 0;
  h.clock.advance(1000);
  const given = h.tasks.create({ conversationId: group.id, title: 'Cut the trailer', assigneeId: 'ag_ava', createdBy: 'human' });
  const card = h.chats.messages(group.id).find((message) => message.id === given.messageId)!;
  assert.equal(card.silent, false, 'the person\'s own act stays loud');
  assert.ok((h.chats.get(group.id)!.lastMessageAt ?? 0) > spoke, 'it moves their chat');

  const own = h.tasks.create({ conversationId: group.id, title: 'Sort the backlog', assigneeId: 'ag_ava', createdBy: 'ag_ava' });
  assert.equal(h.chats.messages(group.id).find((message) => message.id === own.messageId)!.silent, true, 'an agent\'s own bookkeeping card stays silent');
});
