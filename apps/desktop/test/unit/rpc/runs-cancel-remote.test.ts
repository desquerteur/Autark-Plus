// runs.cancel and agents.activity with the person's other PCs (src/runtime/rpc/handlers/org.ts, devices/sync/live.ts;
// feedback F10/F21 16.11.2026): a run of this PC stops here; a run only another PC's live state names goes to that PC
// (sync.live.cancel); a run nobody has stays not_found; agents.activity and the agent.activity event windows hear list
// the other PC's runs with its deviceId.
// Owns: these assertions only. Never: a real mesh or engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../../../src/shared/ids.ts';
import type { AgentActivity } from '../../../src/shared/model/runs.ts';
import type { DeviceService } from '../../../src/runtime/contracts.ts';
import { chatLiveOf } from '../../../src/runtime/chat/live.ts';
import { CANCEL_METHOD, LiveSync, bindLiveSync } from '../../../src/runtime/devices/sync/live.ts';
import { agent } from '../chat/harness.ts';
import { OWNER, TestClient, rpcFixture, settle } from './s1-helpers.ts';

function setup() {
  const f = rpcFixture();
  f.org.add(agent('ag_ava', 'Ava'));
  const chat = f.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  const calls: Array<{ peer: string; method: string; params: unknown }> = [];
  f.services.devices = {
    online: () => true,
    call: async (peer: string, method: string, params: unknown) => { calls.push({ peer, method, params }); return { ok: true }; },
  } as unknown as DeviceService;
  const live = chatLiveOf(f.bus)!;
  bindLiveSync(f.services, new LiveSync(f.services, live, async () => false, 0));
  const remote: AgentActivity = { agentId: 'ag_ava', runId: 'run_there', conversationId: chat.id, note: 'editing', startedAt: 5 };
  live.setRemote('pc_server', [{ activity: remote, chats: [chat.id] }]);
  return { ...f, chat, calls, owner: new TestClient(f.server, OWNER) };
}

test('runs.cancel: this PC\'s run stops here, another PC\'s run goes to that PC, an unknown run is not found', async (t) => {
  const f = setup();
  t.after(f.cleanup);
  const run = f.services.runs.start({ id: newId('run'), agentId: 'ag_ava', conversationId: f.chat.id, trigger: 'message' });
  await f.owner.call('runs.cancel', { runId: run.id });
  assert.deepEqual(f.dispatcher.interrupts, [{ agentId: 'ag_ava', conversationId: f.chat.id }], 'stopped here');
  assert.deepEqual(f.calls, [], 'no other PC asked');
  await f.owner.call('runs.cancel', { runId: 'run_there' });
  assert.deepEqual(f.calls, [{ peer: 'pc_server', method: CANCEL_METHOD, params: { runId: 'run_there' } }], 'the PC that runs it stops it');
  assert.equal((await f.owner.request('runs.cancel', { runId: 'run_missing' })).error?.code, 'not_found');
  assert.equal(f.calls.length, 1);
});

test('agents.activity and the agent.activity event list the other PC\'s runs with its deviceId', async (t) => {
  const f = setup();
  t.after(f.cleanup);
  f.dispatcher.active = [{ agentId: 'ag_ava', runId: 'run_here', note: '', startedAt: 9 }];
  const listed = await f.owner.call<AgentActivity[]>('agents.activity');
  assert.deepEqual(listed.map((entry) => [entry.runId, entry.deviceId]), [['run_here', undefined], ['run_there', 'pc_server']]);
  await f.owner.call('events.subscribe', { topics: ['org'] });
  f.bus.emit('agent.activity', { active: f.dispatcher.active });
  await settle();
  const heard = f.owner.events('agent.activity').at(-1)?.data as { active: AgentActivity[] } | undefined;
  assert.deepEqual(heard?.active.map((entry) => [entry.runId, entry.deviceId]), [['run_here', undefined], ['run_there', 'pc_server']]);
});
