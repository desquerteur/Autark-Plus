// B-081 T9: touch on the mirrored picture with the zoom view (src/ui/workspace/browser-touch.ts) – one finger first
// moves the zoomed picture and scrolls the page only with what went past its edge (all of it at 1x), at the start
// point in frame units; two fingers pinch (the distance's ratio around the new midpoint, after the midpoint's move)
// instead of being ignored, and a gesture that had two fingers never clicks; a tap still clicks. With the real zoom view
// (view-zoom.ts) a slow pinch of many ~1 % steps zooms in both modes, passing 1 and back zooms again, and only the lift
// settles a pinch that ended just above 1.
// Owns: these assertions only. Never: a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairOf, touchGestures, type TouchLike, type TouchMap } from '../../../src/ui/workspace/browser-touch.ts';
import { padGestures } from '../../../src/ui/workspace/browser-pad.ts';
import { FIT, pan, pinch, settle, type ZoomRoom, type ZoomView } from '../../../src/ui/workspace/view-zoom.ts';
import type { BrowserInput } from '../../../src/shared/model/browser.ts';

/** A 1280 × 720 frame drawn 640 px wide (2 frame px per screen px); zoomed, the picture's x offset may go from -300 to 0. */
function rig(zoomed: boolean) {
  const sent: BrowserInput[] = [];
  const pinches: number[][] = [];
  let x = -150;
  const map: TouchMap = {
    point: (cx, cy) => (cx >= 0 && cy >= 0 && cx <= 640 && cy <= 360 ? { x: cx * 2, y: cy * 2, width: 1280, height: 720 } : undefined),
    scale: () => 2,
    pan: (dx, dy) => {
      if (!zoomed) return { x: dx, y: dy };
      const next = Math.min(0, Math.max(-300, x + dx));
      const rest = x + dx - next;
      x = next;
      return { x: rest, y: dy }; // vertically it is not zoomed past the box here
    },
    pinch: (...args) => { pinches.push(args); },
  };
  const gestures = touchGestures(map, (input) => sent.push(input));
  const at = (points: Array<[number, number]>, timeStamp: number): TouchLike => ({ touches: points.map(([clientX, clientY]) => ({ clientX, clientY })), timeStamp });
  return { sent, pinches, gestures, at, offset: () => x };
}

test('zoomed, one finger moves the picture to its edge and then scrolls the page with the rest; at 1x it all scrolls', () => {
  const r = rig(true);
  r.gestures.start(r.at([[300, 200]], 1000));
  r.gestures.move(r.at([[400, 200]], 1010)); // +100: inside the range, the picture moves
  assert.equal(r.offset(), -50);
  assert.deepEqual(r.sent, [], 'nothing past the edge yet');
  r.gestures.move(r.at([[500, 200]], 1020)); // +100 more: 50 to the edge, 50 past it
  assert.equal(r.offset(), 0, 'the left edge is reached');
  assert.deepEqual(r.sent, [{ kind: 'wheel', x: 600, y: 400, width: 1280, height: 720, deltaX: -100, deltaY: 0 }], 'the rest scrolls the page left at the start point');
  assert.equal(r.gestures.end(r.at([], 1100)), true, 'handled: no synthetic click');

  const flat = rig(false);
  flat.gestures.start(flat.at([[300, 300]], 1000));
  flat.gestures.move(flat.at([[300, 240]], 1010));
  assert.deepEqual(flat.sent, [{ kind: 'wheel', x: 600, y: 600, width: 1280, height: 720, deltaX: 0, deltaY: 120 }]);
});

