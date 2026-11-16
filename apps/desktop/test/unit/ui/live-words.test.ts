// F23 live words (ui/blocks/ui/live-words.ts): the recorder's stream heard in short pieces – LiveCutter ends a piece from
// 1.5 s on at a pause, at the latest at 3.5 s at its quietest block, and makes no piece of silence or a click – and the
// heard-piece signal of lib/dictation.ts (`heardPieces`): each piece as soon as it is heard, in order, with its words or
// why not; a newer take starts it empty and an older take's late answer never lands in it. The hearing taps the
// recorder's own stream (lib/microphone.ts `stream`) and asks for `live` lines.
// Owns: these assertions only. Never: a real microphone or runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_MAX_MS, LiveCutter, liveDeps, liveLine, liveText } from '../../../src/ui/blocks/ui/live-words.ts';
import { Dictation } from '../../../src/ui/lib/dictation.ts';
import type { DictationDeps } from '../../../src/ui/lib/dictation.ts';
import { openMicrophone } from '../../../src/ui/lib/microphone.ts';
import type { SampleListener } from '../../../src/ui/lib/microphone.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';

const QUIET = 0.001;
const SPEECH = 0.2;

/** One 32 ms block of 16 kHz PCM16 at `level`. */
function block(level: number): Uint8Array {
  const bytes = new Uint8Array(1024);
  const view = new DataView(bytes.buffer);
  for (let at = 0; at < 1024; at += 2) view.setInt16(at, Math.round(level * 32767), true);
  return bytes;
}

/** Feeds `ms` of blocks at `level`; the pieces cut meanwhile, with the ms fed before each. */
function feed(cutter: LiveCutter, ms: number, level: number, fed = { ms: 0 }) {
  const pieces: Array<{ ms: number; at: number }> = [];
  for (let at = 0; at < ms; at += 32) {
    fed.ms += 32;
    const piece = cutter.push(block(level));
    if (piece) pieces.push({ ms: piece.ms, at: fed.ms });
  }
  return pieces;
}

test('silence makes no piece, however long', () => {
  const cutter = new LiveCutter();
  assert.deepEqual(feed(cutter, 5000, QUIET), []);
  assert.equal(cutter.flush(), null);
});

test('a piece from 1.5 s on ends at the next pause of 200 ms, with a short lead-in before its first sound', () => {
  const cutter = new LiveCutter();
  const fed = { ms: 0 };
  assert.deepEqual(feed(cutter, 1024, QUIET, fed), []);
  assert.deepEqual(feed(cutter, 1504, SPEECH, fed), [], 'no cut while speaking');
  const pieces = feed(cutter, 992, QUIET, fed);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].at, 1024 + 1504 + 224, 'cut once 200 ms of pause passed');
  assert.equal(pieces[0].ms, 224 + 1504 + 224, 'lead-in, speech, pause');
  assert.equal(cutter.flush(), null, 'the pause after it is no piece');
});

test('a short word waits for 1.5 s in all; a click makes no piece', () => {
  const word = new LiveCutter();
  const fed = { ms: 0 };
  feed(word, 500, QUIET, fed);
  feed(word, 512, SPEECH, fed);
  const pieces = feed(word, 2000, QUIET, fed);
  assert.equal(pieces.length, 1);
  assert.ok(pieces[0].ms >= 1500 && pieces[0].ms < 1540, `one piece of about 1.5 s (${pieces[0].ms})`);
  const click = new LiveCutter();
  feed(click, 500, QUIET);
  feed(click, 64, SPEECH);
  assert.deepEqual(feed(click, 3000, QUIET), []);
});

test('speech without a pause is cut at 3.5 s at its quietest block of the last 0.8 s; the rest goes on', () => {
  const cutter = new LiveCutter();
  const fed = { ms: 0 };
  feed(cutter, 512, QUIET, fed); // the piece starts 224 ms before the speech: at 288
  feed(cutter, 3008, SPEECH, fed); // up to 224 + 3008 = 3232 ms in the piece
  feed(cutter, 32, 0.1, fed); // the quietest block, ending the piece at 3264 ms
  const pieces = feed(cutter, 2016, SPEECH, fed);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].ms, 3264);
  assert.ok(pieces[0].at - 288 <= LIVE_MAX_MS + 32, 'cut once the piece reached 3.5 s');
  const rest = cutter.flush();
  assert.ok(rest && rest.ms > 0, 'the speech after the cut stays for the next piece');
});

function setup(answer: (call: number) => Promise<{ text: string }> | { text: string } | Error) {
  const listeners: SampleListener[] = [];
  let calls = 0;
  let files = 0;
  const deps: DictationDeps = {
    problem: () => undefined,
    openMicrophone: async (onSamples) => { listeners.push(onSamples); return { stream: {} as MediaStream, close: () => undefined }; },
    upload: async (blob, name) => ({ id: `f${++files}`, name, mime: blob.type, size: blob.size }) as never,
    transcribe: async () => {
      const result = answer(++calls);
      if (result instanceof Error) throw result;
      return result as never;
    },
    now: () => 1000,
    cutter: () => new LiveCutter(),
  };
  const say = (ms: number, level: number) => { for (let at = 0; at < ms; at += 32) listeners.at(-1)!(new Float32Array(512).fill(level), 16_000); };
  const dictation = new Dictation(deps);
  return { dictation, say, calls: () => calls, heard: () => dictation.heardPieces.value };
}

