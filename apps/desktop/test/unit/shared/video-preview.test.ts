// 17.11.2026 (Konrad task_d4pdwppg, "Videos im Chat flüssig"): the rules of a video's light preview copy (shared/model/video-preview.ts) – the checked request of the host op,
// the picture size (the short edge at most 720 px, never scaled up, even edges), the bitrate (≈ 2.5 Mbit/s at 720×1280 by the number of pixels, within a floor and a
// ceiling) and which videos need a copy at all: the real export that triggered it (1080×1920, 32.3 MB, 14.5 s ≈ 17.8 Mbit/s) does, a small or light or long one does not.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { PREVIEW_LIMITS, previewBitrate, previewRequest, previewSize, previewSpec, previewVerdict } from '../../../src/shared/model/video-preview.ts';

const MB = 1024 * 1024;

test('previewRequest: a blob id and, if given, a video type – nothing else', () => {
  const id = 'a'.repeat(64);
  assert.deepEqual(previewRequest({ fileId: id }), { fileId: id });
  assert.deepEqual(previewRequest({ fileId: id, mime: 'VIDEO/MP4' }), { fileId: id, mime: 'video/mp4' });
  for (const input of [{}, { fileId: 'x' }, { fileId: id.toUpperCase() }, { fileId: id, mime: 'image/png' }, { fileId: id, mime: 5 }, { fileId: id, mime: 'video/' }]) {
    assert.throws(() => previewRequest(input as never), (error: unknown) => error instanceof WorkforceError && error.code === 'bad_request', JSON.stringify(input));
  }
});

test('previewSize: the short edge within 720, the aspect kept, both edges even, never larger than the source', () => {
  assert.deepEqual(previewSize(1080, 1920), { width: 720, height: 1280 }, 'the portrait export');
  assert.deepEqual(previewSize(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(previewSize(3840, 2160), { width: 1280, height: 720 });
  assert.deepEqual(previewSize(640, 360), { width: 640, height: 360 }, 'small stays');
  assert.deepEqual(previewSize(720, 1280), { width: 720, height: 1280 });
  assert.deepEqual(previewSize(1000, 1777), { width: 720, height: 1280 }, 'odd results become even');
  const odd = previewSize(1081, 1921);
  assert.ok(odd.width % 2 === 0 && odd.height % 2 === 0 && Math.min(odd.width, odd.height) <= 720);
  assert.deepEqual(previewSize(0, 0), { width: 2, height: 2 }, 'never zero');
});

test('previewBitrate: 2.5 Mbit/s at 720×1280, by pixels for other sizes, between 0.8 and 3 Mbit/s', () => {
  assert.equal(previewBitrate(720, 1280), 2_500_000);
  assert.equal(previewBitrate(1280, 720), 2_500_000);
  assert.equal(previewBitrate(540, 960), Math.round(2_500_000 * (540 * 960) / (720 * 1280)));
  assert.equal(previewBitrate(3840, 2160), PREVIEW_LIMITS.maxBitrate, 'a ceiling');
  assert.equal(previewBitrate(160, 90), PREVIEW_LIMITS.minBitrate, 'a floor');
});

test('previewVerdict: the drone export needs a copy; small, light, long and not-yet-probed videos do not', () => {
  assert.equal(previewVerdict({ size: 32_300_622, width: 1080, height: 1920, durationMs: 14_500 }), undefined, 'the real export: 17.8 Mbit/s');
  assert.equal(previewVerdict({ size: 3 * MB, width: 1080, height: 1920, durationMs: 14_500 }), 'small');
  assert.equal(previewVerdict({ size: 8 * MB }), 'unknown', 'no length yet: its probe comes first');
  assert.equal(previewVerdict({ size: 8 * MB, durationMs: 0 }), 'unknown');
  assert.equal(previewVerdict({ size: 200 * MB, width: 1080, height: 1920, durationMs: 16 * 60_000 }), 'long');
  assert.equal(previewVerdict({ size: 7 * MB, width: 1920, height: 1080, durationMs: 120_000 }), 'light', '0.5 Mbit/s');
  assert.equal(previewVerdict({ size: 30 * MB, width: 640, height: 360, durationMs: 60_000 }), undefined, 'small picture but 4.2 Mbit/s: still heavy');
  assert.equal(previewVerdict({ size: 20 * MB, width: 1920, height: 1080, durationMs: 60_000 }), 'light', '1080p at 2.8 Mbit/s: a preview would hardly be lighter');
  assert.equal(previewVerdict({ size: 27 * MB, width: 1920, height: 1080, durationMs: 60_000 }), undefined, '1080p at 3.8 Mbit/s: a big picture shrunk to 720p at 2.5 Mbit/s');
  assert.equal(previewVerdict({ size: 10 * MB, width: 1920, height: 1080, durationMs: 60_000 }), 'light', '1080p at 1.4 Mbit/s is light');
});

test('previewSpec: what the page is told', () => {
  assert.deepEqual(previewSpec(4096, 'video/mp4'), {
    task: 'preview', shortEdge: 720, targetBitrate: 2_500_000, minBitrate: 800_000, maxBitrate: 3_000_000, maxFps: 30,
    maxDurationMs: 15 * 60_000, chunkBytes: 1024 * 1024, size: 4096, mime: 'video/mp4',
  });
});
