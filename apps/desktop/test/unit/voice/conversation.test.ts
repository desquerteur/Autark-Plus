// The voice conversation loop (shared/voice/conversation.ts): an utterance is transcribed and sent in the
// listening chat (marked live), the agent's reply is read aloud and the microphone listens again; nothing
// heard asks to say it again; speech while a reply is awaited goes out at once; parallel chats (simplest
// form): the chat started or focused last hears, replies are read one at a time with another chat's title in
// front; talking over the reading stops it; B-082: every line is heard live (`live: true`), a line that cannot be heard
// goes as its recording and the call goes on. Each talking chat is a
// call (calls.start/end, its id on every line; a page without calls talks too); the wait for a reply goes on while an
// agent of the chat works and opens again when one starts later. B-081: a start with a callId takes that call and reads
// every new agent line (the opening first); another holder in the call row ends the chat quietly; the speaker's name
// goes in front when the speaker changes.
// Owns: these assertions only. Never: a microphone, a speech output or a runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_VOICE_SESSIONS, REPEAT_HINT, SESSIONS_FULL, VoiceSessions, speakable } from '../../../src/shared/voice/conversation.ts';
import type { ConversationRpc, VoiceSessionEntry, VoiceSessionView } from '../../../src/shared/voice/conversation.ts';
import type { Message } from '../../../src/shared/model/chat.ts';

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setImmediate(resolve)); };

function setup(heard: string[] = [], options: { noCalls?: boolean; runtimeCall?: string } = {}) {
  const listeners = new Map<string, Array<(message: Message) => void>>();
  const sent: Array<{ conversationId: string; body: string; live?: boolean; call?: string; attachments?: string[] }> = [];
  const transcribed: Array<Record<string, unknown>> = [];
  const ended: string[] = [];
  const starts: Array<Record<string, unknown>> = [];
  const working = new Set<string>();
  const timers: Array<() => void> = [];
  const spoken: string[] = [];
  const states: Array<{ mic: VoiceSessionView | null; error?: string; chats: VoiceSessionEntry[] }> = [];
  let seq = 10;
  let silenced = 0;
  let id = 0;
  let transcribeError: Error | undefined;
  let sendError: Error | undefined;
  const rpc: ConversationRpc = {
    call: (async (method: string, params: Record<string, unknown>) => {
      if (method === 'chats.get') return { id: params.id, title: params.id === 'ch_b' ? 'Research' : 'Main', working: working.has(params.id as string) ? ['ag_tom'] : [] };
      if (method === 'voice.transcribe') { transcribed.push(params); if (transcribeError) throw transcribeError; return { text: heard.shift() ?? '' }; }
      if (method === 'calls.start') {
        starts.push(params);
        if (options.noCalls) throw new Error('forbidden');
        return { callId: (params.callId as string | undefined) ?? `call_${params.conversationId as string}`, holder: '/device:pc' };
      }
      if (method === 'calls.end') { ended.push(params.callId as string); return { ok: true }; }
      if (method === 'messages.send') {
        if (sendError) throw sendError;
        const speech = params.speech as { live?: boolean; call?: string } | undefined;
        const files = (params.attachments as Array<{ fileId: string }> | undefined)?.map((attachment) => attachment.fileId);
        sent.push({ conversationId: params.conversationId as string, body: params.body as string, live: speech?.live, ...(speech?.call ? { call: speech.call } : {}), ...(files ? { attachments: files } : {}) });
        const call = speech?.call ?? options.runtimeCall; // runtimeCall: the runtime opens the device's call for a line that names none
        return { seq: ++seq, meta: call ? { call: { id: call } } : {} };
      }
      throw new Error(`unexpected ${method}`);
    }) as ConversationRpc['call'],
    on: ((event: string, listener: (message: Message) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => undefined;
    }) as ConversationRpc['on'],
    subscribe: async () => () => undefined,
  };
  const voice = new VoiceSessions({
    rpc,
    publish: (mic, error, chats) => states.push({ mic, error, chats }),
    speak: (_micId, text) => spoken.push(text),
    silence: () => { silenced += 1; },
    newId: () => `id${++id}`,
    after: (_ms, fn) => { timers.push(fn); return () => { const at = timers.indexOf(fn); if (at >= 0) timers.splice(at, 1); }; },
    language: () => 'de',
    nameOf: (agentId) => ({ ag_ava: 'Ava', ag_ben: 'Ben' } as Record<string, string>)[agentId],
  });
  const emit = (event: 'message.created' | 'message.updated', message: Message) => { for (const listener of listeners.get(event) ?? []) listener(message); };
  const reply = (conversationId: string, body: string, state: Message['state'] = 'final', authorId?: string) => {
    emit('message.created', { id: `m${++seq}`, conversationId, seq, authorKind: 'agent', authorId, kind: 'text', state, body, meta: {} } as unknown as Message);
  };
  return {
    voice, sent, spoken, states, reply, emit, ended, starts, working, transcribed,
    /** The reply timers run out now. */
    elapse: async () => { for (const fn of timers.splice(0)) fn(); await tick(); },
    mic: () => voice.view(),
    silenced: () => silenced,
    failTranscription: (error: Error | undefined) => { transcribeError = error; },
    failSend: (error: Error | undefined) => { sendError = error; },
  };
}

