// 17.11.2026 (Konrad task_d4pdwppg, "Videos im Chat flüssig"): the light preview copy of heavy videos (runtime/media/preview.ts, wired in media/service.ts) on a real
// blob store with a fake host: a heavy video (probe: ≥ 6 MB and over ≈ 4 Mbit/s or a big picture) is queued once its facts are known and the host's preview
// window makes the copy; the copy is stored as a blob of its own that is NO media row (the library lists the original only), linked as `previewFileId` with one
// media.upserted event; the temp file of the host goes; a video that needs none gets its reason; a failure is kept and not retried on its own, a busy or
// closing host leaves the video undecided for the next try; a start picks up the videos nobody decided about; removing the original removes the copy;.
// Owns: these assertions only. Never: a real window or conversion (test/live/media-preview.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WorkforceError } from '../../../src/shared/errors.ts';
import type { MediaInfo } from '../../../src/shared/model/media.ts';
import type { VideoPreview } from '../../../src/shared/model/video-preview.ts';
import { MediaRepo } from '../../../src/runtime/media/repo.ts';
import { MediaService } from '../../../src/runtime/media/service.ts';
import { previewName } from '../../../src/runtime/media/preview.ts';
import { concat, mp4 } from './fixtures.ts';
import { mediaSetup } from './setup.ts';

const MB = 1024 * 1024;

/** An MP4 with a header of `width`×`height` and `durationMs`, padded to `bytes` (the probe reads the header only). */
const clip = (bytes: number, durationMs: number, width: number, height: number) => concat(mp4({ durationMs, video: { width, height } }), new Uint8Array(bytes));

/** A fake host whose preview window writes a small MP4-looking copy into a temp folder of its own, like main does. */
function fakeHost(setup: ReturnType<typeof mediaSetup>, behave: (call: number) => Promise<void> | void = () => undefined) {
  const dir = path.join(setup.temp.dir, 'previews');
  mkdirSync(dir, { recursive: true });
  const calls: Array<{ fileId: string; mime?: string }> = [];
  const written: string[] = [];
  const preview = async (input: { fileId: string; mime?: string }): Promise<VideoPreview> => {
    calls.push(input);
    await behave(calls.length);
    const file = path.join(dir, `preview-${calls.length.toString(16).padStart(16, '0')}.tmp`);
    const bytes = concat(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), new Uint8Array(100_000).fill(calls.length));
    writeFileSync(file, bytes);
    written.push(file);
    return { file, size: bytes.length, width: 720, height: 1280, durationMs: 14_500, mime: 'video/mp4' };
  };
  (setup.h.services as { host: unknown }).host = { kind: 'node', media: { keyframes: async () => { throw new Error('unused'); }, preview } };
  return { calls, written, dir };
}

/** Stores the video and lets the library know its bytes are here (a probe fills width/height/duration from the header). */
async function store(setup: ReturnType<typeof mediaSetup>, bytes: Uint8Array, name = 'export.mp4') {
  const file = await setup.put(bytes, name, 'video/mp4');
  await setup.media.idle();
  return file;
}

