// Touch on the taken-over browser picture (X02, BrowserSurface.tsx) and the hidden key field for
// the phone's on-screen keyboard (BrowserKeys.tsx), as pure helpers over BrowserInput:
//   * a tap (≤ TAP_MS, ≤ TAP_SLOP_PX of movement – jitter stays a tap) is a left click at the
//     frame point where it started; a second tap within DOUBLE_TAP_MS and DOUBLE_TAP_PX is a
//     double click (clicks 2);
//   * one finger dragging moves the zoomed picture (view-zoom.ts through `pan`); what goes past its
//     edges – all of it at 1x – scrolls the page: wheel turns at the start point, in frame pixels
//     (screen delta × frame width / drawn width, opposite sign – the page follows the finger);
//   * B-081 T9: two fingers pinch (their distance zooms the picture around their midpoint, the
//     midpoint's move pans it); a gesture that had two fingers never clicks, until all are lifted.
//     The touchpad mode (browser-pad.ts) reads the two fingers the same way (`pairOf`).
// The key proxy reads a field that always holds one zero-width SENTINEL: typed or inserted text
// becomes {kind: 'text'}, deleting the sentinel is Backspace, Enter is Enter (down and up), and
// Tab and arrow keys from a hardware keyboard pass as keys; the field goes back to the sentinel
// after every event, so nothing typed stays in it.
// Owns: these rules. Never: renders, logs or keeps input.

import type { BrowserInput } from '../../shared/model/browser.ts';
import { keyInput, pasteText, type FramePoint } from './browser-input.ts';

export const TAP_MS = 250;
export const TAP_SLOP_PX = 8;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 24;
/** What the hidden key field holds between events (zero width, never sent). */
export const KEY_SENTINEL = '​';
const MAX_DELTA = 10_000;

/** Two fingers (B-081 T9): the picture zooms and moves with them (view-zoom.ts pinch after pan). */
export interface PinchMap {
  /** The picture zooms by `ratio` around client point (x, y) after moving by (dx, dy) screen px. */
  pinch(x: number, y: number, ratio: number, dx: number, dy: number): void;
}

export interface TouchMap extends PinchMap {
  /** A client point on the picture in frame units (undefined outside it). */
  point(clientX: number, clientY: number): FramePoint | undefined;
  /** Frame pixels per screen pixel (frame width / drawn width). */
  scale(): number;
  /** B-081 T9: moves the zoomed picture by (dx, dy) screen px; gives back what went past its edges (all of it at 1x). */
  pan(dx: number, dy: number): { x: number; y: number };
}

interface TouchPoint { clientX: number; clientY: number }
/** The parts of a TouchEvent the gestures read. */
export interface TouchLike { touches: ArrayLike<TouchPoint>; timeStamp: number }

export interface TouchGestures {
  start(event: TouchLike): void;
  move(event: TouchLike): void;
  /** true: handled here (a tap, a scroll, a pinch) – the caller cancels the synthetic mouse events. */
  end(event: TouchLike): boolean;
  cancel(): void;
}

/** The first two fingers: their midpoint (client px) and distance. */
export interface Pair { x: number; y: number; d: number }
export function pairOf(event: TouchLike): Pair | undefined {
  const a = event.touches[0];
  const b = event.touches[1];
  return a && b ? { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) } : undefined;
}

/** A pair moved from `from` to `to`: the map zooms by the distance's ratio around the new midpoint after its move. */
export function pinchBy(map: PinchMap, from: Pair, to: Pair): void {
  map.pinch(to.x, to.y, from.d >= 1 && to.d >= 1 ? to.d / from.d : 1, to.x - from.x, to.y - from.y);
}

interface Gesture { x: number; y: number; at: number; lastX: number; lastY: number; dragging: boolean; multi: boolean; pair?: Pair }

const clamp = (value: number) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(value))) || 0; // never -0

