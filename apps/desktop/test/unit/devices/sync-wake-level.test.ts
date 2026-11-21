// 07.11.2026 (Befund qa-2026-11-07: Stanislaus' important line from the notebook neither cut nor reached Jonas' running
// turn on the server): a message's wake handed over to the agent's home PC (devices/sync/rows.ts wakeHere) is delivered
// there by the line's level – important → dispatcher.urgent, normal → dispatcher.steer, quiet → the wake alone.
// Owns: these assertions only. Never: a real mesh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { link, makePc, Net, settle } from './sync-net.ts';

test('a line written on another PC reaches the agent\'s turn on its home PC by its level', async () => {
  const net = new Net();
  const notebook = makePc(net, 'dev_notebook');
  const server = makePc(net, 'dev_server');
  link(notebook, server);
  for (const pc of [notebook, server]) pc.h.org.add(agent('ag_jonas', 'Jonas', { deviceId: 'dev_server' }));
  const calls: string[] = [];
  Object.assign(server.h.services.dispatcher, {
    urgent: async (agentId: string, chatId: string) => { calls.push(`urgent:${agentId}:${chatId}`); },
    steer: async (agentId: string, chatId: string) => { calls.push(`steer:${agentId}:${chatId}`); return false; },
  });
  const chat = notebook.h.chats.create({ agentIds: ['ag_jonas'], createdBy: 'human' });

  notebook.h.chats.send({ conversationId: chat.id, authorId: 'human', body: 'Bitte schau dir das an' });
  await settle();
  assert.deepEqual(calls, [`steer:ag_jonas:${chat.id}`], 'normal: folded into the running turn at its next step');
  assert.equal(server.h.wakes.pending('ag_jonas'), 1, 'and the wake waits on the server');

  notebook.h.chats.send({ conversationId: chat.id, authorId: 'human', body: 'Wichtig: sofort', priority: 'important' });
  await settle();
  assert.deepEqual(calls.at(-1), `urgent:ag_jonas:${chat.id}`, 'important: the server cuts the turn at its next step');

  const before = calls.length;
  server.h.chats.markRead(chat.id, 'ag_jonas', server.h.chats.messages(chat.id).at(-1)!.seq);
  notebook.h.chats.send({ conversationId: chat.id, authorId: 'human', body: 'nur zur Info', silent: true, mentions: ['ag_jonas'] });
  await settle();
  assert.equal(calls.length, before, 'quiet: the wake alone');
});
