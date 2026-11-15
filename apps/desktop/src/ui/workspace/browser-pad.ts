// The touch screen as a touchpad over the mirrored page (B-081 T9, the owner's 08.11.2026 wish "wie AnyDesk"): a cursor
// sits on the picture and stays where it is; the finger is not on it, it pushes it. Pure rules over BrowserInput:
//   * one finger moves the cursor by its own movement (screen px × frame px per screen px – the same distance on the
//     screen at every zoom) with a mild speed curve: ×1 up to SLOW_PX per event, rising to ×FAST_GAIN from FAST_PX; the
//     cursor stays on the frame and every move goes to the page as a mouse move (the sender merges them);
//   * a tap (≤ TAP_MS, ≤ TAP_SLOP_PX) clicks at the cursor, a second one within DOUBLE_TAP_MS double-clicks; a finger put
//     down within DOUBLE_TAP_MS of a tap that then moves drags (down at the cursor, moves held, up when lifted);
//   * two fingers: their midpoint's move scrolls the page at the cursor (the page follows the fingers), a distance
//     change of more than PINCH_PX zooms the picture (browser-touch.ts pinchBy, view-zoom.ts) – the first that passes
//     its threshold decides the gesture; two fingers lifted without either is a right click at the cursor.
// The cursor is kept as a share of the frame, so a new frame size keeps its place. Owns: these rules and the cursor's
// place. Never: renders, keeps what is typed, or sends anything but mouse and wheel input.

import type { BrowserInput } from '../../shared/model/browser.ts';
import type { FramePoint } from './browser-input.ts';
import { DOUBLE_TAP_MS, TAP_MS, TAP_SLOP_PX, pairOf, pinchBy, type Pair, type PinchMap, type TouchGestures } from './browser-touch.ts';

export const SLOW_PX = 4;
export const FAST_PX = 24;
export const FAST_GAIN = 2.5;
/** Two fingers whose distance changes this much pinch; a midpoint that moves TAP_SLOP_PX first scrolls. */
export const PINCH_PX = 16;
const MAX_DELTA = 10_000;

export interface PadMap extends PinchMap {
  /** The page viewport the frame shows (frame units; 0 while there is none). */
  frame(): { width: number; height: number };
  /** Frame pixels per screen pixel (frame width / drawn width, the zoom included). */
  scale(): number;
}

export interface PadGestures extends TouchGestures {
  /** The cursor on the frame now (undefined while there is no frame). */
  at(): FramePoint | undefined;
}

/** The speed curve: how much faster than the finger the cursor goes at `px` per event. */
export function gain(px: number): number {
  return 1 + (FAST_GAIN - 1) * Math.min(1, Math.max(0, (px - SLOW_PX) / (FAST_PX - SLOW_PX)));
}

interface One { x: number; y: number; at: number; lastX: number; lastY: number; moved: boolean; armed: boolean; held: boolean }
interface Two { at: number; from: Pair; last: Pair; kind?: 'scroll' | 'pinch' }

const round = (value: number) => Math.round(value * 100) / 100;
const delta = (value: number) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(value))) || 0; // never -0
const share = (value: number) => Math.min(1, Math.max(0, value));

export function padGestures(map: PadMap, push: (input: BrowserInput) => void, onCursor: (at: FramePoint) => void): PadGestures {
  let fx = 0.5;
  let fy = 0.5;
  let one: One | undefined;
  let two: Two | undefined;
  let lastTap = Number.NEGATIVE_INFINITY;
  const at = (): FramePoint | undefined => {
    const { width, height } = map.frame();
    return width > 0 && height > 0 ? { x: round(fx * width), y: round(fy * height), width, height } : undefined;
  };
  const press = (type: 'down' | 'up', button: 'left' | 'right', clicks: number, buttons: number) => {
    const spot = at();
    if (spot) push({ kind: 'mouse', type, ...spot, button, buttons, clicks });
  };
  const click = (button: 'left' | 'right', clicks: number) => { press('down', button, clicks, button === 'left' ? 1 : 2); press('up', button, clicks, 0); };
  const moveBy = (dx: number, dy: number) => {
    const { width, height } = map.frame();
    if (!(width > 0 && height > 0)) return;
    const k = gain(Math.hypot(dx, dy)) * map.scale();
    fx = share(fx + (dx * k) / width);
    fy = share(fy + (dy * k) / height);
    const spot = at()!;
    push({ kind: 'mouse', type: 'move', ...spot, buttons: one?.held ? 1 : 0 });
    onCursor(spot);
  };
  return {
    at,
    start(event) {
      const touch = event.touches[0];
      if (event.touches.length === 1 && touch && !two) {
        one = { x: touch.clientX, y: touch.clientY, at: event.timeStamp, lastX: touch.clientX, lastY: touch.clientY, moved: false, armed: event.timeStamp - lastTap <= DOUBLE_TAP_MS, held: false };
        return;
      }
      const pair = pairOf(event);
      if (one?.held) press('up', 'left', 1, 0); // a drag that gets a second finger ends there
      if (pair) two = two ? { ...two, last: pair } : { at: one && !one.moved ? one.at : event.timeStamp, from: pair, last: pair };
      one = undefined;
    },
    move(event) {
      const pair = pairOf(event);
      if (two) {
        if (!pair) return; // one finger left of two: nothing until all are lifted
        two.kind ??= Math.abs(pair.d - two.from.d) > PINCH_PX ? 'pinch' : Math.hypot(pair.x - two.from.x, pair.y - two.from.y) > TAP_SLOP_PX ? 'scroll' : undefined;
        if (two.kind === 'pinch') pinchBy(map, two.last, pair);
        else if (two.kind === 'scroll') {
          const spot = at();
          const scale = map.scale();
          if (spot) push({ kind: 'wheel', ...spot, deltaX: delta(-(pair.x - two.last.x) * scale), deltaY: delta(-(pair.y - two.last.y) * scale) });
        }
        if (two.kind) two.last = pair;
        return;
      }
      const touch = event.touches[0];
      if (!one || !touch) return;
      if (!one.moved && Math.hypot(touch.clientX - one.x, touch.clientY - one.y) <= TAP_SLOP_PX) return;
      if (!one.moved && one.armed) { one.held = true; press('down', 'left', 1, 1); } // tap, then drag: the button is held
      one.moved = true;
      const dx = touch.clientX - one.lastX;
      const dy = touch.clientY - one.lastY;
      one.lastX = touch.clientX;
      one.lastY = touch.clientY;
      if (dx || dy) moveBy(dx, dy);
    },
    end(event) {
      if (two) {
        if (event.touches.length > 1) { two.last = pairOf(event) ?? two.last; return true; }
        if (event.touches.length === 1) return true;
        const done = two;
        two = undefined;
        if (!done.kind && event.timeStamp - done.at <= TAP_MS) click('right', 1);
        return true;
      }
      const done = one;
      one = undefined;
      if (!done) return false;
      if (done.held) { press('up', 'left', 1, 0); return true; }
      if (done.moved || event.timeStamp - done.at > TAP_MS) return true; // a move or a long press: no click
      const double = done.armed;
      lastTap = double ? Number.NEGATIVE_INFINITY : event.timeStamp;
      click('left', double ? 2 : 1);
      return true;
    },
    cancel() {
      if (one?.held) press('up', 'left', 1, 0);
      one = undefined;
      two = undefined;
    },
  };
}
