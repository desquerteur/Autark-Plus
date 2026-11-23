// B-081 T9: the zoom of a live picture on a touch screen (src/ui/workspace/view-zoom.ts) – the zoomed picture can be
// moved to every edge (the left one included) and no further, for a portrait picture that fills its box and a landscape
// one letterboxed at the top; pan gives back what went past an edge (all of it at s 1); a pinch keeps the picture point
// under the fingers there, s stays within 1 … 4, a pinch back to 1 is the fitted picture and one that ends just above 1
// is it again only when the fingers lift (settle – a slow pinch's 1 % steps build up from 1); the Zoom button zooms
// around the box's centre; drawnPoint and follow keep the touchpad's cursor in sight.
// Owns: these assertions only. Never: a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIT, ZOOM_MAX, clampOffset, drawnPoint, follow, pan, pinch, settle, zoomTo, type ZoomRoom, type ZoomView } from '../../../src/ui/workspace/view-zoom.ts';

/** A phone's box with a viewer-sized picture filling it, and a 1280×800 page letterboxed at the top centre. */
const PORTRAIT: ZoomRoom = { box: { width: 390, height: 700 }, picture: { left: 0, top: 0, width: 390, height: 700 } };
const LANDSCAPE: ZoomRoom = { box: { width: 390, height: 700 }, picture: { left: 0, top: 0, width: 390, height: 243.75 } };
const NARROW: ZoomRoom = { box: { width: 600, height: 400 }, picture: { left: 100, top: 0, width: 400, height: 250 } };

