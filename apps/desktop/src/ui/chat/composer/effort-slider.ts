// AF-021: the effort slider's rules (EffortSlider.tsx draws it). Its stops are "Auto" (no effort chosen: the chat's
// efforts[agentId] is absent, as when the old buttons were all off) and the efforts the model offers ('none' is no stop);
// without a chosen model the plain levels Low … Max with Very high, as upstream's effort cells show. The stored value is the same as before:
// settings.efforts[agentId] = the effort, or no key for Auto.
// Owns: the stops, the position of a stored value, pointer → stop, keys → stop and the patch. Never: draws or saves.

import type { Effort } from '../../../shared/model/providers.ts';

export const AUTO_STEP = 'auto';
export type EffortStep = Effort | typeof AUTO_STEP;

/** The plain levels when the model's own are unknown (the old buttons). */
export const PLAIN_EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']; // upstream 0.3.16: Very high among them
const ORDER: readonly Effort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Auto, then the model's efforts in order (no 'none'); the plain levels when it names none. */
export function effortSteps(modelEfforts: readonly Effort[] | undefined): EffortStep[] {
  const own = (modelEfforts ?? []).filter((effort) => effort !== 'none' && ORDER.includes(effort));
  const list = own.length ? [...new Set(own)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)) : [...PLAIN_EFFORTS];
  return [AUTO_STEP, ...list];
}

/** The stop of a stored effort: Auto when none, else its own stop, else the nearest the model offers. */
export function stepIndex(steps: readonly EffortStep[], value: string | undefined): number {
  if (!value || value === AUTO_STEP) return 0;
  const exact = steps.indexOf(value as EffortStep);
  if (exact >= 0) return exact;
  const rank = ORDER.indexOf(value as Effort);
  if (rank < 0) return 0;
  let best = 1;
  for (let i = 1; i < steps.length; i++) {
    if (Math.abs(ORDER.indexOf(steps[i] as Effort) - rank) < Math.abs(ORDER.indexOf(steps[best] as Effort) - rank)) best = i;
  }
  return steps.length > 1 ? best : 0;
}

/** The stop under a pointer at `x` on a track of `count` equal cells from `left`, `width` wide. */
export function indexAt(x: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor(((x - left) / width) * count)));
}

/** The stop a key moves to (arrows, Home/End, PageUp/PageDown – as a native range); undefined = not a slider key. */
export function keyStep(key: string, index: number, count: number): number | undefined {
  const last = Math.max(0, count - 1);
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': case 'PageDown': return Math.max(0, index - 1);
    case 'ArrowRight': case 'ArrowUp': case 'PageUp': return Math.min(last, index + 1);
    case 'Home': return 0;
    case 'End': return last;
    default: return undefined;
  }
}

/** The chat's efforts map with `step` for the agent (Auto removes its key). */
export function effortsWith(efforts: Readonly<Record<string, string>> | undefined, agentId: string, step: EffortStep): Record<string, string> {
  const next = { ...(efforts ?? {}) };
  if (step === AUTO_STEP) delete next[agentId];
  else next[agentId] = step;
  return next;
}

/** Where a stop's dot sits on the track, in percent (the centre of its cell, so labels line up below). */
export function stopPercent(index: number, count: number): number {
  return count <= 0 ? 0 : ((index + 0.5) / count) * 100;
}
