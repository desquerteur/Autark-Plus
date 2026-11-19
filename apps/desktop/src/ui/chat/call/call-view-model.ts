// Owner 19.11.2026 ("beim Anrufen die Live-Kamera und Bildschirmteilen … Bildern, die ausgeschnitten werden und mitgegeben
// werden"): the pure part of what this device shows on a call – the cut-out a drag on the preview marks (0..1 of the picture),
// the picture's size on its way out (the long side at most FRAME_MAX), and whether a picture changed since the last one that
// went out (a 16×16 grey fingerprint, mean difference over CHANGED): an unchanged screen goes out once, not with every line.
// Owns: these numbers. Never: touches a stream, a canvas or the network (call-view.ts).

/** A cut-out of the picture, every value 0..1 of its width or height. */
export interface Cut { x: number; y: number; w: number; h: number }

/** The long side of a picture that goes out with a line, in pixels. */
export const FRAME_MAX = 1280;
/** Side of the grey fingerprint. */
export const PRINT = 16;
/** Mean difference (0..255) from which a picture counts as changed. */
export const CHANGED = 6;
/** A drag shorter than this (0..1 of either side) marks no cut-out. */
const MIN_CUT = 0.03;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The cut-out between two points of a drag (0..1), or undefined for a click or a sliver. */
export function cutBetween(a: { x: number; y: number }, b: { x: number; y: number }): Cut | undefined {
  const x = clamp(Math.min(a.x, b.x)), y = clamp(Math.min(a.y, b.y));
  const w = clamp(Math.max(a.x, b.x)) - x, h = clamp(Math.max(a.y, b.y)) - y;
  return w < MIN_CUT || h < MIN_CUT ? undefined : { x, y, w, h };
}

/** The source rectangle in pixels of a `width`×`height` picture (the whole one without a cut-out). */
export function sourceRect(width: number, height: number, cut?: Cut): { sx: number; sy: number; sw: number; sh: number } {
  if (!cut) return { sx: 0, sy: 0, sw: width, sh: height };
  const sx = Math.round(cut.x * width), sy = Math.round(cut.y * height);
  return { sx, sy, sw: Math.max(1, Math.round(cut.w * width)), sh: Math.max(1, Math.round(cut.h * height)) };
}

/** The size a `width`×`height` picture goes out with: never larger, the long side at most `max`. */
export function outSize(width: number, height: number, max = FRAME_MAX): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The grey fingerprint of RGBA pixels (PRINT×PRINT of them). */
export function fingerprint(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let index = 0; index + 3 < rgba.length; index += 4) out.push(Math.round(0.299 * rgba[index] + 0.587 * rgba[index + 1] + 0.114 * rgba[index + 2]));
  return out;
}

/** Whether a picture differs from the last one that went out (none went out yet: it does). */
export function changed(last: readonly number[] | undefined, next: readonly number[]): boolean {
  if (!last || last.length !== next.length || !next.length) return true;
  let sum = 0;
  for (let index = 0; index < next.length; index++) sum += Math.abs(next[index] - last[index]);
  return sum / next.length >= CHANGED;
}
