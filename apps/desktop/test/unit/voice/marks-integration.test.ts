// B-082 integration: the hidden marks reach the agent on every path that shows a person's whole line – a line folded
// into a running turn (agents/dispatch-steer.ts, MARKS_LEGEND once) – and never sit on words they were not made for
// (a condensed line, context/ledger/marks.ts); a person's recording whose hearing failed can be heard again
// (people/rpc-voice.ts) and a call line goes `live`.
// Owns: these assertions only. Never: real timers, engines, audio or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../context/fixture.ts';
import { mid, ledgerSetup } from '../context/ledger-fixture.ts';
import { peopleRig } from '../people/rig.ts';
import { steerInput } from '../../../src/runtime/agents/dispatch-steer.ts';
import { agentBody } from '../../../src/runtime/context/render.ts';
import { register as calls } from '../../../src/runtime/rpc/handlers/calls.ts';
import { MARKS_LEGEND, markedForAgent, type TextMarks } from '../../../src/shared/voice/marks.ts';

const SAID = 'Send the offer to Teydra by three';
const MARKS: TextMarks = { uncertain: [{ start: 18, end: 24, pct: 55, alts: [{ t: 'Tedra', pct: 30 }] }] };

test('steer: a person\'s line folded into a running turn carries its unsure places, the legend once', () => {
  const f = fixture();
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: 'human' });
  const start = f.chats.send({ conversationId: chat.id, body: 'Start', authorId: 'human' });
  f.chats.send({ conversationId: chat.id, body: SAID, authorId: 'human', speech: { source: 'endpoint' }, marks: MARKS });
  f.chats.send({ conversationId: chat.id, body: SAID, authorId: 'human', marks: MARKS });
  const steered = steerInput(f.services, f.vid.id, chat.id, start.seq)!;
  const inline = markedForAgent(SAID, MARKS);
  assert.notEqual(inline, SAID);
  assert.equal(steered.text.split(inline).length - 1, 2, 'both lines with their marks written in');
  assert.equal(steered.text.split(MARKS_LEGEND).length - 1, 1, 'the legend once');
  const plain = f.chats.send({ conversationId: chat.id, body: 'Typed', authorId: 'human' });
  assert.doesNotMatch(steerInput(f.services, f.vid.id, chat.id, plain.seq - 1)!.text, /⟦/, 'no marks, no legend');
});

test('ledger: a condensed line loses the marks of the words it no longer has', () => {
  const t = ledgerSetup();
  try {
    const line = t.chats.send({ conversationId: t.chat.id, authorId: 'human', body: SAID, marks: MARKS });
    assert.notEqual(agentBody(line), SAID);
    t.done(t.turn(line.seq));
    t.ledger.mark(t.tom.id, 'main', [{ itemId: mid(t.db, line), state: 'condensed', condensed: 'offer to a customer', reason: 'old', by: 'subconscious' }]);
    const out = t.ledger.view(t.tom.id, 'main').find((item) => item.itemId === mid(t.db, line))!;
    assert.match(out.text, /offer to a customer/);
    assert.doesNotMatch(out.text, /⟦/, 'nothing written into the condensed words');
  } finally { t.cleanup(); }
});

test('person: a call line goes `live`; a recording whose hearing failed can be asked once more', async () => {
  const rig = peopleRig({ modules: [calls] });
  try {
    const { client } = await rig.join('Pat');
    const asked: unknown[] = [];
    let fail = true;
    Object.assign(rig.extras, { voice: { transcribe: async (input: unknown) => { asked.push(input); if (fail) throw new Error('down'); return { text: 'hallo' }; } } });
    const ref = await client.call<{ id: string }>('files.upload', { name: 'Utterance.wav', mime: 'audio/wav', dataBase64: Buffer.from('RIFF0000WAVE').toString('base64') });
    await assert.rejects(client.call('voice.transcribe', { fileId: ref.id, live: true }));
    fail = false;
    assert.deepEqual(await client.call('voice.transcribe', { fileId: ref.id, live: true }), { text: 'hallo' });
    assert.deepEqual(asked.at(-1), { fileId: ref.id, language: undefined, live: true });
    await assert.rejects(client.call('voice.transcribe', { fileId: ref.id }), /once/, 'heard: not again');
  } finally { rig.cleanup(); }
});