test('a heavy video gets a light copy: the host is asked once, the copy is a blob of its own and no media row, linked with one event, the temp file gone', async () => {
  const setup = mediaSetup();
  try {
    const host = fakeHost(setup);
    const file = await store(setup, clip(8 * MB, 14_500, 1080, 1920));
    await setup.media.idle();
    assert.deepEqual(host.calls, [{ fileId: file.id, mime: 'video/mp4' }]);
    const row = setup.media.get(file.id)!;
    assert.ok(row.previewFileId, 'linked');
    const copy = setup.h.services.files.get(row.previewFileId!)!;
    assert.equal(copy.mime, 'video/mp4');
    assert.equal(copy.name, 'export-preview.mp4', 'named after the video');
    assert.equal(copy.size, 100_012);
    assert.equal(setup.media.get(row.previewFileId!), undefined, 'the copy is no medium of its own');
    assert.deepEqual(setup.media.list().map((entry) => entry.fileId), [file.id], 'the library lists the original only');
    assert.equal(row.fileId, file.id);
    assert.equal(row.size, 8 * MB + mp4({ durationMs: 1, video: { width: 1, height: 1 } }).length, 'the original is as it was');
    const last = setup.upserts().at(-1) as MediaInfo;
    assert.equal(last.fileId, file.id);
    assert.equal(last.previewFileId, row.previewFileId, 'one event carries the link');
    assert.ok(host.written.every((entry) => !existsSync(entry)), 'main\'s temp file is removed');
    assert.equal(existsSync(path.join(host.dir, 'export-preview.mp4')), false);
    assert.equal(new MediaRepo(setup.h.db).originalOf(row.previewFileId!), file.id);
  } finally { setup.temp.cleanup(); }
});

test('a video that needs none gets its reason and no call: small, light, long; one whose length is not known yet waits for its probe', async () => {
  const setup = mediaSetup();
  try {
    const host = fakeHost(setup);
    const small = await store(setup, clip(1 * MB, 14_500, 1080, 1920), 'small.mp4');
    const light = await store(setup, clip(7 * MB, 120_000, 1920, 1080), 'light.mp4'); // 7 MB over 2 min: 0.5 Mbit/s
    const long = await store(setup, clip(8 * MB, 20 * 60_000, 1080, 1920), 'long.mp4');
    await setup.media.idle();
    assert.deepEqual(host.calls, []);
    const repo = new MediaRepo(setup.h.db);
    assert.deepEqual([small, light, long].map((file) => repo.previewState(file.id)), ['small', 'light', 'long']);
    assert.deepEqual([small, light, long].map((file) => setup.media.get(file.id)?.previewFileId), [undefined, undefined, undefined]);
  } finally { setup.temp.cleanup(); }
});

test('a host that cannot make it: bad request/failure is kept as \'failed\' and not tried again on its own; busy or closing leaves the video undecided and a later try works', async () => {
  const setup = mediaSetup();
  try {
    const modes: string[] = ['bad', 'busy', 'ok'];
    const host = fakeHost(setup, (call) => {
      const mode = modes[call - 1];
      if (mode === 'bad') throw new WorkforceError('bad_request', 'This video cannot be read here: the format or codec is not supported, or the file is damaged.');
      if (mode === 'busy') throw new WorkforceError('unavailable', 'The app is closing.');
    });
    const repo = new MediaRepo(setup.h.db);
    const broken = await store(setup, clip(8 * MB, 14_500, 1080, 1920), 'broken.mp4');
    await setup.media.idle();
    assert.equal(repo.previewState(broken.id), 'failed');
    setup.media.arrived(broken.id); // anything that asks again
    await setup.media.idle();
    assert.equal(host.calls.length, 1, 'a failed video is not tried again on its own');

    const busy = await store(setup, clip(9 * MB, 14_500, 1080, 1920), 'busy.mp4');
    await setup.media.idle();
    assert.equal(host.calls.length, 2);
    assert.equal(repo.previewState(busy.id), undefined, 'undecided');
    assert.equal(setup.media.get(busy.id)?.previewFileId, undefined);
    setup.media.arrived(busy.id);
    await setup.media.idle();
    assert.equal(host.calls.length, 3);
    assert.ok(setup.media.get(busy.id)?.previewFileId, 'made on the next try');
  } finally { setup.temp.cleanup(); }
});