test('utterance → transcription → a live message; the reply is read and the microphone listens again', async () => {
  const t = setup(['Wie wird das Wetter?']);
  const view = await t.voice.start('ch_a');
  assert.equal(view.status, 'listening');
  await t.voice.utterance(view.id, 'f1');
  assert.deepEqual(t.sent, [{ conversationId: 'ch_a', body: 'Wie wird das Wetter?', live: true, call: 'call_ch_a' }], 'the line of the chat\'s call');
  assert.equal(t.voice.sessions()[0].status, 'responding');
  assert.equal(t.mic()?.status, 'listening', 'the person may talk while the reply is awaited');
  t.reply('ch_a', 'Sonnig mit **20 Grad**.', 'streaming');
  assert.deepEqual(t.spoken, []);
  t.reply('ch_a', 'Sonnig mit **20 Grad**.');
  assert.deepEqual(t.spoken, [speakable('Sonnig mit **20 Grad**.')]);
  assert.equal(t.mic()?.status, 'speaking');
  t.voice.spokenDone(view.id);
  assert.equal(t.mic()?.status, 'listening');
});

test('no words heard asks to say it again; an utterance while a reply is read is not taken', async () => {
  const t = setup(['', 'hello', 'not taken']);
  const view = await t.voice.start('ch_a');
  await t.voice.utterance(view.id, 'f1');
  assert.equal(t.mic()?.hint, REPEAT_HINT);
  assert.equal(t.sent.length, 0);
  await t.voice.utterance(view.id, 'f2');
  t.reply('ch_a', 'Hi.');
  await t.voice.utterance(view.id, 'f3'); // the echo guard: the reading would be heard
  assert.deepEqual(t.sent.map((line) => line.body), ['hello']);
});

test('speech while a reply is awaited goes out at once; that reply is then not read', async () => {
  const t = setup(['first', 'second']);
  const view = await t.voice.start('ch_a');
  await t.voice.utterance(view.id, 'f1');
  await t.voice.utterance(view.id, 'f2');
  await tick();
  assert.deepEqual(t.sent.map((line) => line.body), ['first', 'second']);
});

test('parallel chats: the newest listens, another chat reply is read with its title, focus moves by start', async () => {
  const t = setup(['to research', 'to main']);
  await t.voice.start('ch_a');
  const view = await t.voice.start('ch_b');
  assert.equal(t.mic()?.conversationId, 'ch_b');
  assert.deepEqual(t.voice.sessions().map((chat) => [chat.conversationId, chat.listening]), [['ch_b', true], ['ch_a', false]]);
  await t.voice.utterance(view.id, 'f1');
  assert.equal(t.sent[0].conversationId, 'ch_b');
  await t.voice.start('ch_a'); // focus
  assert.equal(t.mic()?.conversationId, 'ch_a');
  await t.voice.utterance(view.id, 'f2');
  assert.equal(t.sent[1].conversationId, 'ch_a');
  t.reply('ch_b', 'Found three papers.');
  t.reply('ch_a', 'Done.');
  assert.deepEqual(t.spoken, ['Research: Found three papers.']);
  t.voice.spokenDone(view.id);
  assert.deepEqual(t.spoken, ['Research: Found three papers.', 'Done.']);
  await t.voice.start('ch_c');
  await assert.rejects(t.voice.start('ch_d'), new RegExp(SESSIONS_FULL.slice(0, 20)));
  assert.equal(t.voice.sessions().length, MAX_VOICE_SESSIONS);
});