export function touchGestures(map: TouchMap, push: (input: BrowserInput) => void): TouchGestures {
  let gesture: Gesture | undefined;
  let lastTap: { x: number; y: number; at: number } | undefined;
  return {
    start(event) {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) {
        gesture ??= { x: 0, y: 0, at: event.timeStamp, lastX: 0, lastY: 0, dragging: false, multi: true };
        gesture.multi = true;
        gesture.pair = pairOf(event); // a finger more or less: the pinch goes on from here
        return;
      }
      gesture = { x: touch.clientX, y: touch.clientY, at: event.timeStamp, lastX: touch.clientX, lastY: touch.clientY, dragging: false, multi: false };
    },
    move(event) {
      if (!gesture) return;
      if (gesture.multi || event.touches.length !== 1) {
        gesture.multi = true;
        const pair = pairOf(event);
        if (pair && gesture.pair) pinchBy(map, gesture.pair, pair);
        gesture.pair = pair;
        return;
      }
      const touch = event.touches[0]!;
      if (!gesture.dragging && Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) <= TAP_SLOP_PX) return;
      gesture.dragging = true;
      const dx = touch.clientX - gesture.lastX;
      const dy = touch.clientY - gesture.lastY;
      gesture.lastX = touch.clientX;
      gesture.lastY = touch.clientY;
      if (!dx && !dy) return;
      const rest = map.pan(dx, dy); // the zoomed picture moves first; the page scrolls by what is left
      const at = map.point(gesture.x, gesture.y);
      if (!at || (!rest.x && !rest.y)) return;
      const scale = map.scale();
      push({ kind: 'wheel', ...at, deltaX: clamp(-rest.x * scale), deltaY: clamp(-rest.y * scale) });
    },
    end(event) {
      const done = gesture;
      if (event.touches.length === 0) gesture = undefined;
      else if (done) done.pair = pairOf(event);
      if (!done) return false;
      if (done.multi || done.dragging) return true;
      if (event.timeStamp - done.at > TAP_MS) return true; // a long press does nothing
      const at = map.point(done.x, done.y);
      if (!at) return true;
      const double = lastTap !== undefined && done.at - lastTap.at <= DOUBLE_TAP_MS && Math.hypot(done.x - lastTap.x, done.y - lastTap.y) <= DOUBLE_TAP_PX;
      const clicks = double ? 2 : 1;
      lastTap = double ? undefined : { x: done.x, y: done.y, at: event.timeStamp };
      push({ kind: 'mouse', type: 'down', ...at, button: 'left', buttons: 1, clicks });
      push({ kind: 'mouse', type: 'up', ...at, button: 'left', buttons: 0, clicks });
      return true;
    },
    cancel() { gesture = undefined; },
  };
}

// ------------------------------------------------------------------ the hidden key field

type KeyEventLike = Parameters<typeof keyInput>[0];

export interface KeyProxy {
  /** The field's value after an input event → what to put back in the field (the sentinel). */
  input(value: string): string;
  /** A key event: true when it was sent here (the caller prevents its default). */
  key(event: KeyEventLike, type: 'down' | 'up'): boolean;
}

/** Keys of a hardware keyboard the field passes on (letters arrive as text through input()). */
const PASSED_KEYS = /^(Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Delete)$/;

export function keyProxy(push: (input: BrowserInput) => void): KeyProxy {
  const press = (key: string, keyCode: number) => {
    push({ kind: 'key', type: 'down', key, code: key, keyCode });
    push({ kind: 'key', type: 'up', key, code: key, keyCode });
  };
  return {
    input(value) {
      const text = pasteText(value.split(KEY_SENTINEL).join(''));
      if (text) push({ kind: 'text', text });
      else if (!value.includes(KEY_SENTINEL)) press('Backspace', 8);
      return KEY_SENTINEL;
    },
    key(event, type) {
      if (event.key === 'Enter') {
        if (type === 'down' && !event.isComposing) press('Enter', 13);
        return true;
      }
      if (!PASSED_KEYS.test(event.key)) return false;
      const input = keyInput(event, type);
      if (input) push(input);
      return Boolean(input);
    },
  };
}
