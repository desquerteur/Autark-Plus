// B-081 T9: the touch screen as a touchpad over the mirrored page (src/ui/workspace/browser-pad.ts) – the cursor starts
// in the frame's centre and moves by the finger's movement (frame px per screen px, the mild speed curve), never by
// where the finger is; it stays on the frame; every move goes out as a mouse move; a tap clicks at the cursor (not at
// the finger), a quick second tap double-clicks, tap-then-drag holds the button; two fingers scroll at the cursor,
// pinch through the map, and a two-finger tap right-clicks.
// Owns: these assertions only. Never: a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAST_GAIN, gain, padGestures, type PadMap } from '../../../src/ui/workspace/browser-pad.ts';
import type { TouchLike } from '../../../src/ui/workspace/browser-touch.ts';
import type { BrowserInput } from '../../../src/shared/model/browser.ts';

/** A 1280 × 720 frame drawn 640 px wide: 2 frame px per screen px. */
function rig(scale = 2) {
  const sent: BrowserInput[] = [];
  const cursor: Array<{ x: number; y: number }> = [];
  const pinches: number[][] = [];
  const map: PadMap = { frame: () => ({ width: 1280, height: 720 }), scale: () => scale, pinch: (...args) => { pinches.push(args); } };
  const pad = padGestures(map, (input) => sent.push(input), (at) => cursor.push({ x: at.x, y: at.y }));
  const at = (points: Array<[number, number]>, timeStamp: number): TouchLike => ({ touches: points.map(([clientX, clientY]) => ({ clientX, clientY })), timeStamp });
  /** One finger down at (x, y), moved through `path` (2 px steps stay slow), lifted after `ms`. */
  const finger = (x: number, y: number, t: number, ms = 80, path: Array<[number, number]> = []) => {
    pad.start(at([[x, y]], t));
    for (const point of path) pad.move(at([point], t + 10));
    return pad.end(at([], t + ms));
  };
  const kinds = () => sent.map((input) => (input.kind === 'mouse' ? `${input.type}${input.button ? ` ${input.button}` : ''}${input.clicks ? ` ${input.clicks}` : ''}` : input.kind));
  return { sent, cursor, pinches, pad, at, finger, kinds };
}

test('the cursor starts in the centre and moves by the finger\'s movement in frame units, not to the finger', () => {
  const r = rig();
  assert.deepEqual(r.pad.at(), { x: 640, y: 360, width: 1280, height: 720 });
  // a slow drag: 10 + 2 + 2 + 2 + 2 px to the right, starting far from the cursor (the first step passes the slop)
  r.finger(20, 600, 1000, 200, [[30, 600], [32, 600], [34, 600], [36, 600], [38, 600]]);
  const last = r.cursor.at(-1)!;
  assert.ok(last.x > 640 + 4 * 2 * 2 && last.x < 640 + 18 * 2 * FAST_GAIN, `moved right by the finger: ${last.x}`);
  assert.equal(last.y, 360, 'no vertical move');
  assert.ok(r.sent.every((input) => input.kind === 'mouse' && input.type === 'move' && input.buttons === 0), 'only moves, no button');
  assert.equal(r.sent.length, 5, 'one move per finger move past the slop');
});

test('the speed curve: ×1 up to 4 px per event, up to ×2.5 when fast', () => {
  assert.equal(gain(0), 1);
  assert.equal(gain(4), 1);
  assert.ok(gain(14) > 1 && gain(14) < FAST_GAIN);
  assert.equal(gain(24), FAST_GAIN);
  assert.equal(gain(200), FAST_GAIN);
  const slow = rig();
  slow.finger(0, 0, 1000, 200, [[10, 0], [13, 0]]); // a 3 px step after the slop
  const fast = rig();
  fast.finger(0, 0, 1000, 200, [[10, 0], [40, 0]]); // a 30 px step
  const step = (r: ReturnType<typeof rig>) => r.cursor[1]!.x - r.cursor[0]!.x;
  assert.equal(step(slow), 3 * 2, 'slow: the finger\'s distance in frame px');
  assert.equal(step(fast), 30 * 2 * FAST_GAIN, 'fast: 2.5 times');
});

