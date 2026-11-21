// Live work between the CEO's own PCs (src/runtime/devices/sync/live.ts, chat/live.ts; feedback F10/F21 16.11.2026):
// what A runs shows in B's live bar and chat list (deviceId A) and in what B's windows hear as agent.activity, a step
// and the end follow, A's state leaves B when the link goes, an employee's PC is refused, a Stop on B reaches A's
// dispatcher, a PC without the method (an older version) is asked again only after its next link-up, and a message lost
// while the link stays goes once more.
// Owns: these assertions only. Never: network, Electron, engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkforceError } from '../../../src/shared/errors.ts';
import type { AgentActivity, RunItem } from '../../../src/shared/model/runs.ts';
import { allActivity, chatLiveOf } from '../../../src/runtime/chat/live.ts';
import { CANCEL_METHOD, LIVE_METHOD, LiveSync, shareOf } from '../../../src/runtime/devices/sync/live.ts';
import { agent } from '../chat/harness.ts';
import { Net, link, makePc, record, settle, type Pc } from './sync-net.ts';

function withLive(pc: Pc, cancelled: string[]) {
  const live = new LiveSync(pc.h.services, chatLiveOf(pc.h.bus)!, async (runId) => { cancelled.push(runId); return runId.startsWith('run_'); }, 0);
  pc.handlers.set(LIVE_METHOD, async (params, from) => live.receive(params, from));
  pc.handlers.set(CANCEL_METHOD, (params, from) => live.cancel(params, from));
  live.attach();
  return live;
}

function setup() {
  const net = new Net();
  const a = makePc(net, 'pc_a');
  const b = makePc(net, 'pc_b');
  link(a, b);
  for (const pc of [a, b]) pc.h.org.add(agent('ag_tom', 'Tom'));
  const cancelledA: string[] = [];
  const liveA = withLive(a, cancelledA);
  const liveB = withLive(b, []);
  return { net, a, b, liveA, liveB, cancelledA };
}

const tom = (chatId: string): AgentActivity => ({ agentId: 'ag_tom', runId: 'run_tom', conversationId: chatId, note: 'bash', startedAt: 100, modelName: 'Opus 5.5', effort: 'high', toolCalls: 2 });
const call = (runId: string): RunItem => ({ id: 'ri_1', runId, seq: 1, kind: 'tool_call', name: 'Read', data: { callId: 'c1', args: { file_path: 'C:/data/invoices.pdf' } }, createdAt: 1 });

test('a run on A shows in B\'s live bar, chat list and agent.activity with A as its PC; its step and its end follow', async () => {
  const { a, b, liveA } = setup();
  const chat = a.h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human', title: 'Invoices' });
  await settle();
  assert.ok(b.h.chats.get(chat.id), 'the chat came over');
  a.h.bus.emit('agent.activity', { active: [tom(chat.id)] });
  await settle();
  const live = b.h.chats.summary(chat.id).live;
  assert.deepEqual(live?.map((run) => [run.runId, run.deviceId, run.model, run.note]), [['run_tom', 'pc_a', 'Opus 5.5', 'bash']]);
  assert.deepEqual(b.h.chats.summary(chat.id).working, ['ag_tom'], 'the chat list marks it working');
  assert.equal(a.h.chats.summary(chat.id).live?.[0].deviceId, undefined, 'on A it is A\'s own run');
  assert.deepEqual(allActivity(b.h.bus, []).map((entry) => [entry.runId, entry.deviceId, entry.toolCalls]), [['run_tom', 'pc_a', undefined]]);
  assert.ok(b.h.of('agent.activity').length > 0, 'B\'s windows hear it');
  assert.ok(b.h.of('conversation.upserted').some((summary) => summary.id === chat.id && summary.live?.length === 1), 'B\'s chat list hears it');

  a.h.bus.emit('run.item', call('run_tom'));
  await settle();
  assert.match(b.h.chats.summary(chat.id).live?.[0].step ?? '', /invoices\.pdf/, 'the step follows');

  a.h.bus.emit('agent.activity', { active: [] });
  await settle();
  assert.equal(b.h.chats.summary(chat.id).live, undefined, 'the end follows');
  assert.deepEqual(allActivity(b.h.bus, []), []);
  void liveA;
});

