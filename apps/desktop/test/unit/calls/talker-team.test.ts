// B-081: the call talker (src/runtime/calls/talker.ts + talker-prompt.ts) in an agent's call in a chat with more agents:
// it serves the group because the call has a caller; one decision per spoken line picks who speaks – an agent of the call
// or a listening one (which then joins the call) – or nobody; the line is stored as that agent's, and the relay reaches
// only that agent; a useless answer goes to the caller.
// Owns: these assertions only. Never: a real model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID, SYSTEM_ID } from '../../../src/shared/ids.ts';
import { callRecord, type CallRecord } from '../../../src/shared/model/call.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { StructuredRunner } from '../../../src/runtime/decision/types.ts';
import { CallLog } from '../../../src/runtime/calls/call-log.ts';
import { CallTalker, TEAM_SCHEMA, parseTeamDecision } from '../../../src/runtime/calls/talker.ts';
import { agent, harness } from '../chat/harness.ts';

type Ask = Parameters<StructuredRunner>[0];

function setup(answer: (ask: Ask) => unknown) {
  const h = harness();
  h.org.add(agent('ag_ava', 'Ava', { role: 'Designer' }));
  h.org.add(agent('ag_ben', 'Ben'));
  h.org.add(agent('ag_lena', 'Lena', { role: 'Finance' }));
  const chat = h.chats.create({ agentIds: ['ag_ava', 'ag_ben', 'ag_lena'], createdBy: HUMAN_ID, lead: 'ag_ben' });
  Object.assign(h.services, {
    secrets: { redact: (text: string) => text },
    settings: { get: () => ({ profile: { name: 'Gerd', language: 'de' }, voice: {} }) },
  });
  const steers: Array<{ agentId: string; text: string }> = [];
  Object.assign(h.services.dispatcher, { relay: async (agentId: string, _chat: string, text: string) => { steers.push({ agentId, text }); return true; } });
  const services = h.services as RuntimeServices;
  const log = new CallLog(() => services);
  const ring: CallRecord = { id: 'call_team', participant: 'agent:ag_ava', name: 'Ava', startedAt: h.clock.now(), lines: [], ring: { by: 'ag_ava', why: 'Logo', until: h.clock.now() + 45_000 }, agents: ['ag_ava', 'ag_ben'] };
  h.chats.send({ conversationId: chat.id, body: 'Ava calls: Logo', kind: 'status', silent: true, authorId: SYSTEM_ID, authorKind: 'system', mentions: [], meta: { status: { type: 'note', text: 'Ava calls: Logo' }, call: ring } });
  log.take(chat.id, 'call_team', { key: 'pc', name: 'Office PC' });
  const asks: Ask[] = [];
  const run: StructuredRunner = async (ask) => { asks.push(ask); return { text: '', structured: answer(ask) as Record<string, unknown>, by: 'x:small' }; };
  const talker = new CallTalker({ services: () => services, run, calls: log });
  const say = (body: string, callId = 'call_team'): Message => {
    const message = h.chats.send({ conversationId: chat.id, body, authorId: HUMAN_ID, authorKind: 'human', silent: true, speech: { source: 'endpoint', live: true }, meta: { call: { id: callId, participant: 'device:pc', name: 'Office PC' } } });
    talker.heard(message);
    return message;
  };
  const record = () => h.chats.messages(chat.id, { limit: 50 }).map((m) => callRecord(m)).find((call) => call?.id === 'call_team')!;
  const voiced = () => h.chats.messages(chat.id, { limit: 50 }).filter((m) => m.meta.call?.voice === 'talker');
  return { ...h, chat, talker, asks, steers, say, record, voiced };
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

test('an agent\'s call in a group: the talker serves it with a team – the agents in the call and the listening one', async () => {
  const h = setup(() => ({ as: 'Ava', say: 'Hallo Gerd.', relay: 'none' }));
  assert.equal(h.talker.serves(h.chat.id), false, 'a group call the person started: the delivery picks who answers');
  assert.equal(h.talker.serves(h.chat.id, 'call_team'), true);
  h.say('Hallo zusammen');
  await settled();
  const [ask] = h.asks;
  assert.deepEqual(ask.schema, TEAM_SCHEMA);
  assert.match(ask.system, /I speak for each agent in the call as that agent \("I"\): Ava \(Designer\), Ben\. Ava called about "Logo"\./);
  assert.match(ask.system, /Listening in the chat: Lena \(Finance\)\. One of them speaks when the line concerns its own work/);
  assert.match(ask.system, /JSON \{as, say, relay\}/);
  assert.equal(h.voiced()[0].authorId, 'ag_ava');
  assert.equal(h.wakeRows().length, 0);
});

test('a listening agent whose work it concerns speaks and joins the call; its relay reaches only it', async () => {
  const h = setup(() => ({ as: 'lena', say: 'Das Budget reicht.', relay: 'next' }));
  h.say('Reicht das Budget?');
  await settled();
  const [line] = h.voiced();
  assert.deepEqual([line.authorId, line.body, line.meta.call?.participant], ['ag_lena', 'Das Budget reicht.', 'agent:ag_lena']);
  assert.deepEqual(h.record().agents, ['ag_ava', 'ag_ben', 'ag_lena'], 'Lena is in the call now');
  assert.deepEqual(h.wakeRows().map((wake) => wake.agent_id), ['ag_lena']);
});

test('now goes to the one who spoke; nobody speaks when as and say are empty; a useless answer reaches the caller', async () => {
  const now = setup(() => ({ as: 'Ben', say: 'Ich stoppe den Build.', relay: 'now' }));
  now.say('Ben, stopp den Build');
  await settled();
  assert.deepEqual(now.steers.map((steer) => steer.agentId), ['ag_ben']);

  const nobody = setup(() => ({ as: '', say: '', relay: 'none' }));
  nobody.say('Hmm, lass mich überlegen');
  await settled();
  assert.equal(nobody.voiced().length, 0);
  assert.equal(nobody.wakeRows().length, 0);

  const broken = setup(() => ({ as: 'Ben', say: 'Ok', relay: 'maybe' }));
  broken.say('Was nun?');
  await settled();
  assert.deepEqual(broken.wakeRows().map((wake) => wake.agent_id), ['ag_ava'], 'the caller answers');
});

test('parseTeamDecision: by name or id, an unknown name speaks as the caller, an empty say is nobody', () => {
  const team = { callId: 'c', inCall: [{ id: 'ag_ava', name: 'Ava' }], listening: [{ id: 'ag_lena', name: 'Lena' }] };
  assert.deepEqual(parseTeamDecision({ as: 'ag_lena', say: 'Ja', relay: 'none' }, team), { as: 'ag_lena', say: 'Ja', relay: 'none' });
  assert.deepEqual(parseTeamDecision({ as: 'Zoe', say: 'Ja', relay: 'none' }, team), { as: 'ag_ava', say: 'Ja', relay: 'none' });
  assert.deepEqual(parseTeamDecision({ as: 'Ava', say: '  ', relay: 'now' }, team), { as: '', say: '', relay: 'none' });
  assert.equal(parseTeamDecision({ as: 'Ava', say: 'Ja' }, team), undefined);
});
