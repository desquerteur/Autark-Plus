// KI-Runde 17.11.2026 (the one call of company-2 – a group chat, started by the person – had no voice and ended in
// silence): every call has a voice (src/runtime/calls/talker.ts voiceOf) – a call the person starts in a chat with several
// agents gets the team form, the chat's lead speaking by default (a paused agent only when every agent of the chat is
// paused) and every other agent listening; and a call no model can answer hears so at once as the program's own line
// (src/runtime/calls/no-lane.ts) – once per call, waking nobody – while the line still reaches the agent.
// Wave 2 (decision 7.4): the answer of a team call opens with <as name="…">; without that tag nobody speaks, so an
// unnamed answer leaves the lines in the chat, and a tag naming someone the call does not know speaks as the default one.
// Owns: these assertions only. Never: a real model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID, SYSTEM_ID } from '../../../src/shared/ids.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { CallLog } from '../../../src/runtime/calls/call-log.ts';
import { NO_LANE_LINE, sayNoLane } from '../../../src/runtime/calls/no-lane.ts';
import { CallTalker } from '../../../src/runtime/calls/talker.ts';
import { agent, harness } from '../chat/harness.ts';
import { fakeVoice, type FakeSaid } from './voice-fake.ts';

function setup(answer: (input: string, index: number) => FakeSaid, language = 'de', paused: string[] = []) {
  const h = harness();
  const status = (id: string) => (paused.includes(id) ? { status: 'paused' as const } : {});
  h.org.add(agent('ag_ava', 'Ava', status('ag_ava')));
  h.org.add(agent('ag_ben', 'Ben', { role: 'Lead', ...status('ag_ben') }));
  h.org.add(agent('ag_lena', 'Lena', status('ag_lena')));
  const chat = h.chats.create({ agentIds: ['ag_ava', 'ag_ben', 'ag_lena'], createdBy: HUMAN_ID, lead: 'ag_ben' });
  Object.assign(h.services, { secrets: { redact: (text: string) => text }, settings: { get: () => ({ profile: { name: 'Gerd', language }, voice: {} }) } });
  const services = h.services as RuntimeServices;
  const log = new CallLog(() => services);
  const callId = log.start(chat.id, { key: 'pc', name: 'Office PC' }); // the person starts it: no ring
  const fake = fakeVoice(answer);
  const talker = new CallTalker({ services: () => services, voice: fake.opener, calls: log });
  const say = (body: string): Message => {
    const message = h.chats.send({ conversationId: chat.id, body, authorId: HUMAN_ID, authorKind: 'human', silent: true, speech: { source: 'endpoint', live: true }, meta: { call: { id: callId, participant: 'device:pc', name: 'Office PC' } } });
    talker.heard(message);
    return message;
  };
  const rows = () => h.chats.messages(chat.id, { limit: 50 });
  return { ...h, chat, callId, talker, fake, say, rows };
}

const settled = async () => { for (let round = 0; round < 8; round++) await new Promise<void>((resolve) => setTimeout(resolve, 5)); };

test('a call the person starts in a group: the team form, the chat\'s lead speaks by default, every other agent listens', async () => {
  const h = setup(() => '<as name="Ben">Hallo Gerd, ich bin da.');
  assert.equal(h.talker.serves(h.chat.id, h.callId), true, 'the call has a voice');
  h.say('Halloh, wie geht\'s denn so?');
  await settled();
  const [open] = h.fake.opens;
  assert.match(open.system, /I speak for each agent in the call as that agent \("I"\): Ben \(Lead\)\./);
  assert.match(open.system, /Listening in the chat: Ava, Lena\./);
  assert.match(open.system, /Gerd started this call\./);
  const [line] = h.rows().filter((m) => m.meta.call?.voice === 'talker');
  assert.deepEqual([line.authorId, line.body, line.silent], ['ag_ben', 'Hallo Gerd, ich bin da.', false]);
  assert.equal(h.wakeRows().length, 0);
});

test('without the opening tag nobody speaks: the lines stay in the chat and wake nobody', async () => {
  const h = setup(() => 'Hallo Gerd, ich bin da.');
  h.say('Halloh, wie geht\'s denn so?');
  await settled();
  assert.equal(h.rows().filter((m) => m.meta.call?.voice === 'talker').length, 0);
  assert.equal(h.wakeRows().length, 0);
});