test('talking over the reading stops it and drops what waits; ending the reading chat silences it', async () => {
  const t = setup(['a']);
  const view = await t.voice.start('ch_a');
  await t.voice.utterance(view.id, 'f1');
  t.reply('ch_a', 'One.');
  assert.equal(t.voice.bargeIn(view.id), true);
  assert.equal(t.silenced(), 1);
  assert.equal(t.mic()?.status, 'listening');
  assert.equal(t.voice.bargeIn(view.id), false, 'nothing is read');
  t.voice.stop('ch_a');
  assert.equal(t.mic(), null);
  assert.equal(t.voice.active, false);
  assert.deepEqual(t.ended, ['call_ch_a'], 'ending the chat ends its call');
});

test('a page that cannot start calls talks without one', async () => {
  const t = setup(['hallo'], { noCalls: true });
  const view = await t.voice.start('ch_a');
  await t.voice.utterance(view.id, 'f1');
  assert.deepEqual(t.sent, [{ conversationId: 'ch_a', body: 'hallo', live: true }]);
  t.voice.stop('ch_a');
  assert.deepEqual(t.ended, []);
});

test('a call the runtime opened for a line (calls.start failed) is the one the end reaches', async () => {
  const t = setup(['hallo', 'noch was'], { noCalls: true, runtimeCall: 'call_runtime' });
  const view = await t.voice.start('ch_a');
  await t.voice.utterance(view.id, 'f1');
  t.reply('ch_a', 'Hallo!');
  t.voice.spokenDone(view.id);
  await t.voice.utterance(view.id, 'f2');
  assert.deepEqual(t.sent.map((line) => line.call), [undefined, 'call_runtime'], 'the next line names it');
  t.voice.stop('ch_a');
  assert.deepEqual(t.ended, ['call_runtime']);
});

test('the wait for a reply goes on while an agent of the chat works, ends when none does, and opens again when one starts', async () => {
  const t = setup(['Mach den Export']);
  const view = await t.voice.start('ch_a');
  await t.voice.utterance(view.id, 'f1');
  t.working.add('ch_a'); // e.g. a row that streams on the agent's home PC
  await t.elapse();
  assert.equal(t.voice.sessions()[0].status, 'responding', 'still waiting after the reply time');
  t.working.delete('ch_a');
  await t.elapse();
  assert.equal(t.voice.sessions()[0].status, 'listening', 'nobody works on it: the wait ends');
  t.reply('ch_a', '', 'streaming'); // an agent starts its answer later
  assert.equal(t.voice.sessions()[0].status, 'responding');
  t.reply('ch_a', 'Export ist fertig.');
  assert.deepEqual(t.spoken, ['Export ist fertig.']);
  assert.notEqual(t.voice.sessions()[0].status, 'responding');
});

test('B-082: lines are heard live; a line that cannot be heard goes as its recording and the call goes on', async () => {
  const t = setup(['Und dann?']);
  const view = await t.voice.start('ch_a');
  t.failTranscription(new Error('Speech to text is not set up yet.'));
  await t.voice.utterance(view.id, 'f1');
  await tick();
  assert.deepEqual(t.transcribed, [{ fileId: 'f1', live: true, language: 'de' }]);
  assert.equal(t.voice.active, true, 'the conversation goes on');
  assert.deepEqual(t.sent, [{ conversationId: 'ch_a', body: '', live: true, call: 'call_ch_a', attachments: ['f1'] }], 'the line as its recording, a line of the call');
  assert.equal(t.voice.sessions()[0].status, 'responding', 'the reply to it is awaited');
  assert.deepEqual([t.ended, t.states.at(-1)?.error], [[], undefined]);
  t.reply('ch_a', 'Verstanden.');
  assert.deepEqual(t.spoken, ['Verstanden.']);
  t.voice.spokenDone(view.id);
  t.failTranscription(undefined);
  await t.voice.utterance(view.id, 'f2');
  assert.deepEqual(t.sent.at(-1), { conversationId: 'ch_a', body: 'Und dann?', live: true, call: 'call_ch_a' }, 'the next line is heard again');
});

