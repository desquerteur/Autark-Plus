// Owner 19.11.2026 – what this device shows on a call (ui/chat/call/call-view-model.ts): a drag marks a cut-out (a click or a
// sliver none, either direction the same, clamped to the picture), the cut-out maps onto the picture's pixels, a picture goes
// out at most FRAME_MAX on its long side and never larger, and an unchanged picture does not go out again.
// Owns: these assertions only. Never: a stream, a canvas or the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGED, FRAME_MAX, changed, cutBetween, fingerprint, outSize, sourceRect } from '../../../src/ui/chat/call/call-view-model.ts';

test('call view: a drag marks a cut-out in either direction, clamped; a click marks none', () => {
  assert.deepEqual(cutBetween({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 }), { x: 0.2, y: 0.3, w: 0.39999999999999997, h: 0.5 });
  assert.deepEqual(cutBetween({ x: -0.2, y: 0.5 }, { x: 0.5, y: 1.4 }), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
  assert.equal(cutBetween({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 }), undefined);
});

test('call view: the cut-out in pixels; the size that goes out', () => {
  assert.deepEqual(sourceRect(1920, 1080), { sx: 0, sy: 0, sw: 1920, sh: 1080 });
  assert.deepEqual(sourceRect(1920, 1080, { x: 0.5, y: 0.5, w: 0.25, h: 0.5 }), { sx: 960, sy: 540, sw: 480, sh: 540 });
  assert.deepEqual(outSize(2560, 1440), { width: FRAME_MAX, height: 720 });
  assert.deepEqual(outSize(720, 1280), { width: 720, height: 1280 });
  assert.deepEqual(outSize(480, 540), { width: 480, height: 540 }, 'a cut-out is never blown up');
});

test('call view: the first picture goes out; one like it does not; a changed one does', () => {
  const grey = (value: number) => fingerprint(new Array(16 * 16 * 4).fill(value));
  assert.equal(changed(undefined, grey(100)), true);
  assert.equal(changed(grey(100), grey(100 + CHANGED - 1)), false);
  assert.equal(changed(grey(100), grey(100 + CHANGED)), true);
});
