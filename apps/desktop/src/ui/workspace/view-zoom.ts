// The zoom of a live picture on a touch screen (B-081 T9, the owner's 08.11.2026 wish: zoom in, pinch, and move around
// to every edge – the left one included): a pure view {s, x, y} over the picture's layout box. The picture is drawn
// with `transform: translate(x px, y px) scale(s)` around its own top-left corner (BrowserSurface.tsx), so its click
// mapping (framePoint over getBoundingClientRect) stays as it is. Each axis keeps the zoomed picture covering the box
// while it is larger (every edge reachable, nothing beyond it) and inside the box while it is smaller – one range for
// both, so a pinch never jumps; s 1 is the picture as laid out (no transform).
//   * pan moves it and gives back what went past an edge (all of it at s 1: the page scrolls by that, browser-touch.ts);
//   * pinch zooms by a ratio around a point, the picture point under it staying there; s stays within 1 … ZOOM_MAX –
//     a gesture pinches in many small steps, so only `settle`, when the last finger lifts, makes a pinch that ended just
//     above 1 the fitted picture again (a snap per step would undo every slow pinch);
//   * follow pans just enough to keep a point (the touchpad's cursor) inside the box with a margin.
// Owns: this math. Never: reads the DOM, keeps state or sends input.

import { drawnArea } from './browser-input.ts';

export const ZOOM_MAX = 4;
/** A pinch ending this close to 1 is the fitted picture again. */
const SNAP = 1.02;

export interface ZoomView { s: number; x: number; y: number }
export interface Size { width: number; height: number }
export interface Placed extends Size { left: number; top: number }
/** The surface's box and the picture's layout box in it (untransformed, px from the box's top-left). */
export interface ZoomRoom { box: Size; picture: Placed }

/** The picture as laid out. */
export const FIT: ZoomView = Object.freeze({ s: 1, x: 0, y: 0 });

const scaleOf = (s: number) => (Number.isFinite(s) && s > 1 ? Math.min(ZOOM_MAX, s) : 1);

/** A pinch's end (all fingers lifted): just above 1 is the fitted picture again. */
export const settle = (view: ZoomView): ZoomView => (view.s < SNAP ? FIT : view);

/** One axis: covering the box while larger than it, inside it while smaller. */
function axis(offset: number, box: number, start: number, size: number, s: number): number {
  const a = 0 - start; // never -0
  const b = box - start - size * s;
  return Math.min(Math.max(offset, Math.min(a, b)), Math.max(a, b));
}

/** The view with s within 1 … ZOOM_MAX and its offset where the picture still fills (or stays inside) the box. */
export function clampOffset(view: ZoomView, room: ZoomRoom): ZoomView {
  const s = scaleOf(view.s);
  if (s === 1) return FIT;
  const { box, picture } = room;
  return { s, x: axis(view.x, box.width, picture.left, picture.width, s), y: axis(view.y, box.height, picture.top, picture.height, s) };
}

/** Moves the picture by (dx, dy) screen px; `rest` is the part past its edges (at s 1 all of it). */
export function pan(view: ZoomView, dx: number, dy: number, room: ZoomRoom): { view: ZoomView; rest: { x: number; y: number } } {
  const next = clampOffset({ s: view.s, x: view.x + dx, y: view.y + dy }, room);
  return { view: next, rest: { x: view.x + dx - next.x, y: view.y + dy - next.y } };
}

/** Zooms by `ratio` around `at` (px from the box's top-left): the picture point under it stays under it. */
export function pinch(view: ZoomView, at: { x: number; y: number }, ratio: number, room: ZoomRoom): ZoomView {
  const s = scaleOf(view.s * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
  if (s === 1) return FIT;
  const k = s / view.s;
  const { left, top } = room.picture;
  return clampOffset({ s, x: at.x - left - (at.x - left - view.x) * k, y: at.y - top - (at.y - top - view.y) * k }, room);
}

/** The Zoom button: s around the box's centre (1: the fitted picture). */
export const zoomTo = (s: number, room: ZoomRoom): ZoomView => pinch(FIT, { x: room.box.width / 2, y: room.box.height / 2 }, s, room);

/** Where frame point `at` is drawn in the box (px from its top-left): letterboxed in the picture's layout box, then zoomed. */
export function drawnPoint(view: ZoomView, room: ZoomRoom, frame: Size, at: { x: number; y: number }): { left: number; top: number } | undefined {
  const area = drawnArea(room.picture, frame);
  if (!(frame.width > 0 && frame.height > 0 && area.width > 0 && area.height > 0)) return undefined;
  const { left, top } = room.picture;
  return {
    left: left + view.x + (area.left + (at.x / frame.width) * area.width - left) * view.s,
    top: top + view.y + (area.top + (at.y / frame.height) * area.height - top) * view.s,
  };
}

/** Pans just enough that a point drawn at `spot` lies `margin` px inside the box (zoomed only; the clamp holds). */
export function follow(view: ZoomView, room: ZoomRoom, spot: { left: number; top: number }, margin: number): ZoomView {
  if (view.s === 1) return view;
  const into = (at: number, size: number) => (at < margin ? margin - at : at > size - margin ? size - margin - at : 0);
  const dx = into(spot.left, room.box.width);
  const dy = into(spot.top, room.box.height);
  return dx || dy ? pan(view, dx, dy, room).view : view;
}