const settle = async () => { for (let round = 0; round < 20; round++) await new Promise((resolve) => setTimeout(resolve, 0)); };

test('the heard-piece signal gives each piece as soon as it is heard, while the take still records', async () => {
  const t = setup((call) => ({ text: call === 1 ? ' Hallo zusammen ' : 'wie geht es euch' }));
  await t.dictation.start();
  assert.deepEqual(t.heard(), []);
  t.say(1600, SPEECH);
  t.say(300, 0.0005);
  await settle();
  assert.equal(t.heard().length, 1, 'heard before Stop');
  assert.equal(t.heard()[0].text, ' Hallo zusammen ');
  assert.ok(t.heard()[0].ms >= 1600);
  t.say(1600, SPEECH);
  t.say(300, 0.0005);
  await settle();
  assert.deepEqual(t.heard().map((piece) => piece.text), [' Hallo zusammen ', 'wie geht es euch']);
  assert.equal(liveText(t.heard()), 'Hallo zusammen wie geht es euch');
  t.dictation.cancel();
});

test('a piece that could not be heard comes with its reason', async () => {
  const t = setup(() => new Error('Speech to text is not set up yet.'));
  await t.dictation.start();
  t.say(1600, SPEECH);
  t.say(300, 0.0005);
  await settle();
  assert.deepEqual(t.heard().map((piece) => piece.error), ['Speech to text is not set up yet.']);
  t.dictation.cancel();
});

test('a newer take starts the signal empty; the older take\'s late answer does not land in it', async () => {
  let release: (value: { text: string }) => void = () => undefined;
  const t = setup((call) => (call === 1 ? new Promise((resolve) => { release = resolve; }) : { text: 'neu' }));
  await t.dictation.start();
  t.say(1600, SPEECH);
  t.say(300, 0.0005);
  await settle();
  assert.equal(t.calls(), 1, 'the first piece is being heard');
  await t.dictation.start();
  assert.deepEqual(t.heard(), []);
  release({ text: 'alt' });
  await settle();
  assert.deepEqual(t.heard(), [], 'the older take\'s words stay out');
  t.say(1600, SPEECH);
  t.say(300, 0.0005);
  await settle();
  assert.deepEqual(t.heard().map((piece) => piece.text), ['neu']);
  t.dictation.cancel();
});

test('the live hearing asks voice.transcribe for a live line (no second model, no marks)', async () => {
  const asked: unknown[] = [];
  const original = rpc.call;
  (rpc as unknown as { call: (method: string, params: unknown) => Promise<unknown> }).call = async (method, params) => { asked.push([method, params]); return { text: 'ok' }; };
  try {
    await liveDeps({} as MediaStream).transcribe({ fileId: 'f1', language: 'de' });
  } finally {
    (rpc as unknown as { call: typeof original }).call = original;
  }
  assert.deepEqual(asked, [['voice.transcribe', { fileId: 'f1', language: 'de', live: true }]]);
});

test('one microphone: the live hearing listens to the recorder\'s stream – no second device, its tracks stay open at close', async () => {
  class FakeContext {
    readonly sampleRate = 16_000;
    readonly destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { onaudioprocess: null, connect() {}, disconnect() {} }; }
    async resume() {}
    async close() {}
  }
  Object.assign(globalThis, { AudioContext: FakeContext });
  let opened = 0;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { opened++; throw new Error('a second device'); } } });
  const track = { stopped: false, stop() { this.stopped = true; } };
  const recorders = { getTracks: () => [track] } as unknown as MediaStream;
  const mic = await openMicrophone(() => undefined, { sampleRate: 16_000, stream: recorders });
  assert.equal(mic.stream, recorders);
  assert.equal(opened, 0, 'no getUserMedia');
  mic.close();
  assert.equal(track.stopped, false, 'the recorder still records');
});

test('the line under the timer: the words, else why none come, else "Listening…" once recording', () => {
  assert.equal(liveLine({ text: 'Hallo', note: 'x' }, true), 'Hallo');
  assert.equal(liveLine({ text: '', note: 'Speech model downloading 40 %' }, true), 'Speech model downloading 40 %');
  assert.equal(liveLine({ text: '' }, true), 'Listening…');
  assert.equal(liveLine({ text: '' }, false), '', 'nothing while the recorder starts');
  assert.equal(liveText([{ ms: 1, text: ' a ' }, { ms: 1, error: 'x' }, { ms: 1, text: '' }, { ms: 1, text: 'b' }]), 'a b');
});
