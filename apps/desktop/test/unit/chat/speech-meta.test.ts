// Spoken messages: messages.send `speech` is validated (chat/speech-meta.ts – source, live) into meta.via 'voice' +
// meta.speech; agents cannot attach speech; the context shows a spoken line like a typed one, a call line with its
// note; a phone's RPC send works the same way. B-082: hidden marks beside the plain body (meta.marks).
// Owns: these assertions only. Never: real timers, engines or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from './harness.ts';
import { speechMeta, withSpeech } from '../../../src/runtime/chat/speech-meta.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { asSaid, fixture } from '../context/fixture.ts';
import { PHONE, TestClient, rpcFixture } from '../rpc/s1-helpers.ts';
import type { Conversation, Message } from '../../../src/shared/model/chat.ts';
import { MARKS_LEGEND, type TextMarks } from '../../../src/shared/voice/marks.ts';

const BODY = 'Send the offer to Teydra by fifteen hundred';

function badRequest(fn: () => unknown): void {
  assert.throws(fn, (error: unknown) => error instanceof WorkforceError && error.code === 'bad_request' && (error.details as { param?: string })?.param === 'speech');
}

test('speechMeta: a known source and `live`; nothing else is kept', () => {
  assert.equal(speechMeta(undefined), undefined);
  assert.equal(speechMeta(null), undefined);
  assert.deepEqual(speechMeta({ source: 'endpoint', unsure: [{ text: 'x' }], confidence: 0.5, heard: 'y' }), { source: 'endpoint' });
  assert.deepEqual(speechMeta({ source: 'endpoint', live: true }), { source: 'endpoint', live: true });
  assert.deepEqual(speechMeta({ source: 'windows', live: 'yes' }), { source: 'windows' }, 'an older client');
  badRequest(() => speechMeta('spoken'));
  badRequest(() => speechMeta({ source: 'browser' }));
  badRequest(() => speechMeta([]));
  assert.deepEqual(withSpeech({ model: 'x' }, undefined), { model: 'x' });
  assert.deepEqual(withSpeech({}, { source: 'endpoint' }), { via: 'voice', speech: { source: 'endpoint' } });
});

test('ChatService.send: human speech becomes meta.via voice + meta.speech; agents cannot attach speech', () => {
  const h = harness();
  const tom = h.org.add(agent('ag_tom', 'Tom'));
  const chat = h.chats.create({ agentIds: [tom.id], createdBy: HUMAN_ID });
  const spoken = h.chats.send({ conversationId: chat.id, body: BODY, authorId: HUMAN_ID, speech: { source: 'endpoint' } });
  assert.equal(spoken.meta.via, 'voice');
  assert.deepEqual(spoken.meta.speech, { source: 'endpoint' });
  assert.deepEqual(h.chats.message(spoken.id)?.meta.speech, spoken.meta.speech, 'stored with the message');
  const typed = h.chats.send({ conversationId: chat.id, body: 'Typed', authorId: HUMAN_ID });
  assert.deepEqual(typed.meta, {});
  const fromAgent = h.chats.send({ conversationId: chat.id, body: BODY, authorId: tom.id, speech: { source: 'endpoint' } });
  assert.equal(fromAgent.meta.speech, undefined);
  assert.throws(() => h.chats.send({ conversationId: chat.id, body: 'x', authorId: HUMAN_ID, speech: { source: 'nope' } as never }), WorkforceError);
});

test('context: a spoken line reads like a typed one', () => {
  const f = fixture();
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: HUMAN_ID });
  f.chats.send({ conversationId: chat.id, body: 'Plain typed line', authorId: HUMAN_ID });
  f.chats.send({ conversationId: chat.id, body: BODY, authorId: HUMAN_ID, speech: { source: 'endpoint' } });
  const lines = f.context.delta({ agent: f.vid, conversationId: chat.id, sinceSeq: 0 }).text.split('\n');
  assert.deepEqual(lines.slice(-2).map(asSaid), ['[11:00] Alex: Plain typed line', `[11:00] Alex: ${BODY}`]);
});

test('RPC messages.send takes `speech` from the composer or a phone; a wrong shape is a bad_request', async (t) => {
  const f = rpcFixture();
  t.after(f.cleanup);
  f.org.add(agent('ag_ava', 'Ava'));
  const phone = new TestClient(f.server, PHONE);
  const chat = await phone.call<Conversation>('chats.create', { agentIds: ['ag_ava'] });
  const sent = await phone.call<Message>('messages.send', { conversationId: chat.id, body: BODY, speech: { source: 'endpoint', live: true } });
  assert.equal(sent.meta.via, 'voice');
  assert.deepEqual(sent.meta.speech, { source: 'endpoint', live: true });
  const wrong = await phone.request('messages.send', { conversationId: chat.id, body: BODY, speech: { source: 'radio' } });
  assert.equal(wrong.error?.code, 'bad_request');
});