test('B-082: a line neither heard nor sent asks to say it again; the conversation goes on and listens', async () => {
  const t = setup();
  const view = await t.voice.start('ch_a');
  t.failTranscription(new Error('The plan is used up.'));
  t.failSend(new Error('The connection dropped.'));
  await t.voice.utterance(view.id, 'f1');
  await tick();
  assert.deepEqual([t.voice.active, t.sent, t.ended], [true, [], []]);
  assert.deepEqual([t.mic()?.status, t.mic()?.hint], ['listening', REPEAT_HINT]);
  assert.equal(t.voice.sessions()[0].status, 'listening', 'no reply is awaited for a line that never went out');
});

test('B-081: a start with a callId takes that call; the opening line and every new agent line are read, the name when the speaker changes', async () => {
  const t = setup();
  const view = await t.voice.start('ch_a', 'call_ring');
  assert.deepEqual(t.starts, [{ conversationId: 'ch_a', callId: 'call_ring' }]);
  t.reply('ch_a', 'Gerd, kurz zum Logo.', 'final', 'ag_ava'); // the opening line, before the person said anything
  assert.deepEqual(t.spoken, ['Gerd, kurz zum Logo.']);
  t.voice.spokenDone(view.id);
  t.reply('ch_a', 'Und das Budget reicht.', 'final', 'ag_ben');
  t.voice.spokenDone(view.id);
  t.reply('ch_a', 'Danke, Ben.', 'final', 'ag_ava');
  assert.deepEqual(t.spoken, ['Gerd, kurz zum Logo.', 'Ben: Und das Budget reicht.', 'Ava: Danke, Ben.']);
});

test('B-081: another device took the call (its row shows another holder) – the chat ends quietly, without calls.end', async () => {
  const t = setup();
  await t.voice.start('ch_a', 'call_ring');
  const row = (participant: string) => ({ id: 'm_row', conversationId: 'ch_a', seq: 1, authorKind: 'system', kind: 'status', state: 'final', body: '', meta: { call: { id: 'call_ring', participant, name: 'x', startedAt: 1, lines: [] } } }) as unknown as Message;
  t.emit('message.updated', row('device:pc')); // its own row: nothing happens
  assert.equal(t.voice.active, true);
  t.emit('message.updated', row('device:dev_phone'));
  assert.equal(t.voice.active, false);
  assert.deepEqual(t.ended, [], 'the call goes on on the phone');
  assert.equal(t.states.at(-1)?.error, undefined, 'no error');
  const fails = setup(undefined, { noCalls: true });
  await assert.rejects(fails.voice.start('ch_a', 'call_gone'), /forbidden/, 'a call that cannot be taken does not start a conversation without it');
});

test('B-081: a pin goes into a talking chat as a line of its call and its reply is read; a chat that does not talk takes none', async () => {
  const t = setup(['und das hier']);
  assert.equal(t.voice.add('ch_a', 'Pinned on localhost (tab web-1):'), false, 'nothing talks yet');
  const view = await t.voice.start('ch_a');
  assert.equal(t.voice.add('ch_b', 'Pinned on localhost (tab web-1):'), false, 'another chat does not talk');
  assert.equal(t.voice.add('ch_a', '  '), false);
  assert.equal(t.voice.add('ch_a', 'Pinned on localhost (tab web-1):\nbutton · button.buy'), true);
  assert.deepEqual(t.sent, [{ conversationId: 'ch_a', body: 'Pinned on localhost (tab web-1):\nbutton · button.buy', live: true, call: 'call_ch_a' }]);
  await t.voice.utterance(view.id, 'f1'); // said while the pin's reply is awaited: out at once, as speech is
  await tick();
  assert.deepEqual(t.sent.map((line) => line.body), ['Pinned on localhost (tab web-1):\nbutton · button.buy', 'und das hier']);
  t.reply('ch_a', 'Zwei Pixel kleiner?');
  assert.deepEqual(t.spoken, ['Zwei Pixel kleiner?']);
});