test('two fingers pinch around their midpoint (after its move) and never click; the next tap clicks again', () => {
  const r = rig(true);
  r.gestures.start(r.at([[100, 100]], 1000));
  r.gestures.start(r.at([[100, 100], [200, 100]], 1010));
  r.gestures.move(r.at([[90, 110], [230, 110]], 1020)); // 100 → 140 apart, the midpoint 150,100 → 160,110
  assert.deepEqual(r.pinches, [[160, 110, 1.4, 10, 10]]);
  r.gestures.move(r.at([[90, 110], [230, 110]], 1030));
  assert.deepEqual(r.pinches.at(-1), [160, 110, 1, 0, 0], 'no change: ratio 1');
  assert.equal(r.gestures.end(r.at([[230, 110]], 1040)), true);
  r.gestures.move(r.at([[260, 110]], 1050));
  assert.equal(r.pinches.length, 2, 'one finger left of two: nothing until all are lifted');
  assert.equal(r.gestures.end(r.at([], 1060)), true);
  assert.equal(r.sent.length, 0, 'no click, no scroll');
  r.gestures.start(r.at([[100, 50]], 2000));
  r.gestures.end(r.at([], 2080));
  assert.deepEqual(r.sent.map((input) => input.kind === 'mouse' && input.type), ['down', 'up']);
  assert.equal(pairOf(r.at([[0, 0]], 0)), undefined, 'one finger is no pair');
});

/** The real zoom view wired as BrowserSurface does (pinch after pan; the box at the client's origin), in either mode. */
function zoomRig(mode: 'touch' | 'pad') {
  const room: ZoomRoom = { box: { width: 390, height: 700 }, picture: { left: 0, top: 0, width: 390, height: 700 } };
  let view: ZoomView = FIT;
  const pinchAt = (x: number, y: number, ratio: number, dx: number, dy: number) => { view = pinch(pan(view, dx, dy, room).view, { x, y }, ratio, room); };
  const gestures = mode === 'pad'
    ? padGestures({ frame: () => ({ width: 390, height: 700 }), scale: () => 1, pinch: pinchAt }, () => {}, () => {})
    : touchGestures({ point: () => undefined, scale: () => 1, pan: (dx, dy) => ({ x: dx, y: dy }), pinch: pinchAt }, () => {});
  const fingers = (d: number, timeStamp: number): TouchLike => ({ touches: [{ clientX: 195 - d / 2, clientY: 350 }, { clientX: 195 + d / 2, clientY: 350 }], timeStamp });
  /** Two fingers down at `from` px apart, then one touchmove per 8 ms through `steps` (distances). */
  const pinchThrough = (from: number, steps: number[]) => {
    gestures.start({ touches: [{ clientX: 195 - from / 2, clientY: 350 }], timeStamp: 0 });
    gestures.start(fingers(from, 1));
    steps.forEach((d, i) => gestures.move(fingers(d, 8 * (i + 1))));
  };
  const lift = () => { gestures.end({ touches: [], timeStamp: 9999 }); view = settle(view); };
  return { pinchThrough, lift, view: () => view };
}
const ramp = (from: number, to: number, count: number) => Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 1)) / count);

test('a slow pinch from the fitted picture builds up step by step (60 moves of about 1 %, both modes); it settles on lift', () => {
  for (const mode of ['touch', 'pad'] as const) {
    const slow = zoomRig(mode);
    slow.pinchThrough(100, ramp(100, 200, 60)); // 100 → 200 px apart: twice the size
    assert.ok(Math.abs(slow.view().s - 2) < 1e-6, `${mode}: s ${slow.view().s} ≈ 2`);
    slow.lift();
    assert.ok(Math.abs(slow.view().s - 2) < 1e-6, `${mode}: it stays at 2 when the fingers lift`);

    const back = zoomRig(mode); // in, all the way out past 1, and in again within the same gesture
    back.pinchThrough(200, [...ramp(200, 300, 30), ...ramp(300, 150, 50), ...ramp(150, 240, 45)]);
    assert.ok(back.view().s > 1.5, `${mode}: zoomed again after passing 1 (s ${back.view().s})`);

    const small = zoomRig(mode); // a pinch that ends just above 1 is the fitted picture when the fingers lift
    small.pinchThrough(200, [...ramp(200, 240, 20), ...ramp(240, 202, 20)]);
    assert.ok(small.view().s > 1 && small.view().s < 1.02, `${mode}: s ${small.view().s} while down`);
    small.lift();
    assert.deepEqual(small.view(), FIT);
  }
});