test('no model can run: the call hears the program\'s line at once, and the line still reaches the agent', async () => {
  const h = setup(() => new WorkforceError('unavailable', 'No model can run now.'));
  h.say('Hallo?');
  await settled();
  const program = h.rows().filter((m) => m.authorKind === 'system' && m.kind === 'text');
  assert.equal(program.length, 1);
  assert.deepEqual([program[0].authorId, program[0].body, program[0].meta.call?.id, program[0].silent], [SYSTEM_ID, NO_LANE_LINE.de, h.callId, false]);
  assert.deepEqual(h.wakeRows().map((wake) => wake.agent_id), ['ag_ben'], 'the lead answers once a model is free');

  const english = setup(() => new WorkforceError('unavailable', 'No model can run now.'), 'en-US');
  english.say('Hello?');
  await settled();
  assert.equal(english.rows().find((m) => m.authorKind === 'system' && m.kind === 'text')?.body, NO_LANE_LINE.en);

  const failed = setup(() => new Error('one answer went wrong'));
  failed.say('Hallo?');
  await settled();
  assert.equal(failed.rows().filter((m) => m.authorKind === 'system' && m.kind === 'text').length, 0, 'one failed answer is no missing lane');
  assert.equal(failed.wakeRows().length, 1);
});

// Fixes after the review: the program's line wakes an agent of its own, and it was read aloud again for every line.
test('the program\'s line wakes nobody by itself and is said once per call', async () => {
  const alone = setup(() => '');
  sayNoLane(alone.services as RuntimeServices, alone.chat.id, alone.callId);
  assert.equal(alone.rows().filter((m) => m.authorKind === 'system' && m.kind === 'text').length, 1, 'the line is there');
  assert.equal(alone.wakeRows().length, 0, 'the program wakes nobody');

  const h = setup(() => new WorkforceError('unavailable', 'No model can run now.'));
  h.say('Hallo?');
  await settled();
  h.say('Hörst du mich?');
  await settled();
  assert.equal(h.rows().filter((m) => m.authorKind === 'system' && m.kind === 'text').length, 1, 'once per call, not once per line that finds no lane');
  assert.deepEqual(h.wakeRows().map((wake) => wake.agent_id), ['ag_ben'], 'both lines still reach the lead');
});

// Fix after the review: the voice spoke as a paused lead, whose wakes the dispatcher holds, while the active agents listened.
test('the speaker is an agent at work: a paused lead listens, and speaks only when every agent of the chat is paused', async () => {
  const h = setup(() => '<as name="Zoe">Ich bin da.', 'de', ['ag_ben']); // a name the call does not know: the default speaker
  h.say('Hallo?');
  await settled();
  const [line] = h.rows().filter((m) => m.meta.call?.voice === 'talker');
  assert.equal(line.authorId, 'ag_ava', 'the paused lead is not the voice');
  assert.match(h.fake.opens[0].system, /as that agent \("I"\): Ava\./);

  const all = setup(() => '<as name="Zoe">Ich bin da.', 'de', ['ag_ava', 'ag_ben', 'ag_lena']);
  all.say('Hallo?');
  await settled();
  assert.equal(all.rows().filter((m) => m.meta.call?.voice === 'talker')[0].authorId, 'ag_ben', 'nobody is at work: the lead speaks as before');
});

test('a line that runs once more starts its text anew: the person never hears the opening twice (review 3)', async () => {
  const h = setup(() => ({ restart: '<as name="Ben">Hallo Gerd. Ich schau.', stream: '<as name="Ben">Hallo Gerd. Ich schau gleich nach dem Bericht. Und', then: 'hang' }));
  h.say('Wie weit bist du?');
  await settled();
  const [line] = h.rows().filter((m) => m.meta.call?.voice === 'talker');
  assert.equal(line.state, 'streaming');
  assert.equal(line.body, 'Hallo Gerd. Ich schau gleich nach dem Bericht.', 'only the second try\'s text, read on past what was said');
  h.talker.stop();
});
