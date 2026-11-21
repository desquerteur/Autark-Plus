// 17.11.2026 (the owner via Clara: "Audio sollte man auch anhören können, wenn man es geschickt hat" – also above the message field): which attachments are
// recordings to play (lib/media-kinds.ts isRecording). The runtime stores the app's own takes as `video/webm`; they play in the draft chip and in the message
// when the media library says 'audio' or when the name is the composer's take name; `audio/*` always does; a real video never does.
// Owns: nothing in production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MediaKind } from '../../../src/shared/model/media.ts';
import { isRecording } from '../../../src/ui/lib/media-kinds.ts';

const file = (mime: string, name: string, fileId = 'a'.repeat(64)) => ({ mime, name, fileId });
const kinds = (entries: Array<[string, MediaKind]> = []) => new Map<string, MediaKind>(entries);

test('audio/* is always a recording, with or without parameters', () => {
  for (const mime of ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'AUDIO/OGG', 'audio/wav']) assert.equal(isRecording(file(mime, 'x'), kinds()), true, mime);
});

test('the app\'s own take (stored as video/webm by its bytes) is a recording at once – by its name, before any probe', () => {
  assert.equal(isRecording(file('video/webm', 'Recording 2026-11-17 19-46.webm'), kinds()), true, 'the message of the report');
  assert.equal(isRecording(file('video/mp4', 'Recording 2026-11-17 19-46.mp4'), kinds()), true);
  assert.equal(isRecording(file('video/webm', 'Video 2026-11-17 19-46.webm'), kinds()), false, 'a video take is a video');
  assert.equal(isRecording(file('video/webm', 'Recording of the demo.webm'), kinds()), false, 'only the composer\'s own name');
  assert.equal(isRecording(file('video/webm', 'Recording 2026-11-17 19-46.webm.exe'), kinds()), false);
});

test('any other container that may hold sound only is a recording when the media library says so', () => {
  const id = 'b'.repeat(64);
  const thing = file('video/webm', 'voice note.webm', id);
  assert.equal(isRecording(thing, kinds()), false, 'not known yet: a file');
  assert.equal(isRecording(thing, kinds([[id, 'audio']])), true, 'the probe found no picture');
  assert.equal(isRecording(thing, kinds([[id, 'video']])), false);
  for (const mime of ['video/mp4', 'video/ogg', 'video/x-matroska', 'video/quicktime', 'application/ogg']) assert.equal(isRecording(file(mime, 'a', id), kinds([[id, 'audio']])), true, mime);
});

test('what is no container of sound is never one, whatever the library or the name says', () => {
  const id = 'c'.repeat(64);
  for (const mime of ['image/png', 'application/pdf', 'text/plain', 'application/zip', '']) {
    assert.equal(isRecording(file(mime, 'Recording 2026-11-17 19-46.webm', id), kinds([[id, 'audio']])), false, mime || '(none)');
  }
});

// 18.11.2026 (Mika, window check of the installed build): a stored file has one owner chat, the first it was seen in. The same video sent in a
// second chat was not in that chat's media.list, so its chip had no length and the Video tab stayed empty. learnFiles asks by file id.
test('learnFiles: a video of another chat\'s library row gets its length from an ask by file id, once; a failed ask is tried again', async () => {
  const { rpc } = await import('../../../src/ui/lib/rpc.ts');
  const { learnFiles, videoFacts } = await import('../../../src/ui/lib/media-kinds.ts');
  const real = { call: rpc.call, on: rpc.on };
  const asks: unknown[] = [];
  let fail = true;
  const id = 'd'.repeat(64);
  (rpc as { call: unknown }).call = async (method: string, params: unknown) => {
    asks.push([method, params]);
    if (fail) throw new Error('offline');
    return [{ fileId: id, kind: 'video', durationMs: 14_500, previewFileId: 'e'.repeat(64) }];
  };
  try {
    learnFiles([id, id]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(asks, [['media.list', { fileIds: [id], limit: 100 }]], 'one ask for the file, asked by id');
    assert.equal(videoFacts.value.has(id), false, 'a failed ask learns nothing');
    fail = false;
    learnFiles([id]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(asks.length, 2, 'the failed ask is tried again');
    assert.equal(videoFacts.value.get(id)?.durationMs, 14_500);
    learnFiles([id]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(asks.length, 2, 'known: not asked again');
  } finally { (rpc as { call: unknown }).call = real.call; }
});
