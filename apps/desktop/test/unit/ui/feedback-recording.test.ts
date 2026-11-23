// Feedback 16.11.2026 (F15, system-Q1): the feedback dictation keeps its voice – the same microphone stream runs a
// MediaRecorder (Opus/WebM at 12 kbps, MP4 on the iPhone) while "Recording" is on; the take is kept before its words
// are heard, so a take that could not be transcribed still reaches the report with its recording, and a dropped take
// keeps nothing (src/ui/feedback/recording.ts, bridge.ts recordingDictation, draft.ts).
// Owns: these assertions. Never: a real microphone or MediaRecorder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TakeNotTranscribed } from '../../../src/ui/lib/dictation.ts';
import { KEPT_NOT_HEARD, RECORDING_BITS, TakeRecorder, plainMime, recordingDictation, recordingLength, recordingMime } from '../../../src/ui/feedback/recording.ts';
import type { RecordedTake, RecorderLike, TakeRecording, TakeWords } from '../../../src/ui/feedback/recording.ts';
import {
  CRASH_ONLY_TEXT, EMPTY_DRAFT, UNTRANSCRIBED_TEXT, addRecording, attachCrashReport, canSubmit, clearDraft, feedbackDraft, isEmptyDraft, reportText,
} from '../../../src/ui/feedback/draft.ts';
import { recordingText } from '../../../src/ui/feedback/delivery.ts';

test('the recorder asks for Opus in WebM, else MP4 (the iPhone), else nothing the inbox would take', () => {
  assert.deepEqual(recordingMime((type) => type === 'audio/webm;codecs=opus'), { request: 'audio/webm;codecs=opus', mime: 'audio/webm' });
  assert.deepEqual(recordingMime((type) => type === 'audio/mp4'), { request: 'audio/mp4', mime: 'audio/mp4' });
  assert.equal(recordingMime(() => false), null);
  assert.equal(recordingMime(() => { throw new Error('no'); }), null);
  assert.equal(plainMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(plainMime('audio/mp4; codecs="mp4a.40.2"'), 'audio/mp4');
  assert.equal(plainMime('audio/ogg'), null);
  assert.equal(recordingLength(42_400), '0:42');
  assert.equal(recordingLength(65_000), '1:05');
  assert.equal(recordingLength(3_903_000), '1:05:03');
  assert.equal(recordingText(0, '0:00', true), 'Dictating keeps your voice with the words.');
  assert.equal(recordingText(1, '0:42', true), '0:42 – goes with the words.');
  assert.equal(recordingText(2, '1:23', false), '2 takes · 1:23 – only the words go.');
});

/** A MediaRecorder stand-in: start() records, stop() hands the chunks and ends. */
function fakeRecorder(mimeType = 'audio/webm;codecs=opus') {
  const made: Array<{ options: unknown; recorder: RecorderLike & { timeslice?: number } }> = [];
  let now = 1000;
  const env = {
    now: () => now,
    isTypeSupported: (type: string) => type === 'audio/webm;codecs=opus',
    create: (_stream: MediaStream, options: unknown) => {
      const recorder: RecorderLike & { timeslice?: number } = {
        state: 'inactive', mimeType, ondataavailable: null, onstop: null, onerror: null,
        start(timeslice) { (this as { state: string }).state = 'recording'; this.timeslice = timeslice; },
        stop() {
          (this as { state: string }).state = 'inactive';
          queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]) }); this.onstop?.(); });
        },
      };
      made.push({ options, recorder });
      return recorder;
    },
  };
  return { env, made, tick: (ms: number) => { now += ms; } };
}

const STREAM = {} as MediaStream;

test('a kept take is the recorder\'s audio with its length; a cancelled one keeps nothing', async () => {
  const fake = fakeRecorder();
  const recorder = new TakeRecorder(fake.env);
  recorder.begin(STREAM);
  assert.deepEqual(fake.made[0]!.options, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: RECORDING_BITS });
  assert.equal(fake.made[0]!.recorder.timeslice, 1000);
  fake.tick(4200);
  const take = await recorder.keep();
  assert.equal(take?.mime, 'audio/webm');
  assert.equal(take?.blob.type, 'audio/webm', 'stored with the plain type the inbox checks');
  assert.equal(take?.ms, 4200);
  assert.equal(await recorder.keep(), null, 'one take, kept once');
  recorder.begin(STREAM);
  recorder.cancel();
  assert.equal(await recorder.keep(), null);
  recorder.begin(undefined);
  assert.equal(await recorder.keep(), null, 'no stream: nothing');
  const none = new TakeRecorder({ ...fake.env, create: () => null });
  none.begin(STREAM);
  assert.equal(await none.keep(), null, 'no MediaRecorder here: the report is text-only');
  const asked: unknown[] = [];
  const picky = new TakeRecorder({ ...fake.env, create: (stream, options) => { asked.push(options); if (options.audioBitsPerSecond) throw new Error('NotSupportedError'); return fake.env.create(stream, options); } });
  picky.begin(STREAM);
  assert.deepEqual(asked, [{ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: RECORDING_BITS }, { mimeType: 'audio/webm;codecs=opus' }], 'a browser refusing the rate records at its own');
  assert.equal((await picky.keep())?.mime, 'audio/webm');
});

