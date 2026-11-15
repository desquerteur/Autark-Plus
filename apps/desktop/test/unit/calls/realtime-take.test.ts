// B-081: realtime voice (src/runtime/calls/realtime/session.ts) with a call it takes, against a fake engine: opening with
// an agent's ring in a 1:1 answers it – the voice speaks as the caller and is told to open with its line; another device
// opening the same call ends the first session TAKEN_OVER (no conflict); a session whose call row shows another holder
// (also by sync) ends TAKEN_OVER. A ring in a chat with more agents is the voice conversation's: realtime refuses before
// it takes anything. A start that fails (no key, provider down) leaves the ring ringing, so the voice conversation's take
// still answers it; a ring that rang out while the provider connected closes the engine.
// Owns: these assertions only. Never: a provider.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID, SYSTEM_ID } from '../../../src/shared/ids.ts';
import { RING_MS, TAKEN_OVER, callRecord, type CallRecord } from '../../../src/shared/model/call.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { CallLog, writeCallRow } from '../../../src/runtime/calls/call-log.ts';
import { RealtimeCalls, type CallTimers } from '../../../src/runtime/calls/realtime/session.ts';
import type { VoiceEngine, VoiceEngineConfig } from '../../../src/runtime/calls/realtime/engine.ts';
import { agent, harness } from '../chat/harness.ts';

const timers: CallTimers = { set: () => 0, clear: () => undefined };
const PC = { key: 'pc', name: 'Office PC' };

function setup(options: { group?: boolean; key?: string | null; beforeOpen?: () => void } = {}) {
  const h = harness();
  h.org.add(agent('ag_ava', 'Ava'));
  h.org.add(agent('ag_ben', 'Ben'));
  const chat = options.group
    ? h.chats.create({ agentIds: ['ag_ava', 'ag_ben'], createdBy: HUMAN_ID, lead: 'ag_ben' })
    : h.chats.create({ agentIds: ['ag_ava'], createdBy: HUMAN_ID });
  const account = { id: 'acc_oai', provider: 'openai', label: 'OpenAI', auth: 'api_key', state: 'ok', priority: 1, enabled: true, detected: false, createdAt: 0 };
  const key = options.key === null ? undefined : options.key ?? 'sk-test';
  Object.assign(h.services, {
    accounts: { list: () => [account], apiKey: async () => key },
    catalog: { list: () => [{ provider: 'openai', model: 'gpt-realtime-mini', accounts: [] }] },
    settings: { get: () => ({ profile: { name: 'Gerd' } }) },
  });
  const services = h.services as RuntimeServices;
  const opened: Array<{ config: VoiceEngineConfig; texts: Array<{ text: string; respond?: boolean }>; closed: boolean }> = [];
  const engine: VoiceEngine = {
    id: 'fake',
    open: async (config) => {
      const session = { config, texts: [] as Array<{ text: string; respond?: boolean }>, closed: false };
      opened.push(session);
      options.beforeOpen?.();
      return { sendAudio() {}, interrupt() {}, addText: (_role, text, opts) => { session.texts.push({ text, respond: opts?.respond }); }, close: () => { session.closed = true; } };
    },
  };
  const log = new CallLog(() => services);
  const realtime = new RealtimeCalls({ services: () => services, log, connect: (() => { throw new Error('no socket'); }) as never, timers, engine: () => engine });
  const ring: CallRecord = { id: 'call_ring', participant: 'agent:ag_ava', name: 'Ava', startedAt: h.clock.now(), lines: [], ring: { by: 'ag_ava', why: 'Logo', say: 'Gerd, kurz zum Logo.', until: h.clock.now() + RING_MS } };
  const row = h.chats.send({ conversationId: chat.id, body: 'Ava calls: Logo', kind: 'status', silent: true, authorId: SYSTEM_ID, authorKind: 'system', mentions: [], meta: { status: { type: 'note', text: 'Ava calls: Logo' }, call: ring } });
  const record = () => callRecord(h.chats.message(row.id)!)!;
  return { ...h, services, chat, opened, log, realtime, row, record };
}

test('open with a ring in a 1:1: it answers as the caller and opens with its line', async () => {
  const h = setup();
  const opened = await h.realtime.open(h.chat.id, PC, undefined, 'call_ring');
  assert.equal(opened.agentId, 'ag_ava');
  assert.match(h.opened[0].config.instructions, /I am Ava/);
  assert.deepEqual(h.opened[0].texts, [{ text: '[I called them about: "Logo". They picked up; I open with: "Gerd, kurz zum Logo."]', respond: true }]);
  assert.deepEqual([h.record().participant, h.record().ring?.answeredAt], ['device:pc', h.clock.now()]);
});

test('another device takes the call over: the first session ends TAKEN_OVER, here or when the synced row shows another holder', async () => {
  const h = setup();
  const first = await h.realtime.open(h.chat.id, PC, undefined, 'call_ring');
  const second = await h.realtime.open(h.chat.id, { key: 'dev_phone', name: 'Pixel' }, undefined, 'call_ring');
  assert.deepEqual(await h.realtime.pull(first.sessionId, 'pc', 0), { events: [], next: 0, closed: TAKEN_OVER });
  assert.equal(h.opened[0].closed, true);
  assert.equal(h.opened[1].texts.length, 0, 'a takeover opens with no line');
  assert.equal(h.record().participant, 'device:dev_phone');
  await assert.rejects(h.realtime.open(h.chat.id, PC), /already runs in this chat/, 'without the call no second session opens');

  writeCallRow(h.services, h.row.id, (record) => ({ ...record, participant: 'device:pc', name: 'Server PC', pc: 'dev_server' })); // another PC took it
  assert.equal((await h.realtime.pull(second.sessionId, 'dev_phone', 0)).closed, TAKEN_OVER);
  assert.equal(h.record().endedAt, undefined, 'the call goes on there');
});

test('a ring in a chat with more agents is the voice conversation\'s: realtime refuses before it takes anything', async () => {
  const h = setup({ group: true });
  await assert.rejects(h.realtime.open(h.chat.id, PC, undefined, 'call_ring'), (error: Error & { code?: string }) => error.code === 'unavailable' && /several agents/.test(error.message));
  assert.equal(h.opened.length, 0, 'no provider opened');
  assert.deepEqual([h.record().participant, h.record().ring?.answeredAt], ['agent:ag_ava', undefined], 'it still rings');
  const taken = h.log.take(h.chat.id, 'call_ring', PC); // the voice conversation's take (calls.start)
  assert.equal(taken.answered, true);
});

test('a realtime start that fails leaves the ring ringing: the voice conversation\'s take still answers it', async () => {
  const noKey = setup({ key: null });
  await assert.rejects(noKey.realtime.open(noKey.chat.id, PC, undefined, 'call_ring'), /needs the API key/);
  assert.deepEqual([noKey.record().participant, noKey.record().ring?.answeredAt], ['agent:ag_ava', undefined]);
  assert.equal(noKey.log.take(noKey.chat.id, 'call_ring', PC).answered, true, 'the fallback answers – the opening line follows');

  let late: ReturnType<typeof setup> | undefined;
  late = setup({ beforeOpen: () => late!.clock.advance(RING_MS + 1) }); // the ring rang out while the provider connected
  await assert.rejects(late.realtime.open(late.chat.id, PC, undefined, 'call_ring'), /already ended/);
  assert.equal(late.opened[0].closed, true, 'the engine closes');
  assert.equal(late.record().ring?.answeredAt, undefined);
});