test('a host without windows (headless) decides nothing; a start picks up the videos nobody decided about', async () => {
  const setup = mediaSetup();
  try {
    const file = await store(setup, clip(8 * MB, 14_500, 1080, 1920));
    await setup.media.idle();
    const repo = new MediaRepo(setup.h.db);
    assert.equal(repo.previewState(file.id), undefined, 'no host.media.preview: undecided');
    assert.equal(setup.media.get(file.id)?.previewFileId, undefined);

    const host = fakeHost(setup); // a desktop start
    const restarted = new MediaService({ services: () => setup.h.services, pdfPages: async () => undefined });
    await restarted.idle();
    assert.deepEqual(host.calls.map((call) => call.fileId), [file.id]);
    assert.ok(restarted.get(file.id)?.previewFileId);
  } finally { setup.temp.cleanup(); }
});

test('removing the video removes its copy; a copy that equals the video (nothing lightened) is not a copy', async () => {
  const setup = mediaSetup();
  try {
    fakeHost(setup);
    const file = await store(setup, clip(8 * MB, 14_500, 1080, 1920));
    await setup.media.idle();
    const previewId = setup.media.get(file.id)!.previewFileId!;
    assert.ok(existsSync(setup.h.services.files.path(previewId)));
    assert.equal(await (setup.h.services.files as unknown as { remove(id: string): Promise<boolean> }).remove(file.id), true);
    assert.equal(setup.h.services.files.get(file.id), undefined);
    assert.equal(setup.h.services.files.get(previewId), undefined, 'the copy goes with it');
    assert.equal(existsSync(setup.h.services.files.path(previewId)), false);
  } finally { setup.temp.cleanup(); }

  const same = mediaSetup();
  try {
    const bytes = clip(8 * MB, 14_500, 1080, 1920);
    const dir = path.join(same.temp.dir, 'previews');
    mkdirSync(dir, { recursive: true });
    const file = await store(same, bytes);
    (same.h.services as { host: unknown }).host = { kind: 'node', media: { keyframes: async () => { throw new Error('unused'); }, preview: async (): Promise<VideoPreview> => {
      const copy = path.join(dir, 'preview-0000000000000001.tmp');
      writeFileSync(copy, bytes);
      return { file: copy, size: bytes.length, width: 1080, height: 1920, durationMs: 14_500, mime: 'video/mp4' };
    } } };
    new MediaRepo(same.h.db).setPreviewState(file.id, 'x'); // forget below: undecided again
    same.h.db.run('UPDATE media SET preview_state = NULL WHERE file_id = ?', [file.id]);
    same.media.arrived(file.id);
    await same.media.idle();
    assert.equal(same.media.get(file.id)?.previewFileId, undefined);
    assert.equal(new MediaRepo(same.h.db).previewState(file.id), 'light');
  } finally { same.temp.cleanup(); }
});

test('the copy\'s file name: the video\'s own name without its type, then -preview.mp4 (webm for webm); odd characters become _', () => {
  assert.equal(previewName('Export final.MP4', 'video/mp4'), 'Export final-preview.mp4');
  assert.equal(previewName('a/b:c*d.mov', 'video/mp4'), 'a_b_c_d-preview.mp4');
  assert.equal(previewName('', 'video/webm'), 'video-preview.webm');
  assert.equal(previewName('Übung 1.mp4', 'video/mp4'), 'Übung 1-preview.mp4');
});

test('a copy whose bytes already are a file of their own is not linked: removing the video must not remove that file', async () => {
  const setup = mediaSetup();
  try {
    const host = fakeHost(setup);
    const same = concat(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), new Uint8Array(100_000).fill(1)); // what the first conversion writes
    const own = await setup.put(same, 'other-use.bin', 'application/octet-stream');
    const file = await store(setup, clip(8 * MB, 14_500, 1080, 1920));
    await setup.media.idle();
    assert.equal(host.calls.length, 1);
    assert.equal(setup.media.get(file.id)!.previewFileId, undefined, 'not linked');
    assert.equal(new MediaRepo(setup.h.db).previewState(file.id), 'shared');
    await (setup.h.services.files as unknown as { remove(id: string): Promise<boolean> }).remove(file.id);
    assert.ok(setup.h.services.files.get(own.id), 'the other file is still there');
  } finally { setup.temp.cleanup(); }
});
