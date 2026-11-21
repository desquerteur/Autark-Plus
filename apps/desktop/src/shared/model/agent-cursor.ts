// The AI cursor (B-081): one look for every surface that draws an agent's pointer – the side tabs' in-page
// drawer (main/side-driver/cursor-script.ts) and the live picture of an agent's own browser
// (ui/workspace/PointerLayer.tsx). A rounded arrowhead with no stem in the agent's colour, a white outline and
// a soft glow, with the name pill beside it that never turns; people keep a thin plain arrow, so a person and
// an AI differ on every surface. While it travels it leans from its horizontal speed (like a light thing
// pulled along: moving right it tips clockwise around its tip), at most MAX_TILT_DEG, smoothed, and back to 0
// on arrival. The path itself is the motion model's (shared/model/pointer-motion.ts); only the lean is added.
// Owns: the shape, the colour per actor and the lean. Never: DOM, timers or I/O (the drawers animate).

import type { MotionStep } from './pointer-motion.ts';

/** The arrowhead in its own px (1 unit = 1 CSS px); (tipX, tipY) is the point it points at and turns around. */
export const AGENT_CURSOR = {
  viewBox: '0 0 22 22',
  d: 'M2.73 4.49 L4.27 17.51 Q4.5 19.5 5.6 17.83 L8.43 13.5 Q9.25 12.25 10.75 12.13 L16.51 11.66 Q18.5 11.5 16.76 10.52 L4.24 3.48 Q2.5 2.5 2.73 4.49 Z',
  tipX: 3,
  tipY: 3,
  width: 22,
  height: 22,
} as const;

/** The strongest lean in degrees. */
export const MAX_TILT_DEG = 18;
/** Degrees of lean per px/ms of horizontal speed (a 300 px glide peaks at about 2 px/ms: the full lean). */
const TILT_PER_SPEED = 12;
/** How much of the previous lean each step keeps (the rest follows the speed): no jitter on a bumpy path. */
const KEEP = 0.6;

/** One step of a drawn path with its lean `r` in degrees (positive: clockwise). */
export type TiltStep = MotionStep & { r: number };

const PALETTE = ['#2f6fed', '#d9480f', '#2b8a3e', '#ae3ec9', '#c2255c', '#0b7285', '#e67700', '#5f3dc4'];

/** The actor's cursor colour (hex): the same id always gets the same one of eight. */
export function cursorColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** The path with a lean per step: from the horizontal speed towards the next step, smoothed, at most ±MAX_TILT_DEG, the last step 0. x, y and t stay as they are. */
export function tilted(path: readonly MotionStep[]): TiltStep[] {
  let r = 0;
  return path.map((step, index) => {
    const next = path[index + 1];
    if (!next) return { x: step.x, y: step.y, t: step.t, r: 0 };
    const dt = next.t - step.t;
    const speed = dt > 0 ? (next.x - step.x) / dt : 0;
    const want = Number.isFinite(speed) ? Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, speed * TILT_PER_SPEED)) : 0;
    r = KEEP * r + (1 - KEEP) * want;
    return { x: step.x, y: step.y, t: step.t, r: Math.round(r * 10) / 10 || 0 };
  });
}