test('the cursor stays on the frame', () => {
  const r = rig();
  r.finger(0, 0, 1000, 200, [[20, 0], [2000, 3000]]);
  assert.deepEqual(r.cursor.at(-1), { x: 1280, y: 720 });
  r.finger(2000, 3000, 2000, 200, [[1990, 2990], [-9000, -9000]]);
  assert.deepEqual(r.cursor.at(-1), { x: 0, y: 0 });
});

test('a tap clicks at the cursor, not at the finger; a quick second tap double-clicks; a long press does nothing', () => {
  const r = rig();
  assert.equal(r.finger(10, 10, 1000), true, 'handled: the synthetic mouse events are cancelled');
  assert.deepEqual(r.sent, [
    { kind: 'mouse', type: 'down', x: 640, y: 360, width: 1280, height: 720, button: 'left', buttons: 1, clicks: 1 },
    { kind: 'mouse', type: 'up', x: 640, y: 360, width: 1280, height: 720, button: 'left', buttons: 0, clicks: 1 },
  ]);
  r.sent.length = 0;
  r.finger(300, 300, 1200); // 120 ms after the first tap, anywhere on the screen
  assert.deepEqual(r.kinds(), ['down left 2', 'up left 2']);
  r.sent.length = 0;
  r.finger(300, 300, 3000, 900);
  assert.deepEqual(r.sent, [], 'a long press');
});

test('tap, then drag: the button is held while the cursor moves and let go when the finger lifts', () => {
  const r = rig();
  r.finger(100, 100, 1000);
  r.sent.length = 0;
  r.finger(100, 100, 1200, 300, [[120, 100], [124, 100]]);
  assert.deepEqual(r.kinds(), ['down left 1', 'move', 'move', 'up left 1']);
  assert.ok(r.sent.filter((input) => input.kind === 'mouse' && input.type === 'move').every((input) => input.kind === 'mouse' && input.buttons === 1), 'moves carry the held button');
  r.sent.length = 0;
  r.finger(100, 100, 5000, 300, [[120, 100]]);
  assert.deepEqual(r.kinds(), ['move'], 'a drag long after a tap only moves the cursor');
});

test('two fingers: the midpoint\'s move scrolls the page at the cursor, a distance change pinches, a quick two-finger tap right-clicks', () => {
  const r = rig();
  r.pad.start(r.at([[100, 400]], 1000));
  r.pad.start(r.at([[100, 400], [200, 400]], 1005));
  r.pad.move(r.at([[100, 380], [200, 380]], 1020)); // 20 px up: past the slop, no distance change – a scroll
  r.pad.move(r.at([[100, 370], [200, 370]], 1030));
  assert.equal(r.pad.end(r.at([[200, 370]], 1040)), true);
  assert.equal(r.pad.end(r.at([], 1050)), true);
  assert.deepEqual(r.sent, [
    { kind: 'wheel', x: 640, y: 360, width: 1280, height: 720, deltaX: 0, deltaY: 40 },
    { kind: 'wheel', x: 640, y: 360, width: 1280, height: 720, deltaX: 0, deltaY: 20 },
  ], 'at the cursor, the page follows the fingers');
  assert.equal(r.pinches.length, 0);

  const p = rig();
  p.pad.start(p.at([[100, 400], [200, 400]], 1000));
  p.pad.move(p.at([[80, 400], [220, 400]], 1020)); // 40 px apart more: a pinch
  p.pad.move(p.at([[60, 400], [240, 400]], 1030));
  p.pad.end(p.at([], 1040));
  assert.deepEqual(p.pinches.map(([x, y, ratio]) => [x, y, Number(ratio!.toFixed(3))]), [[150, 400, 1.4], [150, 400, 1.286]]);
  assert.deepEqual(p.sent, [], 'a pinch sends nothing to the page');

  const tap = rig();
  tap.pad.start(tap.at([[100, 400], [200, 400]], 1000));
  tap.pad.end(tap.at([[200, 400]], 1080));
  tap.pad.end(tap.at([], 1090));
  assert.deepEqual(tap.kinds(), ['down right 1', 'up right 1']);
  assert.deepEqual(tap.sent.map((input) => input.kind === 'mouse' && [input.x, input.y]), [[640, 360], [640, 360]]);
});
