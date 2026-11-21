// A to-do whose planned time has passed says so in its row (day-next.ts staleBlock: its block began more than 30
// minutes ago and is over): "Was planned for 08:00. When does it suit you?" with answers the person taps – Now · the
// next free time today (day-next.ts freeSlot, from the calendar) · Tomorrow at the start of work · Not needed. Each
// answer is the person's own change through the calls My day already has: the block moves (day-actions.ts moveTodo,
// a due time before it along), "Not needed" declines an asked to-do with that reason (its asker hears it) or removes
// the person's own (HumanItem.tsx). Nothing is changed for the person and nothing is recorded besides.
// Owns: this hint and its time choices. Never: changes a to-do by itself, or shows for a time that has not passed.

import { useState } from 'preact/hooks';
import type { CalendarEvent } from '../../shared/model/calendar.ts';
import { clockMinutes, daySettingsOf } from '../../shared/model/day-settings.ts';
import type { TaskView } from '../../shared/model/tasks.ts';
import { dayZone } from '../lib/day-store.ts';
import { can } from '../lib/session.ts';
import { settings } from '../lib/store.ts';
import { Button } from '../lib/ui.tsx';
import { moveTodo } from './day-actions.ts';
import { blockMinutes } from './day-format.ts';
import { atMinute, clockOf } from './day-grid.ts';
import { dayTimeText, freeSlot, tomorrowAt } from './day-next.ts';
import { eventsOn, today } from './day-state.ts';

const MINUTE_MS = 60_000;

export function DayStale(props: { task: TaskView; block: CalendarEvent; now: number; onNotNeeded: () => void; collapsed?: boolean }) {
  const { task, block, now } = props;
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false); // a collapsed line the person tapped
  const tz = dayZone.value;
  const date = today.value;
  const day = daySettingsOf(settings.value ?? undefined);
  const mayMove = can('calendar.move');
  const busyTimes = eventsOn(date, tz).map((entry) => entry.event).filter((event) => event.id !== block.id && event.state === 'planned');
  const workEnd = atMinute(date, clockMinutes(day.workEnd) ?? 20 * 60, tz);
  const free = mayMove ? freeSlot(busyTimes, blockMinutes(block), now, workEnd) : undefined;
  const morning = tomorrowAt(date, day.workStart, tz);
  const move = async (startAt: number) => {
    setBusy(true);
    try { await moveTodo(task, block, startAt); } finally { setBusy(false); }
  };
  if (props.collapsed && !opened) {
    // Not the first one past its time: a slim line instead of the box (the first one asks, day-next.ts firstStale).
    return (
      <button type="button" class="day-stale-chip" aria-expanded="false" onClick={() => setOpened(true)}>
        Missed · Reschedule
      </button>
    );
  }
  return (
    <div class="day-stale" role="group" aria-label="Planned time passed">
      <span class="day-stale-text">Was planned for {dayTimeText(block.startAt, tz, date)}. When does it suit you?</span>
      <span class="day-stale-answers">
        {mayMove && <Button class="day-stale-answer" disabled={busy} onClick={() => void move(Math.floor(now / MINUTE_MS) * MINUTE_MS)}>Now</Button>}
        {free !== undefined && <Button class="day-stale-answer tabular" disabled={busy} onClick={() => void move(free)}>Today {clockOf(free, tz)}</Button>}
        {mayMove && <Button class="day-stale-answer tabular" disabled={busy} onClick={() => void move(morning)}>Tomorrow {clockOf(morning, tz)}</Button>}
        <Button class="day-stale-answer" disabled={busy} onClick={props.onNotNeeded}>Not needed</Button>
      </span>
    </div>
  );
}