test('A\'s state leaves B when the link goes; it comes back at the next link-up', async () => {
  const { net, a, b, liveA, liveB } = setup();
  const chat = a.h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  await settle();
  a.h.bus.emit('agent.activity', { active: [tom(chat.id)] });
  await settle();
  assert.equal(b.h.chats.summary(chat.id).live?.length, 1);
  net.up = false;
  liveB.linkDown('pc_a');
  assert.equal(b.h.chats.summary(chat.id).live, undefined, 'dropped with the link');
  net.up = true;
  liveA.linkUp('pc_b');
  await settle();
  assert.equal(b.h.chats.summary(chat.id).live?.[0].deviceId, 'pc_a', 'sent again at link-up');
});

test('a Stop on B reaches A\'s dispatcher; a run nobody has is no run', async () => {
  const { a, b, liveB, cancelledA } = setup();
  const chat = a.h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  await settle();
  a.h.bus.emit('agent.activity', { active: [tom(chat.id)] });
  await settle();
  assert.equal(await liveB.cancelThere('run_tom'), true);
  assert.deepEqual(cancelledA, ['run_tom'], 'A stops its own run');
  assert.equal(await liveB.cancelThere('run_unknown'), false, 'no PC runs it');
  assert.deepEqual(cancelledA, ['run_tom'], 'nothing else was asked');
  void b;
});

test('only a CEO link sends live work or a Stop', async () => {
  const { a, liveA } = setup();
  a.repo.upsert(record('pc_emp', { personId: 'per_1' }));
  assert.throws(() => liveA.receive({ runs: [] }, 'pc_emp'), (error: unknown) => error instanceof WorkforceError && error.code === 'forbidden');
  await assert.rejects(liveA.cancel({ runId: 'run_tom' }, 'pc_emp'), (error: unknown) => error instanceof WorkforceError && error.code === 'forbidden');
});

test('a PC without sync.live (an older version) is asked again only after its next link-up', async () => {
  const { net, a, b, liveA } = setup();
  b.handlers.set(LIVE_METHOD, async () => { throw new WorkforceError('not_found', 'Unknown peer method sync.live.'); }); // what an older runtime answers
  const chat = a.h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  await settle();
  const sent = () => net.calls.filter((entry) => entry.method === LIVE_METHOD && entry.from === 'pc_a').length;
  a.h.bus.emit('agent.activity', { active: [tom(chat.id)] });
  await settle();
  assert.equal(sent(), 1);
  a.h.bus.emit('agent.activity', { active: [{ ...tom(chat.id), note: 'editing' }] });
  await settle();
  assert.equal(sent(), 1, 'not asked again');
  liveA.linkUp('pc_b');
  await settle();
  assert.equal(sent(), 2, 'asked again at its link-up');
});

test('a message lost while the link stays goes once more: a run\'s end reaches B; a PC that keeps failing gets one more try', async () => {
  // Review 16.11.2026: a replaced channel or a timeout lost A's {runs: []}, and B showed the run as working until A's next change.
  const { net, a, b } = setup();
  const chat = a.h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  await settle();
  a.h.bus.emit('agent.activity', { active: [tom(chat.id)] });
  await settle();
  assert.equal(b.h.chats.summary(chat.id).live?.length, 1);
  const receive = b.handlers.get(LIVE_METHOD)!;
  let failing = 1;
  b.handlers.set(LIVE_METHOD, async (params, from) => {
    if (failing-- > 0) throw new WorkforceError('unavailable', 'The link to this PC was replaced.');
    return receive(params, from);
  });
  a.h.bus.emit('agent.activity', { active: [] });
  await settle();
  assert.equal(b.h.chats.summary(chat.id).live, undefined, 'the end arrived with the second try');

  const sent = () => net.calls.filter((entry) => entry.method === LIVE_METHOD && entry.from === 'pc_a').length;
  const before = sent();
  failing = Infinity;
  a.h.bus.emit('agent.activity', { active: [tom(chat.id)] });
  await settle();
  assert.equal(sent() - before, 2, 'one more try, then the next change of A');
});

test('a run from another PC takes only the live bar\'s fields and never its own deviceId', () => {
  assert.equal(shareOf({ activity: { agentId: 'ag_tom' } }), undefined, 'no run id, no run');
  const share = shareOf({ activity: { agentId: 'ag_tom', runId: 'run_1', startedAt: 1, note: 7, deviceId: 'pc_x', toolCalls: 3 }, step: 'Reading a.pdf', chats: ['ch_1', 4] });
  assert.deepEqual(share, { activity: { agentId: 'ag_tom', runId: 'run_1', startedAt: 1, note: '' }, step: 'Reading a.pdf', chats: ['ch_1'] });
});