/** The zoomed picture's drawn box in the room's box. */
const drawn = (view: ZoomView, room: ZoomRoom) => ({
  left: room.picture.left + view.x, top: room.picture.top + view.y,
  right: room.picture.left + view.x + room.picture.width * view.s, bottom: room.picture.top + view.y + room.picture.height * view.s,
});
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} ≈ ${b}`);

test('panned as far as it goes, the zoomed picture reaches every edge of the box and never leaves a gap (s 1.5, 2, 4)', () => {
  for (const room of [PORTRAIT, LANDSCAPE, NARROW]) {
    for (const s of [1.5, 2, 4]) {
      const start = zoomTo(s, room);
      const far = 100_000;
      const left = pan(start, far, 0, room).view; // the finger goes right: the picture's left edge comes into the box
      const right = pan(start, -far, 0, room).view;
      const top = pan(start, 0, far, room).view;
      const bottom = pan(start, 0, -far, room).view;
      const wide = room.picture.width * s >= room.box.width;
      if (wide) {
        near(drawn(left, room).left, 0, `left edge s ${s}`);
        near(drawn(right, room).right, room.box.width, `right edge s ${s}`);
      } else {
        assert.ok(drawn(left, room).right <= room.box.width + 1e-6 && drawn(right, room).left >= -1e-6, 'smaller than the box: it stays inside');
      }
      const tall = room.picture.height * s >= room.box.height;
      if (tall) {
        near(drawn(top, room).top, 0, `top edge s ${s}`);
        near(drawn(bottom, room).bottom, room.box.height, `bottom edge s ${s}`);
      } else {
        near(drawn(top, room).bottom, room.box.height, 'a short picture goes down to the box\'s bottom at most');
        near(drawn(bottom, room).top, 0, 'and up to its top');
      }
    }
  }
});

test('pan gives back what went past an edge – all of it at s 1 (the page scrolls by that)', () => {
  const fit = pan(FIT, 30, -40, PORTRAIT);
  assert.deepEqual(fit.view, FIT);
  assert.deepEqual(fit.rest, { x: 30, y: -40 });
  const start = zoomTo(2, PORTRAIT); // x -195, y -350: centred
  near(start.x, -195, 'centred x');
  near(start.y, -350, 'centred y');
  const inside = pan(start, 50, 20, PORTRAIT);
  assert.deepEqual(inside.rest, { x: 0, y: 0 }, 'inside the range nothing is left');
  const past = pan(start, 300, 0, PORTRAIT);
  near(past.view.x, 0, 'stopped at the left edge');
  near(past.rest.x, 105, 'the rest past it');
});

test('a pinch keeps the picture point under the fingers there; s stays within 1 … 4; back to 1 is the fitted picture', () => {
  const at = { x: 120, y: 500 };
  const view = pinch(FIT, at, 2, PORTRAIT);
  assert.equal(view.s, 2);
  // the picture point under (120, 500) before: (120, 500); after: drawn at left + x + 120 × 2
  near(view.x + 120 * 2, 120, 'x under the fingers');
  near(view.y + 500 * 2, 500, 'y under the fingers');
  const more = pinch(view, at, 10, PORTRAIT);
  assert.equal(more.s, ZOOM_MAX, 'never past 4');
  assert.deepEqual(pinch(view, at, 0.1, PORTRAIT), FIT, 'never below 1: back to the fitted picture');
  const near1 = pinch(view, at, 0.505, PORTRAIT);
  near(near1.s, 1.01, 'just above 1 stays while the fingers are down (a slow pinch builds on it)');
  assert.deepEqual(settle(near1), FIT, 'and is the fitted picture when they lift');
  assert.deepEqual(settle(view), view, 'a real zoom stays when they lift');
  assert.deepEqual(pinch(FIT, at, 1.01, PORTRAIT).s, 1.01, 'from the fitted picture a 1 % step zooms');
  assert.deepEqual(pinch(FIT, at, Number.NaN, PORTRAIT), FIT, 'a broken ratio changes nothing');
  const edge = pinch(FIT, { x: 0, y: 0 }, 3, PORTRAIT);
  assert.deepEqual([edge.x, edge.y], [0, 0], 'around the top-left corner it stays there');
});

test('clampOffset keeps a stale offset in range (the box got smaller) and s 1 is no transform', () => {
  assert.deepEqual(clampOffset({ s: 1, x: 40, y: 40 }, PORTRAIT), FIT);
  const big = clampOffset({ s: 2, x: 500, y: -5000 }, PORTRAIT);
  assert.deepEqual([big.x, big.y], [0, -700]);
});

test('drawnPoint maps a frame point onto the zoomed picture; follow pans just enough to keep it in sight', () => {
  const frame = { width: 390, height: 700 };
  const view = zoomTo(2, PORTRAIT);
  const centre = drawnPoint(view, PORTRAIT, frame, { x: 195, y: 350 })!;
  near(centre.left, 195, 'the centre stays in the centre');
  near(centre.top, 350, 'the centre stays in the centre');
  assert.equal(drawnPoint(view, PORTRAIT, { width: 0, height: 0 }, { x: 1, y: 1 }), undefined);
  const wide = drawnPoint(FIT, LANDSCAPE, { width: 1280, height: 800 }, { x: 1280, y: 800 })!;
  near(wide.left, 390, 'letterboxed: the frame\'s corner is the picture\'s');
  near(wide.top, 243.75, 'letterboxed: the frame\'s corner is the picture\'s');
  const spot = drawnPoint(view, PORTRAIT, frame, { x: 30, y: 350 })!; // drawn at -135: out of sight on the left
  const moved = follow(view, PORTRAIT, spot, 24);
  near(drawnPoint(moved, PORTRAIT, frame, { x: 30, y: 350 })!.left, 24, 'now 24 px inside');
  const corner = follow(view, PORTRAIT, drawnPoint(view, PORTRAIT, frame, { x: 5, y: 350 })!, 24);
  near(corner.x, 0, 'near the page\'s own edge the picture stops at its edge');
  assert.deepEqual(follow(view, PORTRAIT, centre, 24), view, 'in sight: nothing moves');
  assert.equal(follow(FIT, PORTRAIT, { left: -50, top: 0 }, 24), FIT, 'not zoomed: nothing to pan');
});
