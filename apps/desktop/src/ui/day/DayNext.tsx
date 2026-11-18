// "Next" on top of My day (17.11.2026, in place of the morning's written briefing, which went stale by noon): one card
// with what comes next today – its time ("Now" once it has come), title, length, who asks and what follows ("then 3
// more at 18:00") – and "Start", which opens that to-do in the list; under it one muted line of what was done since
// last evening (the person's own to-dos and the work they handed off; "Show all" for more) and, from today's
// briefing, when the PC slept while night work waited. Everything is read live from the list, the calendar and
// tasks.list at My day's clocks (day-next.ts), so nothing here can say something that is no longer true; another
// day than today shows none of it.
// Owns: this card and line. Never: writes a to-do, calls a model or keeps a text of its own.

import { useState } from 'preact/hooks';
import { daySettingsOf, lastEvening } from '../../shared/model/day-settings.ts';
import type { TaskView } from '../../shared/model/tasks.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import { briefing, dayClock, dayRange, dayZone, handedOff, slotOf } from '../lib/day-store.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { agentName, settings, todoClock, todos } from '../lib/store.ts';
import { Button } from '../lib/ui.tsx';
import { useAsync } from '../settings/controls.tsx';
import { todoLabel } from '../tasks/todo-model.ts';
import { briefingFor, sleptFact } from './day-briefing.ts';
import { minutesText } from './day-format.ts';
import { clockOf } from './day-grid.ts';
import { dayGroups } from './day-groups.ts';
import { askedBy, doneSince, nextUp } from './day-next.ts';
import { DayChanges } from './DayChanges.tsx';
import { eventsOn, revealTodo, shownDate, today } from './day-state.ts';

/** Titles in the done line before "Show all", and how much of each. */
const DONE_SHOWN = 2;
const DONE_CHARS = 60;
/** The person's to-dos finished since last evening that one read asks for. */
const DONE_LIMIT = 50;

/** What comes next today – the card's and the side pane's list's one answer (reads the stores, so a render re-reads it). */
export function nextToday(date: string, now: number, tz: string) {
  const slots = slotOf.value;
  const range = dayRange(date, tz);
  const groups = dayGroups(todos.value, { now, dayStart: range.from, dayEnd: range.to, isToday: true, slots, date });
  const events = eventsOn(date, tz).map((entry) => entry.event);
  return nextUp([...groups.needsYou, ...groups.today, ...groups.unplanned], events, slots, now, range.to);
}

function NextCard(props: { date: string; now: number; tz: string }) {
  const { date, now, tz } = props;
  const next = nextToday(date, now, tz);
  if (!next) return null;
  const asker = next.task && askedBy(next.task);
  const label = next.now ? 'Now' : next.startAt === undefined ? 'Next' : `Next · ${clockOf(next.startAt, tz)}`;
  const meta = [
    next.minutes ? minutesText(next.minutes) : '',
    asker ? `${agentName(asker)} asks` : '',
    next.then ? `then ${next.then.count} more at ${clockOf(next.then.at, tz)}` : '',
  ].filter(Boolean).join(' · ');
  const task = next.task;
  return (
    <section class="day-next" aria-label="Next">
      <div class="day-next-text">
        <span class="day-next-label tabular">{label}</span>
        <span class="day-next-title">{task ? todoLabel(task) : next.title}</span>
        {meta && <span class="day-next-meta tabular">{meta}</span>}
      </div>
      {task && <Button variant="primary" class="day-next-start" onClick={() => revealTodo(task.id)}>Start</Button>}
    </section>
  );
}

function DoneLine(props: { date: string; now: number; tz: string }) {
  const { date, now, tz } = props;
  const since = lastEvening(now, tz, daySettingsOf(settings.value ?? undefined).workEnd);
  const listed = todos.value.map((task) => task.id).join(' '); // a to-do answered here or elsewhere leaves the list: read again
  const mayList = can('tasks.list');
  const finished = useAsync<TaskView[]>(
    () => (mayList ? rpc.call('tasks.list', { assigneeKind: 'human', status: ['done'], includeSteps: true, completedSince: since, limit: DONE_LIMIT }) : Promise.resolve([])),
    [since, mayList, listed],
  );
  const [all, setAll] = useState(false);
  const done = doneSince(finished.data ?? [], handedOff.value, since);
  const slept = sleptFact(briefingFor(briefing.value, date)?.slept, tz);
  if (!done.length && !slept) return null;
  const shown = all ? done : done.slice(0, DONE_SHOWN);
  return (
    <p class="day-next-done">
      {done.length > 0 && <span>Done since yesterday: {shown.map((task) => excerpt(todoLabel(task), DONE_CHARS)).join(' · ')}</span>}
      {done.length > DONE_SHOWN && (
        <button type="button" class="text-button day-next-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all (${done.length})`}</button>
      )}
      {slept && <span class="day-next-slept">{slept}</span>}
    </p>
  );
}

export function DayNext() {
  const date = today.value;
  const now = Math.max(todoClock.value, dayClock.value);
  const tz = dayZone.value;
  if (shownDate.value !== date) return null; // another day: this says what is now
  return (
    <div class="day-top">
      <NextCard date={date} now={now} tz={tz} />
      <DoneLine date={date} now={now} tz={tz} />
      <DayChanges now={now} />
    </div>
  );
}