// B-082: the body stays plain; marks travel beside it as meta.marks (checked against the body), an edit drops them and
// only the agent's view writes them in (context/render.ts) – with the legend once; an older inline body still reads so.
const SAID = 'Send the offer to Teydra by three';
const MARKS: TextMarks = { uncertain: [{ start: 18, end: 24, pct: 55, alts: [{ t: 'Tedra', pct: 30 }] }], dictated: [{ start: 0, end: 33 }] };

test('withSpeech keeps checked marks beside the plain body; spans outside the body are dropped', () => {
  assert.deepEqual(withSpeech({}, { source: 'endpoint' }, SAID, MARKS), { via: 'voice', speech: { source: 'endpoint' }, marks: MARKS });
  assert.deepEqual(withSpeech({}, undefined, SAID, { uncertain: [{ start: 30, end: 90, pct: 50, alts: [] }] }), {}, 'nothing valid: no marks');
  assert.deepEqual(withSpeech({}, undefined, SAID, 'junk'), {});
  assert.deepEqual(withSpeech({}, undefined, SAID, { dictated: [{ start: 0, end: 4 }] }), { marks: { dictated: [{ start: 0, end: 4 }] } }, 'typed and dictated, no speech meta');
});

test('ChatService: a person\'s marks are stored as meta.marks, an agent\'s are not; an edit drops them', () => {
  const h = harness();
  const tom = h.org.add(agent('ag_tom', 'Tom'));
  const chat = h.chats.create({ agentIds: [tom.id], createdBy: HUMAN_ID });
  const sent = h.chats.send({ conversationId: chat.id, body: SAID, authorId: HUMAN_ID, speech: { source: 'endpoint' }, marks: MARKS });
  assert.equal(sent.body, SAID, 'the body stays plain');
  assert.deepEqual(h.chats.message(sent.id)?.meta.marks, MARKS);
  assert.equal(h.chats.send({ conversationId: chat.id, body: SAID, authorId: tom.id, marks: MARKS }).meta.marks, undefined);
  assert.deepEqual(h.chats.edit(sent.id, SAID, HUMAN_ID).meta.marks, MARKS, 'the same words keep their marks');
  const edited = h.chats.edit(sent.id, 'Send the offer to Teydra by four', HUMAN_ID);
  assert.equal(edited.meta.marks, undefined);
  assert.equal(h.chats.message(sent.id)?.meta.marks, undefined, 'stored without them');
  assert.deepEqual(h.chats.message(sent.id)?.meta.speech, { source: 'endpoint' }, 'the rest of the meta stays');
});

test('context: the agent reads the marks written in, with the legend once; an older inline body reads the same', () => {
  const f = fixture();
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: HUMAN_ID });
  f.chats.send({ conversationId: chat.id, body: SAID, authorId: HUMAN_ID, speech: { source: 'endpoint' }, marks: MARKS });
  f.chats.send({ conversationId: chat.id, body: 'Call ⟦?Ben|40%⟧ later', authorId: HUMAN_ID });
  const text = f.context.delta({ agent: f.vid, conversationId: chat.id, sinceSeq: 0 }).text;
  assert.ok(text.includes('⟦Diktat⟧Send the offer to ⟦?Teydra|55%|Tedra 30%⟧ by three⟦/Diktat⟧'), text);
  assert.ok(text.includes('Call ⟦?Ben|40%⟧ later'));
  assert.equal(text.split(MARKS_LEGEND).length - 1, 1, 'the legend once');
});

test('review: span offsets are UTF-16 – an emoji and umlauts before the unsure word keep the mark on that word', () => {
  const f = fixture();
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: HUMAN_ID });
  const said = 'Grüße 👋 an Jürgen';
  const start = said.indexOf('Jürgen');
  f.chats.send({ conversationId: chat.id, body: said, authorId: HUMAN_ID, marks: { uncertain: [{ start, end: start + 6, pct: 50, alts: [{ t: 'Jörg', pct: 20 }] }] } });
  const text = f.context.delta({ agent: f.vid, conversationId: chat.id, sinceSeq: 0 }).text;
  assert.ok(text.includes('Grüße 👋 an ⟦?Jürgen|50%|Jörg 20%⟧'), text);
});

test('RPC messages.send takes `marks`; messages.edit drops them', async (t) => {
  const f = rpcFixture();
  t.after(f.cleanup);
  f.org.add(agent('ag_ava', 'Ava'));
  const phone = new TestClient(f.server, PHONE);
  const chat = await phone.call<Conversation>('chats.create', { agentIds: ['ag_ava'] });
  const sent = await phone.call<Message>('messages.send', { conversationId: chat.id, body: SAID, speech: { source: 'endpoint' }, marks: MARKS });
  assert.deepEqual(sent.meta.marks, MARKS);
  const edited = await phone.call<Message>('messages.edit', { id: sent.id, body: 'Something else' });
  assert.equal(edited.meta.marks, undefined);
});
