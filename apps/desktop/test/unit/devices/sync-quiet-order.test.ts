// A silent line keeps the chat's place on every PC (KI-Runde 17.11.2026, contract 5.4): the messages intake of the row
// sync (devices/sync/tables.ts) takes a line's own silence with it, so a status line or an agent's quiet line written on
// one PC leaves the chat's lastMessageAt – and the list order – alone on the PC it arrives at, as on the PC it was
// written on. A loud line moves it on both.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { link, makePc, Net, settle } from './sync-net.ts';

test('a silent line that arrives from another PC moves no row there; a loud one does', async () => {
  const net = new Net();
  const a = makePc(net, 'dev_a');
  const b = makePc(net, 'dev_b');
  link(a, b);
  for (const pc of [a, b]) pc.h.org.add(agent('ag_mara', 'Mara', { deviceId: 'dev_a' }));
  const work = a.h.chats.create({ agentIds: ['ag_mara'], createdBy: 'human', title: 'Release' });
  const press = a.h.chats.create({ agentIds: ['ag_mara'], createdBy: 'human', title: 'Press' });
  a.h.clock.advance(1000);
  a.h.chats.send({ conversationId: work.id, authorId: 'ag_mara', authorKind: 'agent', body: 'The build is live.' });
  a.h.clock.advance(1000);
  a.h.chats.send({ conversationId: press.id, authorId: 'human', authorKind: 'human', body: 'Hello' });
  await settle();
  const quiet = b.h.chats.get(work.id)!.lastMessageAt ?? 0;

  a.h.clock.advance(1000);
  a.h.chats.status(work.id, { type: 'note', text: 'Waiting: tests run' });
  a.h.chats.send({ conversationId: work.id, authorId: 'ag_mara', authorKind: 'agent', body: 'Still on the release.', silent: true });
  await settle();
  assert.equal(b.h.chats.messages(work.id).length, 3, 'both silent lines arrived');
  assert.equal(b.h.chats.get(work.id)!.lastMessageAt, quiet, 'they leave the chat\'s time where the loud line set it');
  assert.deepEqual(b.h.chats.list().map((chat) => chat.id), a.h.chats.list().map((chat) => chat.id), 'both PCs show the same order');

  a.h.clock.advance(1000);
  a.h.chats.send({ conversationId: work.id, authorId: 'ag_mara', authorKind: 'agent', body: 'Done: 0.4.0 is out.' });
  await settle();
  assert.ok((b.h.chats.get(work.id)!.lastMessageAt ?? 0) > quiet, 'a loud line moves it');
  assert.deepEqual(b.h.chats.list().map((chat) => chat.id), a.h.chats.list().map((chat) => chat.id));
});