/** The dictation's words and the recording, both fakes. */
function engines(change: { finish?: () => Promise<{ text: string }>; wanted?: boolean; take?: RecordedTake | null } = {}) {
  const log: string[] = [];
  const added: RecordedTake[] = [];
  let ended: () => void = () => undefined;
  const words: TakeWords = {
    start: async (onEnded) => { ended = onEnded; log.push('words start'); },
    get stream() { return STREAM; },
    finish: async () => { log.push('words finish'); return change.finish ? change.finish() : { text: 'Die Seite hängt' }; },
    cancel: () => { log.push('words cancel'); },
  };
  const take: RecordedTake | null = change.take === undefined ? { blob: new Blob(['x'], { type: 'audio/webm' }), mime: 'audio/webm', ms: 3000 } : change.take;
  const recording: TakeRecording = {
    wanted: () => change.wanted ?? true,
    begin: (stream) => { log.push(stream ? 'record' : 'record nothing'); },
    keep: async () => { log.push('keep'); return take; },
    cancel: () => { log.push('record cancel'); },
    add: (kept) => { added.push(kept); },
  };
  return { log, added, button: recordingDictation(words, recording), end: () => ended() };
}

test('the take keeps its voice before its words are heard', async () => {
  const run = engines();
  await run.button.start(() => undefined);
  assert.equal(await run.button.finish('de'), 'Die Seite hängt');
  assert.deepEqual(run.log, ['words start', 'record', 'keep', 'words finish'], 'kept before the microphone closes');
  assert.equal(run.added.length, 1);
});

test('a take that could not be heard still goes with its recording; without one the error stays', async () => {
  const run = engines({ finish: async () => { throw new TakeNotTranscribed(new Error('No speech service.')); } });
  await run.button.start(() => undefined);
  await assert.rejects(run.button.finish(), new Error(KEPT_NOT_HEARD));
  assert.equal(run.added.length, 1, 'its voice is in the report');
  const bare = engines({ take: null, finish: async () => { throw new TakeNotTranscribed(new Error('No speech service.')); } });
  await bare.button.start(() => undefined);
  await assert.rejects(bare.button.finish(), /No speech service/);
});

test('"Recording" off records nothing; a dropped or overtaken take keeps nothing', async () => {
  const off = engines({ wanted: false });
  await off.button.start(() => undefined);
  assert.deepEqual(off.log, ['words start']);
  const dropped = engines();
  await dropped.button.start(() => undefined);
  dropped.button.cancel();
  assert.deepEqual(dropped.log, ['words start', 'record', 'record cancel', 'words cancel']);
  assert.equal(dropped.added.length, 0);
  const overtaken = engines();
  let told = false;
  await overtaken.button.start(() => { told = true; });
  overtaken.end(); // another dictation took the microphone
  assert.ok(told);
  assert.ok(overtaken.log.includes('record cancel'));
});

test('the draft: a recording or a crash report alone is enough to send, with words that say what it is', () => {
  clearDraft();
  const take: RecordedTake = { blob: new Blob(['x'], { type: 'audio/webm' }), mime: 'audio/webm', ms: 1000 };
  assert.equal(canSubmit(feedbackDraft.peek()), false);
  assert.equal(isEmptyDraft(feedbackDraft.peek()), true);
  for (let i = 0; i < 6; i++) addRecording(take);
  assert.equal(feedbackDraft.peek().audio.length, 4, 'at most four recordings');
  assert.equal(canSubmit(feedbackDraft.peek()), true);
  assert.equal(reportText(feedbackDraft.peek()), UNTRANSCRIBED_TEXT);
  assert.equal(canSubmit({ ...feedbackDraft.peek(), withAudio: false }), false, 'unchecked: the recording does not count');
  clearDraft();
  attachCrashReport(`  ${'trace '.repeat(3000)}  `);
  const crash = feedbackDraft.peek();
  assert.equal(crash.diagnostics?.length, 12_000, 'bounded like the runtime');
  assert.equal(crash.withDiagnostics, true);
  assert.equal(canSubmit(crash), true);
  assert.equal(reportText(crash), CRASH_ONLY_TEXT);
  assert.equal(reportText({ ...crash, text: '  Die App stürzt ab ' }), 'Die App stürzt ab');
  attachCrashReport('   ');
  assert.equal(feedbackDraft.peek().diagnostics, crash.diagnostics, 'an empty report changes nothing');
  clearDraft();
  assert.deepEqual(feedbackDraft.peek(), EMPTY_DRAFT);
});
