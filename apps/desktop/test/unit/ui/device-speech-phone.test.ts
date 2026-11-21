// B-084 calls on the phone (src/ui/chat/composer/device-speech.ts, conversation-audio.ts): in the Android app, whose
// WebView has no speechSynthesis voices, the device voice is the phone's own over the native port – `speak {id, text,
// lang}`, the line ends on its `speechDone {id}`, a stop sends `stopSpeech` and a late end finishes nothing; a page
// with voices or without the port keeps speechSynthesis; the PC's voice still comes first and hands the rest of a line
// to the phone's voice; primeSpeech opens the page's audio output inside the call's tap.
// Owns: these assertions only. Never: a real WebView, TextToSpeech, AudioContext or runtime.

import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { adoptPort, resetNativePort } from '../../../src/ui/pwa/native-port.ts';
import { localVoiceEngine, synthesisEngine } from '../../../src/ui/chat/composer/device-speech.ts';
import { primeSpeech } from '../../../src/ui/chat/composer/conversation-audio.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The app's port as the page sees it; `answer` is a message from the app. */
function fakePort(t: TestContext) {
  const sent: Array<Record<string, unknown>> = [];
  const port = { onmessage: null as ((event: { data: string }) => void) | null, postMessage: (data: string) => { sent.push(JSON.parse(data)); }, close: () => undefined };
  resetNativePort();
  adoptPort(port as unknown as MessagePort);
  t.after(() => resetNativePort());
  return { sent, answer: (msg: Record<string, unknown>) => port.onmessage!({ data: JSON.stringify(msg) }) };
}

/** speechSynthesis with `voices` (or none at all when undefined). */
function synthesis(t: TestContext, voices?: number) {
  const globals = globalThis as Record<string, unknown>;
  const saved = ['speechSynthesis', 'SpeechSynthesisUtterance'].map((key) => [key, globals[key]] as const);
  const spoken: string[] = [];
  if (voices !== undefined) {
    globals.speechSynthesis = { getVoices: () => Array.from({ length: voices }, (_, i) => ({ name: `v${i}`, lang: 'de-DE' })), speak: (u: { text: string }) => { spoken.push(u.text); }, cancel: () => undefined };
    globals.SpeechSynthesisUtterance = class { text: string; lang = ''; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(text: string) { this.text = text; } };
  }
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete globals[key]; else globals[key] = value; } });
  return spoken;
}

test('no speechSynthesis, but the app\'s port: the phone speaks the line and its own end finishes it once', (t) => {
  synthesis(t);
  const app = fakePort(t);
  const engine = synthesisEngine();
  let ended = 0;
  engine.play('Hallo, ich höre dich.', { language: 'de-DE' }, () => { ended += 1; });
  assert.equal(app.sent.length, 1);
  const { t: type, id, text, lang } = app.sent[0];
  assert.deepEqual({ type, text, lang }, { type: 'speak', text: 'Hallo, ich höre dich.', lang: 'de-DE' });
  app.answer({ t: 'speechDone', id: 'someone-else' });
  assert.equal(ended, 0, 'another line\'s end');
  app.answer({ t: 'speechDone', id });
  app.answer({ t: 'speechDone', id });
  assert.equal(ended, 1, 'ends once');
});

test('a stop sends stopSpeech and the cut line\'s late end finishes nothing', (t) => {
  synthesis(t, 0); // present without voices (Android WebView)
  const app = fakePort(t);
  const engine = synthesisEngine();
  let ended = 0;
  engine.play('Ein langer Satz.', {}, () => { ended += 1; });
  const id = app.sent[0].id;
  engine.stop();
  assert.deepEqual(app.sent.map((msg) => msg.t), ['speak', 'stopSpeech']);
  app.answer({ t: 'speechDone', id });
  assert.equal(ended, 0);
  engine.stop();
  assert.equal(app.sent.length, 2, 'nothing to stop: no second stopSpeech');
});

test('with voices, or without the port, speechSynthesis reads as before', (t) => {
  const spoken = synthesis(t, 2);
  const app = fakePort(t);
  synthesisEngine().play('Mit Stimme.', {}, () => undefined);
  assert.deepEqual(spoken, ['Mit Stimme.']);
  assert.equal(app.sent.length, 0);

  resetNativePort();
  const globals = globalThis as Record<string, unknown>;
  delete globals.speechSynthesis; // put back by synthesis()'s own after-hook
  delete globals.SpeechSynthesisUtterance;
  let ended = 0;
  synthesisEngine().play('Ohne alles.', {}, () => { ended += 1; });
  assert.equal(app.sent.length, 0);
  assert.equal(ended, 1, 'without the port and any voice the line ends at once, as before');
});

test('the PC\'s voice first: when voice.speak fails the phone\'s voice reads the rest of the line', async (t) => {
  synthesis(t);
  const app = fakePort(t);
  const engine = localVoiceEngine({ active: () => true, speak: async () => { throw new Error('unavailable'); }, play: async () => () => undefined }, synthesisEngine());
  let ended = 0;
  engine.play('Erster Satz ist hier. Zweiter Satz folgt jetzt.', {}, () => { ended += 1; });
  assert.equal(app.sent.length, 0, 'the PC is asked first');
  await flush();
  assert.equal(app.sent[0].t, 'speak');
  assert.equal(app.sent[0].text, 'Erster Satz ist hier. Zweiter Satz folgt jetzt.');
  app.answer({ t: 'speechDone', id: app.sent[0].id });
  assert.equal(ended, 1);
});

test('primeSpeech opens the page\'s audio output in the tap, once', (t) => {
  const globals = globalThis as Record<string, unknown>;
  const saved = globals.AudioContext;
  let made = 0;
  let resumed = 0;
  globals.AudioContext = class { state = 'suspended'; constructor() { made += 1; } resume() { resumed += 1; return Promise.resolve(); } };
  t.after(() => { if (saved === undefined) delete globals.AudioContext; else globals.AudioContext = saved; });
  synthesis(t);
  primeSpeech();
  primeSpeech();
  assert.equal(made, 1, 'one output for the page');
  assert.equal(resumed, 2, 'resumed in each tap');
});
