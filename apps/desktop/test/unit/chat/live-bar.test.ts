// The chat's live bar (runtime/chat/live.ts, ConversationSummary.live): a running run or split part shows in a chat when
// it came from that chat or posted into it during this run – nothing else; its step comes from the run journal, its
// model from the activity; it ends with its run; every change reaches the list as conversation.upserted. F10: another
// PC's runs merge in (deviceId) and leave with that PC's next state or its link.
// Owns: these assertions only. Never: engines, timers or sleeps (liveGapMs 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentActivity, RunItem } from '../../../src/shared/model/runs.ts';
import { allActivity, chatLiveOf } from '../../../src/runtime/chat/live.ts';
import { agent, harness } from './harness.ts';

function setup() {
  const h = harness();
  h.org.add(agent('ag_tom', 'Tom'));
  h.org.add(agent('ag_lea', 'Lea'));
  const home = h.chats.create({ agentIds: ['ag_tom', 'ag_lea'], createdBy: 'human', title: 'Invoices' });
  const other = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human', title: 'Press' });
  const old = h.chats.create({ agentIds: ['ag_tom', 'ag_lea'], createdBy: 'human', title: 'Weekly video' });
  const active = (list: AgentActivity[]) => h.bus.emit('agent.activity', { active: list });
  const tom: AgentActivity = { agentId: 'ag_tom', runId: 'run_tom', conversationId: home.id, note: 'bash', startedAt: 100, modelName: 'Opus 5.5', effort: 'high' };
  return { h, home, other, old, active, tom };
}

const call = (runId: string, name: string, args: unknown): RunItem => ({ id: `ri_${name}`, runId, seq: 1, kind: 'tool_call', name, data: { callId: 'c1', args }, createdAt: 1 });

test('a run shows in the chat it came from, with its model and current step; not elsewhere; it ends with its run', () => {
  const { h, home, other, old, active, tom } = setup();
  active([tom]);
  assert.deepEqual(h.chats.summary(home.id).live, [{ runId: 'run_tom', agentId: 'ag_tom', startedAt: 100, note: 'bash', model: 'Opus 5.5', effort: 'high' }]);
  assert.deepEqual(h.chats.summary(home.id).working, ['ag_tom']);
  assert.equal(h.chats.summary(other.id).live, undefined, 'another chat of the agent shows nothing');
  assert.equal(h.chats.summary(old.id).live, undefined);

  h.bus.emit('run.item', call('run_tom', 'Read', { file_path: 'C:/data/invoices.pdf' }));
  assert.match(h.chats.summary(home.id).live![0].step ?? '', /^Reading .*invoices\.pdf$/);
  assert.match(h.of('conversation.upserted').at(-1)!.live?.[0].step ?? '', /invoices\.pdf/, 'the list hears the step');

  active([]);
  assert.equal(h.chats.summary(home.id).live, undefined);
  assert.deepEqual(h.of('conversation.upserted').at(-1)!.working, [], 'the end is announced');
});

test('posting into another chat during the run adds that chat; a later run starts clean', () => {
  const { h, home, other, active, tom } = setup();
  active([tom]);
  h.chats.postAgentMessage(other.id, 'ag_tom', 'run_tom', { body: 'Press list is ready' });
  assert.deepEqual(h.chats.summary(other.id).live?.map((run) => run.runId), ['run_tom'], 'it writes there – it shows there');
  assert.deepEqual(h.chats.summary(home.id).live?.map((run) => run.runId), ['run_tom']);
  active([]);
  active([{ ...tom, runId: 'run_next' }]);
  assert.equal(h.chats.summary(other.id).live, undefined, 'the next run has not posted there');
});

test('split parts show as their own lines in the chat they work for', () => {
  const { h, home, active, tom } = setup();
  const part = (idx: number): AgentActivity => ({ agentId: 'ag_tom', runId: `run_p${idx}`, conversationId: home.id, note: '', startedAt: 200 + idx,
    split: { id: `sp_${idx}`, groupId: 'grp_1', idx, of: 2, parentRunId: 'run_tom', title: `Part ${idx}` } });
  active([tom, part(1), part(2)]);
  const live = h.chats.summary(home.id).live!;
  assert.deepEqual(live.map((run) => [run.runId, run.split?.title]), [['run_tom', undefined], ['run_p1', 'Part 1'], ['run_p2', 'Part 2']], 'start order');
  assert.deepEqual(h.chats.summary(home.id).working, ['ag_tom']);
});

test('F10: another PC\'s runs merge into the bar in start order, marked with that PC; they leave with its next state or its link', () => {
  const { h, home, other, active, tom } = setup();
  const live = chatLiveOf(h.bus)!;
  active([tom]);
  const changes: number[] = [];
  live.onChange(() => changes.push(1));
  const lea: AgentActivity = { agentId: 'ag_lea', runId: 'run_lea', conversationId: home.id, note: '', startedAt: 50, modelName: 'GPT-6.1' };
  live.setRemote('pc_b', [{ activity: lea, step: 'Reading a.pdf', chats: [home.id] }]);
  assert.deepEqual(h.chats.summary(home.id).live?.map((run) => [run.runId, run.deviceId, run.step]), [['run_lea', 'pc_b', 'Reading a.pdf'], ['run_tom', undefined, undefined]]);
  assert.deepEqual(h.chats.summary(home.id).working, ['ag_lea', 'ag_tom']);
  assert.equal(h.chats.summary(other.id).live, undefined);
  assert.equal(h.of('conversation.upserted').at(-1)!.id, home.id, 'the chat is announced');
  assert.deepEqual(changes, [], 'another PC\'s state is no change of this PC\'s own work');
  assert.deepEqual(live.snapshot().map((share) => share.activity.runId), ['run_tom'], 'only this PC\'s runs travel on');
  assert.deepEqual(allActivity(h.bus, [tom]).map((entry) => [entry.runId, entry.deviceId]), [['run_tom', undefined], ['run_lea', 'pc_b']]);
  active([tom, { ...lea, deviceId: 'pc_b' }]);
  assert.deepEqual(live.snapshot().map((share) => share.activity.runId), ['run_tom'], 'an entry of another PC never counts as this PC\'s');
  const before = h.of('conversation.upserted').length;
  live.setRemote('pc_b', [{ activity: lea, step: 'Reading a.pdf', chats: [home.id] }]);
  assert.equal(h.of('conversation.upserted').length, before, 'the same state announces nothing');
  live.setRemote('pc_b', undefined);
  assert.deepEqual(h.chats.summary(home.id).live?.map((run) => run.runId), ['run_tom'], 'gone with its link');
  assert.deepEqual(allActivity(h.bus, [tom]).map((entry) => entry.runId), ['run_tom']);
  h.bus.emit('run.item', call('run_tom', 'Read', { file_path: 'C:/x.md' }));
  assert.deepEqual(changes, [1], 'a step of this PC\'s own run is a change');
});
