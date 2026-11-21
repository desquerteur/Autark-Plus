// What My day still reads of the morning briefing (runtime/day/briefing.ts), pure: today's briefing (a stored one of
// another day – My day left open past midnight – is not used), whose chat order "Chats that matter" keeps
// (important-chats.ts), and the one fact of the night it says plainly: when the PC slept while night work waited.
// Its written sentences are no longer shown (17.11.2026): what is next comes live from the list (day-next.ts).
// Owns: these rules (unit-tested in test/unit/day-ui/day-briefing.test.ts). Never: imports the store, rpc or the
// DOM – callers pass data in.

import type { Briefing, SleepSpan } from '../../shared/model/calendar.ts';
import { clockOf } from './day-grid.ts';

/** Today's briefing, or null. */
export function briefingFor(briefing: Briefing | null, date: string): Briefing | null {
  return briefing && briefing.date === date ? briefing : null;
}

/** "PC slept 23:10–06:40 – night work paused" (one sleep), "PC slept 2× between 23:10 and 06:40 – …"; '' for none. */
export function sleptFact(slept: readonly SleepSpan[] | undefined, tz: string): string {
  if (!slept?.length) return '';
  const first = slept[0];
  const last = slept[slept.length - 1];
  const when = slept.length === 1
    ? `${clockOf(first.from, tz)}–${clockOf(first.to, tz)}`
    : `${slept.length}× between ${clockOf(first.from, tz)} and ${clockOf(last.to, tz)}`;
  return `PC slept ${when} – night work paused`;
}
