// B-081: the call voice (src/runtime/calls/talker.ts + talker-prompt.ts) in an agent's call in a chat with more agents:
// it serves the group because the call has a caller; the answer's opening tag picks who speaks – an agent of the call or a
// listening one (which then joins the call) – or nobody; the line is stored as that agent's, and what it passes on reaches
// only that agent; an answer nobody speaks reaches the caller's own turn.
// KI-Runde 17.11.2026: one kept conversation per call, plain text with tags (voice-text.ts), no JSON schema any more.
// Owns: these assertions only. Never: a real model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID, SYSTEM_ID } from '../../../src/shared/ids.ts';
import { callRecord, type CallRecord } from '../../../src/shared/model/call.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { CallLog } from '../../../src/runtime/calls/call-log.ts';
import { CallTalker } from '../../../src/runtime/calls/talker.ts';
import { agent, harness } from '../chat/harness.ts';
import { fakeVoice, type FakeSaid } from './voice-fake.ts';

function setup(answer: (input: string, index: number) => FakeSaid) {
  const h = harness();
  h.org.add(agent('ag_ava', 'Ava', { role: 'Designer' }));
  h.org.add(agent('ag_ben', 'Ben'));
  h.org.add(agent('ag_lena', 'Lena', { role: 'Finance' }));
  const chat = h.chats.create({ agentIds: ['ag_ava', 'ag_ben', 'ag_lena'], createdBy: HUMAN_ID, lead: 'ag_ben' });
  Object.assign(h.services, {
    secrets: { redact: (text: string) => text },
    settings: { get: () => ({ profile: { name: 'Gerd', language: 'de' }, voice: {} }) },
  });
  const steers: Array<{ agentId: string; text: string; mode: string }> = [];
  Object.assign(h.services.dispatcher, { relay: async (agentId: string, _chat: string, text: string, mode: string) => { steers.push({ agentId, text, mode }); return true; } });
  const services = h.services as RuntimeServices;
  const log = new CallLog(() => services);
  const ring: CallRecord = { id: 'call_team', participant: 'agent:ag_ava', name: 'Ava', startedAt: h.clock.now(), lines: [], ring: { by: 'ag_ava', why: 'Logo', until: h.clock.now() + 45_000 }, agents: ['ag_ava', 'ag_ben'] };
  h.chats.send({ conversationId: chat.id, body: 'Ava calls: Logo', kind: 'status', silent: true, authorId: SYSTEM_ID, authorKind: 'system', mentions: [], meta: { status: { type: 'note', text: 'Ava calls: Logo' }, call: ring } });
  log.take(chat.id, 'call_team', { key: 'pc', name: 'Office PC' });
  const fake = fakeVoice(answer);
  const talker = new CallTalker({ services: () => services, voice: fake.opener, calls: log });
  const say = (body: string, callId = 'call_team'): Message => {
    const message = h.chats.send({ conversationId: chat.id, body, authorId: HUMAN_ID, authorKind: 'human', silent: true, speech: { source: 'endpoint', live: true }, meta: { call: { id: callId, participant: 'device:pc', name: 'Office PC' } } });
    talker.heard(message);
    return message;
  };
  const record = () => h.chats.messages(chat.id, { limit: 50 }).map((m) => callRecord(m)).find((call) => call?.id === 'call_team')!;
  const voiced = () => h.chats.messages(chat.id, { limit: 50 }).filter((m) => m.meta.call?.voice === 'talker');
  return { ...h, chat, talker, fake, steers, say, record, voiced };
}

const settled = async () => { for (let round = 0; round < 8; round++) await new Promise<void>((resolve) => setTimeout(resolve, 5)); };

test('an agent\'s call in a group: the voice serves it with a team – the agents in the call and the listening one', async () => {
  const h = setup(() => '<as name="Ava">Hallo Gerd.');
  assert.equal(h.talker.serves(h.chat.id), true, 'KI-Runde 17.11.: every call has a voice (a person’s call: talker-voice.test.ts)');
  assert.equal(h.talker.serves(h.chat.id, 'call_team'), true);
  h.say('Hallo zusammen');
  await settled();
  const [open] = h.fake.opens;
  assert.match(open.system, /I speak for each agent in the call as that agent \("I"\): Ava \(Designer\), Ben\. Ava called about "Logo"\./);
  assert.match(open.system, /Listening in the chat: Lena \(Finance\)\. One of them speaks when the line concerns its own work/);
  assert.match(open.system, /My answer opens with <as name="…">/);
  assert.equal(h.voiced()[0].authorId, 'ag_ava');
  assert.equal(h.voiced()[0].body, 'Hallo Gerd.', 'the tag is not spoken');
  assert.equal(h.wakeRows().length, 0);
});

test('a listening agent whose work it concerns speaks and joins the call; what it passes on reaches only it', async () => {
  const h = setup(() => '<as name="lena">Das Budget reicht. <main next>Check the budget line again.</main>');
  h.say('Reicht das Budget?');
  await settled();
  const [line] = h.voiced();
  assert.deepEqual([line.authorId, line.body, line.meta.call?.participant], ['ag_lena', 'Das Budget reicht.', 'agent:ag_lena']);
  assert.deepEqual(h.record().agents, ['ag_ava', 'ag_ben', 'ag_lena'], 'Lena is in the call now');
  assert.deepEqual(h.steers.map((steer) => [steer.agentId, steer.mode]), [['ag_lena', 'next']]);
});

test('now goes to the one who spoke; nobody speaks without the opening tag; an answer the voice cannot speak reaches the caller', async () => {
  const now = setup(() => '<as name="Ben">Ich stoppe den Build. <main now>Stop the build now.</main>');
  now.say('Ben, stopp den Build');
  await settled();
  assert.deepEqual(now.steers.map((steer) => [steer.agentId, steer.mode]), [['ag_ben', 'now']]);

  const nobody = setup(() => 'Das klären die beiden selbst.');
  nobody.say('Hmm, lass mich überlegen');
  await settled();
  assert.equal(nobody.voiced().length, 0);
  assert.equal(nobody.wakeRows().length, 0);

  const broken = setup(() => new Error('no answer'));
  broken.say('Was nun?');
  await settled();
  assert.deepEqual(broken.wakeRows().map((wake) => wake.agent_id), ['ag_ava'], 'the caller answers');
});

test('an unknown name in the tag speaks as the one who started the call', async () => {
  const h = setup(() => '<as name="Zoe">Ich schaue nach.');
  h.say('Zoe, wie weit bist du?');
  await settled();
  assert.equal(h.voiced()[0].authorId, 'ag_ava');
});
