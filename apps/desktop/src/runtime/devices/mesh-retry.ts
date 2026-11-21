// The retry timers of the device mesh (devices/mesh.ts): the backoff after a close or a failed dial, and B-084's one
// retry after an early refusal. The link-up race: a PC linked moments ago (connect flow or roster, mesh.add) may dial
// the other PC before that PC has stored this one; its 4003 then means "not yet", not "unlinked". So a refusal within
// EARLY_REFUSAL_MS of the row's pairedAt gets exactly one more dial after RACE_RETRY_MS, and in its first FRESH_MS a new
// row is retried by both sides (the mesh's keeps()), not only by the smaller deviceId. B-087: the close a trigger leads
// to (TRIGGER_MS) gets one retry on the larger id too, at TRIGGER_STEP – after the smaller id's own first step, whose
// link cancels it (both PCs dialing at once swapped the link and ran the link-up twice).
// Owns: the timers per linked PC (armed only by events: a close, a failed dial, a refusal), the backoff steps and the
// windows above. Never: dials itself (the mesh's `run` does), polls, or keeps a timer after `cancel`/`clear` (after
// `clear` – the mesh closed – a refusal or failure of a dial still in flight arms none).

import type { Timers } from '../schedules/scheduler.ts';

export const realTimers: Timers = {
  set: (fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
/** A row this new is retried by both sides. */
export const FRESH_MS = 60_000;
/** A refusal this soon after the row was stored is the race, not an unlink. */
export const EARLY_REFUSAL_MS = 10_000;
/** The pause before the one dial after an early refusal (the other PC merges the roster within 500 ms). */
export const RACE_RETRY_MS = 2_000;
/**
 * A close this soon after a trigger (resume, unlock, online) found the link live is the one that trigger leads to: a link
 * that died while this PC slept closes on the keepalive's first on-time round, within about 75 s (http/keepalive.ts).
 */
export const TRIGGER_MS = 90_000;
/** The backoff step (5 s) of the larger id's one retry after that close: later than the smaller id's first step (1 s). */
export const TRIGGER_STEP = 2;

/** The row was stored (pairedAt) less than `windowMs` ago. */
export const pairedWithin = (pairedAt: number | undefined, now: number, windowMs: number): boolean =>
  typeof pairedAt === 'number' && now >= pairedAt && now - pairedAt < windowMs;

export class MeshRetries {
  private readonly backoff = new Map<string, { attempt: number; handle?: unknown }>();
  private readonly race = new Map<string, unknown>();
  /** Pairings (deviceId + pairedAt) that had their one race retry. */
  private readonly raced = new Set<string>();
  private readonly timers: Timers;
  private readonly run: (deviceId: string) => void;
  /** Set by clear(): a dial still in flight when the mesh closed arms nothing afterwards. */
  private stopped = false;

  constructor(timers: Timers, run: (deviceId: string) => void) {
    this.timers = timers;
    this.run = run;
  }

  /** The next backoff step, at least `fromStep`; at most one pending per PC. */
  schedule(deviceId: string, fromStep = 0): void {
    if (this.stopped) return;
    const state = this.backoff.get(deviceId) ?? { attempt: 0 };
    if (state.handle !== undefined) return;
    const delay = BACKOFF_MS[Math.min(Math.max(state.attempt, fromStep), BACKOFF_MS.length - 1)];
    state.handle = this.timers.set(() => {
      state.handle = undefined;
      state.attempt++;
      this.run(deviceId); // a failure schedules the next step
    }, delay);
    this.backoff.set(deviceId, state);
  }

  /** After a refusal: the one more dial when it came within EARLY_REFUSAL_MS of linking and this pairing had none yet. */
  refused(deviceId: string, pairedAt: number | undefined, now: number): void {
    this.cancel(deviceId);
    const key = `${deviceId}:${pairedAt}`;
    if (this.stopped || !pairedWithin(pairedAt, now, EARLY_REFUSAL_MS) || this.raced.has(key)) return;
    this.raced.add(key);
    this.race.set(deviceId, this.timers.set(() => { this.race.delete(deviceId); this.run(deviceId); }, RACE_RETRY_MS));
  }

  cancel(deviceId: string): void {
    const state = this.backoff.get(deviceId);
    if (state?.handle !== undefined) this.timers.clear(state.handle);
    this.backoff.delete(deviceId);
    if (this.race.has(deviceId)) this.timers.clear(this.race.get(deviceId));
    this.race.delete(deviceId);
  }

  /** The mesh closed: every timer goes and none is armed again. */
  clear(): void {
    this.stopped = true;
    for (const id of new Set([...this.backoff.keys(), ...this.race.keys()])) this.cancel(id);
  }
}
