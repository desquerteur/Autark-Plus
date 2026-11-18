// A silent line moves no row (KI-Runde 17.11.2026, chat/service.ts send and chat/publish-message.ts → nextSeq quiet): a
// status line or an agent's quiet line leaves the chat's lastMessageAt – the list order, the day's chat rank, the row's
// time – where the last line that draws someone set it; an empty default 1:1 stays empty for the list. A loud line moves it.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from './harness.ts';

test('a silent line leaves the chat where it is in the list; a loud line moves it up', () => {
  const h = harness();
  h.org.add(agent('ag_tom', 'Tom'));
  const group = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human', title: 'Mobile apps' });
  const other = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human', title: 'Press' });
  h.clock.advance(1000);
  h.chats.send({ conversationId: group.id, authorId: 'ag_tom', authorKind: 'agent', body: 'The build is live.' });
  const loud = h.chats.get(group.id)!.lastMessageAt;
  h.clock.advance(1000);
  h.chats.send({ conversationId: other.id, authorId: 'human', authorKind: 'human', body: 'Hello' });
  h.clock.advance(1000);
  h.chats.status(group.id, { type: 'note', text: 'Waiting: release · tests run' });
  h.chats.send({ conversationId: group.id, authorId: 'ag_tom', authorKind: 'agent', body: 'Still on the release.', silent: true });
  h.chats.postAgentMessage(group.id, 'ag_tom', 'run_1', { body: 'Noted for later.', silent: true });
  assert.equal(h.chats.get(group.id)!.lastMessageAt, loud, 'three silent lines later the chat keeps its time');
  assert.equal(h.chats.list()[0].id, other.id, 'the chat with the newer loud line stays on top');
  h.clock.advance(1000);
  h.chats.postAgentMessage(group.id, 'ag_tom', 'run_1', { body: 'Done: the release is out.' });
  assert.equal(h.chats.get(group.id)!.lastMessageAt, h.clock.now(), 'a loud line moves it');
  assert.equal(h.chats.list()[0].id, group.id);
});

test('an agent\'s quiet line that names the person is a normal line: unread, it moves the chat, it is no quiet row', () => {
  const h = harness();
  h.org.add(agent('ag_tom', 'Tom'));
  const group = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human', title: 'Backups' });
  const other = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human', title: 'Press' });
  h.clock.advance(1000);
  h.chats.send({ conversationId: other.id, authorId: 'human', authorKind: 'human', body: 'Hello' });
  h.clock.advance(1000);
  const asked = h.chats.send({ conversationId: group.id, authorId: 'ag_tom', authorKind: 'agent', body: '@CEO may I delete the old backups?', silent: true });
  assert.equal(asked.silent, false, 'naming the person makes the quiet line a normal one');
  assert.equal(h.chats.summary(group.id).unread, 1, 'it counts unread');
  assert.equal(h.chats.list()[0].id, group.id, 'it moves the chat up');
  const noted = h.chats.send({ conversationId: group.id, authorId: 'ag_tom', authorKind: 'agent', body: 'Noted for later.', silent: true });
  assert.equal(noted.silent, true, 'a quiet line that names nobody stays quiet');
});
