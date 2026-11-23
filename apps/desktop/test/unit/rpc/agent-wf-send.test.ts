// B-085 – messages.send from an agent's own wf (owner scope with agentId, http/ws.ts) posts as that agent (13.11.2026: no
// chat.send any more – ChatService.send under the agent's member rules, no self-wake) with its level, mentions and reply,
// under the agent's running main turn (else none), and returns the stored message; a chat it is no member of, an archived
// agent and the person's own extras (model, pin, speech …) are refused; a plain owner socket still writes as the person.
// Owns: these assertions only. Never: real engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import type { AgentActivity } from '../../../src/shared/model/runs.ts';
import { OWNER, TestClient, rpcFixture } from './s1-helpers.ts';

function setup() {
  const f = rpcFixture();
  f.org.add(agent('ag_ava', 'Ava', { mode: 'research' }));
  f.org.add(agent('ag_old', 'Old', { archivedAt: 1 }));
  const run = (patch: Partial<AgentActivity>): AgentActivity => ({ agentId: 'ag_ava', runId: 'run_x', note: '', startedAt: 0, ...patch });
  return { ...f, run, ava: new TestClient(f.server, { kind: 'owner', agentId: 'ag_ava' }), owner: new TestClient(f.server, OWNER) };
}

test("an agent's wf send posts as the agent: its level and mentions, under its running main turn, the stored message back", async (t) => {
  const f = setup();
  t.after(f.cleanup);
  const chat = f.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  f.dispatcher.active = [
    f.run({ runId: 'run_split', conversationId: chat.id, split: { id: 's', groupId: 'g', idx: 0, of: 2, parentRunId: 'run_main', title: 'x' } }),
    f.run({ runId: 'run_here', conversationId: chat.id }),
  ];
  const sent = await f.ava.call<Message>('messages.send', { conversationId: chat.id, body: 'Done with the report', priority: 'important', mentions: ['human'], clientId: 'wf-1' });
  assert.deepEqual([sent.authorId, sent.authorKind, sent.priority, sent.runId], ['ag_ava', 'agent', 'important', 'run_here'], 'the main turn, never a split');
  assert.ok(sent.mentions.includes('human'));
  const quiet = await f.ava.call<Message>('messages.send', { conversationId: chat.id, body: 'Quiet one', silent: true });
  assert.equal(quiet.silent, true);
  f.dispatcher.active = [];
  const idle = await f.ava.call<Message>('messages.send', { conversationId: chat.id, body: 'Idle' });
  assert.equal(idle.runId, undefined, 'no running turn: no run');
});

test("refusals: a chat it is not in, an archived agent, the person's extras; a plain owner socket writes as the person", async (t) => {
  const f = setup();
  t.after(f.cleanup);
  const chat = f.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  const foreign = f.chats.create({ agentIds: [], createdBy: 'human' });
  const refused = await f.ava.request('messages.send', { conversationId: foreign.id, body: 'not mine' });
  assert.equal(refused.error?.code, 'forbidden');
  for (const extra of [{ model: 'auto' }, { pin: true, model: 'auto' }, { ultra: true }, { speech: { live: true } }]) {
    const answer = await f.ava.request('messages.send', { conversationId: chat.id, body: 'x', ...extra });
    assert.equal(answer.error?.code, 'bad_request', JSON.stringify(extra));
  }
  const old = new TestClient(f.server, { kind: 'owner', agentId: 'ag_old' });
  assert.equal((await old.request('messages.send', { conversationId: chat.id, body: 'x' })).error?.code, 'forbidden');
  const gone = new TestClient(f.server, { kind: 'owner', agentId: 'ag_nobody' });
  assert.equal((await gone.request('messages.send', { conversationId: chat.id, body: 'x' })).error?.code, 'forbidden');
  const mine = await f.owner.call<Message>('messages.send', { conversationId: chat.id, body: 'From me' });
  assert.equal(mine.authorId, 'human');
});
