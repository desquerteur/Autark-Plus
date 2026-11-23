// Low free space remains information for agents, without an admission gate on main or split lanes.
// The offline-home waiting line still explains messages that belong on another PC.
// Owns: these assertions only. Never: real processes or a full test disk.

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { agent } from '../chat/harness.ts';
import { flush, setup } from './fakes.ts';
import type { SplitService } from '../../../src/runtime/contracts.ts';
import type { SplitTurn } from '../../../src/shared/model/splits.ts';
import { DevicesRepo } from '../../../src/runtime/devices/repo.ts';
import { record } from '../devices/sync-net.ts';

for (const freeMb of [0, 200, 272, 512, 700]) {
  test(`${freeMb} MB free does not pause queued agents or their splits`, async (t) => {
    const probe = mock.method(fs, 'statfsSync', () => ({ bavail: freeMb * 1024 ** 2, bsize: 1 }));
    syncBuiltinESMExports();
    t.after(() => { probe.mock.restore(); syncBuiltinESMExports(); });
    const h = setup();
    t.after(() => h.dispatcher.stop());
    Object.assign(h.services, { paths: { ...(h.services.paths ?? {}), data: 'C:/data' } });
    h.org.add(agent('ag_tom', 'Tom'));
    h.org.add(agent('ag_lea', 'Lea'));
    const a = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
    const b = h.chats.create({ agentIds: ['ag_lea'], createdBy: 'human' });
    h.chats.send({ conversationId: a.id, body: 'make room', authorId: 'human' });
    h.chats.send({ conversationId: b.id, body: 'continue', authorId: 'human' });
    h.dispatcher.start();
    await flush();
    assert.deepEqual(h.executor.calls.map((call) => call.request.agentId).sort(), ['ag_lea', 'ag_tom']);

    const turn: SplitTurn = { splitId: 'sp_1', groupId: 'sg_1', idx: 1, of: 1, title: 'Part one', parentRunId: 'run_parent', parentThread: a.id, context: 'brief', firstTurn: true };
    h.services.splits = {
      turnFor: () => turn, inputFor: () => [], get: () => undefined, onSplitRunEnd: () => {}, afterParentTurn: () => {}, stop: () => 0,
    } as unknown as SplitService;
    assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' }), 'started');
    await flush();
    assert.equal(h.executor.calls.length, 3);
    assert.equal(h.notified.filter((note) => note.kind === 'blocker').length, 0);
    for (const chat of [a, b]) assert.equal(h.chats.messages(chat.id).filter((message) => message.kind === 'status').length, 0);
    assert.equal(probe.mock.callCount(), 0, 'admission does not even query free disk space');
    for (const call of h.executor.calls) call.finish();
    await flush();
  });
}

test('B-079: a line for an agent whose home PC this PC cannot reach gets one status line per chat and offline phase; none while it is online', async () => {
  const h = setup();
  const repo = new DevicesRepo(h.db);
  // B-080: the live link decides – the stored row stays 'online' after a crash or a kill
  const live = new Set<string>();
  Object.assign(h.services, { devices: { online: (id: string) => live.has(id) } });
  repo.upsert(record('dev_here', { self: true, name: 'notebook' }));
  repo.upsert(record('dev_server', { name: 'office-pc', status: 'online', lastSeenAt: 1000 }));
  h.org.add(agent('ag_lena', 'Lena', { deviceId: 'dev_server' }));
  const chat = h.chats.create({ agentIds: ['ag_lena'], createdBy: 'human' });
  const lines = () => h.chats.messages(chat.id, { limit: 50 }).filter((message) => message.kind === 'status').map((message) => message.body);
  h.dispatcher.start();
  h.chats.send({ conversationId: chat.id, body: 'Ist das Temperatur-Routing wirklich eingebaut?', authorId: 'human' });
  await flush();
  h.chats.send({ conversationId: chat.id, body: '?', authorId: 'human' });
  await flush();
  assert.equal(h.executor.calls.length, 0, 'her home PC runs her turns');
  assert.deepEqual(lines(), ['Lena works on office-pc, which this PC cannot reach right now – the message goes over as soon as it is back.'], 'once per offline phase, although the stored row says online');
  live.add('dev_server');
  repo.patch('dev_server', { status: 'online', lastSeenAt: 2000 });
  h.chats.send({ conversationId: chat.id, body: 'und jetzt?', authorId: 'human' });
  await flush();
  assert.equal(lines().length, 1, 'online: nothing to say');
  live.delete('dev_server');
  repo.patch('dev_server', { status: 'offline', lastSeenAt: 3000 });
  h.chats.send({ conversationId: chat.id, body: 'hallo?', authorId: 'human' });
  await flush();
  assert.equal(lines().length, 2, 'a new offline phase says it again');
  await h.dispatcher.stop();
});
