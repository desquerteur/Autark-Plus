// My day's live top and the list's time hints, pure (17.11.2026, "My day" package 1): what comes next – read from the
// list and the calendar each time My day draws, so nothing on top can go stale the way the morning's written briefing
// did –, what was done since last evening, when a planned to-do's time has passed (its block began more than STALE_MS
// ago and has ended: the row asks when it suits the person, with the next free time of the calendar), and when a
// priority still means hurry ("Urgent" always; "High" only while its due time is less than URGENT_MS away or past).
// One time per to-do everywhere here: its planned block, else its ring time, else its due time (timeOf).
// Owns: these rules (unit-tested in test/unit/day-ui/day-next.test.ts). Never: imports the store, rpc or the DOM, or
// reads a clock – callers pass data, the time and the zone in.

import { HUMAN_ID, SYSTEM_ID } from '../../shared/ids.ts';
import type { CalendarEvent } from '../../shared/model/calendar.ts';
import { clockMinutes } from '../../shared/model/day-settings.ts';
import type { Task, TaskView } from '../../shared/model/tasks.ts';
import { timerAt } from '../../shared/model/todo-later.ts';
import { atWallTime, nextDate, wallClock } from '../chat/composer/schedule-clock.ts';
import { finishedAt } from '../tasks/work-model.ts';
import { dayTitle } from './day-format.ts';
import { clockOf } from './day-grid.ts';

/** A planned time this long past (and its block over) asks the person for a new one. */
export const STALE_MS = 30 * 60_000;
/** A High to-do is urgent while its due time is less than this away (or past). */
export const URGENT_MS = 60 * 60_000;
/** "Now" answers for the next half hour; the free time offered beside it starts after that. */
const LATER_TODAY_MS = 30 * 60_000;
const QUARTER_MS = 15 * 60_000;
const FIVE_MS = 5 * 60_000;

type Block = Pick<CalendarEvent, 'startAt' | 'endAt' | 'state'>;
type Timed = Pick<Task, 'widget' | 'dueAt'>;
export interface Span { startAt: number; endAt: number }

/** A planned block of the to-do (a done or cut block no longer places it). */
function plannedBlock<B extends Block>(slot: B | undefined): B | undefined {
  return slot && slot.state === 'planned' ? slot : undefined;
}

/** When a to-do happens: its planned block, else its ring time (a timer), else its due time; undefined: it has none. */
export function timeOf(task: Timed, slot?: Block): Span | undefined {
  const block = plannedBlock(slot);
  if (block) return { startAt: block.startAt, endAt: block.endAt };
  const at = timerAt(task) ?? task.dueAt;
  return at === undefined ? undefined : { startAt: at, endAt: at };
}

/** The time has passed: it began more than STALE_MS ago and is over. */
export function isPast(span: Span, now: number): boolean {
  return now >= span.endAt && now - span.startAt > STALE_MS;
}

/** The to-do's planned block when its time has passed (the row then asks for a new one), else undefined. A ring keeps its
 *  own snooze and a bare due time its "Overdue": only a plan the person can move again asks. */
export function staleBlock<B extends Block>(slot: B | undefined, now: number): B | undefined {
  const block = plannedBlock(slot);
  return block && isPast(block, now) ? block : undefined;
}

/**
 * Which row asks in its box when several are past their time: the first in the list's order (17.11.2026, Mika: three
 * boxes under each other push the rest of the day off the phone's first screen). The others are a slim line until
 * tapped. A row that is leaving does not count; once it is gone the next one asks.
 */
export function firstStale<T extends { id: string }, B extends Block>(
  rows: readonly T[], slots: ReadonlyMap<string, B>, now: number,
): string | undefined {
  return rows.find((row) => staleBlock(slots.get(row.id), now))?.id;
}

/** The word a row shows before its time: "Urgent" always, "High" while its due time is less than URGENT_MS away or past
 *  (agents mark most of what they ask High – the word means hurry only near the deadline), else ''. */
export function priorityWord(task: Pick<Task, 'priority' | 'dueAt'>, now: number): '' | 'High' | 'Urgent' {
  if (task.priority >= 2) return 'Urgent';
  if (task.priority === 1 && task.dueAt !== undefined && task.dueAt - now < URGENT_MS) return 'High';
  return '';
}

/** "08:00" today, "Tomorrow 08:00", "Yesterday 08:00", "Fri 20 Nov 08:00" – a row's time with its day when that is not `today`. */
export function dayTimeText(at: number, tz: string, today: string): string {
  const date = wallClock(at, tz).date;
  return date === today ? clockOf(at, tz) : `${dayTitle(date, today)} ${clockOf(at, tz)}`;
}

/** Who asks the person for this to-do (an agent's or a colleague's id); undefined for their own and the app's. */
export function askedBy(task: Pick<Task, 'createdBy'>): string | undefined {
  return task.createdBy && task.createdBy !== HUMAN_ID && task.createdBy !== SYSTEM_ID ? task.createdBy : undefined;
}

// ------------------------------------------------------------------ what comes next

type Item = Timed & Pick<TaskView, 'id' | 'title' | 'estimateMin'>;
type Event = Pick<CalendarEvent, 'id' | 'kind' | 'title' | 'startAt' | 'endAt' | 'allDay'>;

export interface NextUp<T> {
  /** The to-do; undefined for a calendar event (title, time and length only). */
  task?: T;
  title: string;
  /** Its time; undefined for a to-do without one (then the top of the list). */
  startAt?: number;
  minutes?: number;
  /** Its time has come (a block running, a due time just passed). */
  now: boolean;
  /** What follows at the next later time: "then 3 more at 18:00". */
  then?: { at: number; count: number };
}

const minutesOf = (span: Span) => Math.round((span.endAt - span.startAt) / 60_000);

/**
 * What comes next today: the soonest of the listed to-dos (in the list's order: Needs you, Today, Unplanned) and the
 * calendar's events whose time has not passed (a to-do: isPast; an event: not ended), by start; a to-do before an
 * event at the same minute. Without any, the first listed to-do without a time. Nothing: undefined (an empty day).
 */
export function nextUp<T extends Item>(
  listed: readonly T[], events: readonly Event[], slots: ReadonlyMap<string, CalendarEvent>, now: number, dayEnd: number,
): NextUp<T> | undefined {
  const timed: Array<{ span: Span; next: NextUp<T>; rank: number }> = [];
  listed.forEach((task, index) => {
    const slot = slots.get(task.id);
    const span = timeOf(task, slot);
    if (!span || isPast(span, now) || span.startAt >= dayEnd) return;
    const minutes = plannedBlock(slot) ? minutesOf(span) : task.estimateMin;
    timed.push({ span, rank: index, next: { task, title: task.title, startAt: span.startAt, ...(minutes ? { minutes } : {}), now: span.startAt <= now } });
  });
  for (const event of events) {
    if (event.kind !== 'event' || event.allDay || event.endAt <= now || event.startAt >= dayEnd) continue;
    timed.push({ span: event, rank: listed.length, next: { title: event.title ?? '', startAt: event.startAt, minutes: minutesOf(event), now: event.startAt <= now } });
  }
  timed.sort((a, b) => a.span.startAt - b.span.startAt || a.rank - b.rank);
  const first = timed[0];
  if (!first) {
    const task = listed.find((item) => !timeOf(item, slots.get(item.id)));
    return task && { task, title: task.title, ...(task.estimateMin ? { minutes: task.estimateMin } : {}), now: false };
  }
  const later = timed.find((entry) => entry.span.startAt - first.span.startAt >= 60_000);
  if (!later) return first.next;
  const count = timed.filter((entry) => Math.abs(entry.span.startAt - later.span.startAt) < 60_000).length;
  return { ...first.next, then: { at: later.span.startAt, count } };
}

// ------------------------------------------------------------------ answers to a passed time

/** The first time today, from the next quarter hour half an hour after `now`, where `minutes` fit between the busy
 *  times before `until` (the end of the working day); undefined when none is left. */
export function freeSlot(busy: readonly Span[], minutes: number, now: number, until: number): number | undefined {
  const length = Math.max(1, minutes) * 60_000;
  let at = Math.ceil((now + LATER_TODAY_MS) / QUARTER_MS) * QUARTER_MS;
  for (const span of [...busy].sort((a, b) => a.startAt - b.startAt)) {
    if (span.endAt <= at) continue;
    if (span.startAt >= at + length) break;
    at = Math.ceil(span.endAt / FIVE_MS) * FIVE_MS;
  }
  return at + length <= until ? at : undefined;
}

/** `clock` ('HH:MM', the working day's start) on the day after `date` in `tz`. */
export function tomorrowAt(date: string, clock: string, tz: string): number {
  const minutes = clockMinutes(clock) ?? 8 * 60;
  return atWallTime(nextDate(date), Math.floor(minutes / 60), minutes % 60, tz);
}

// ------------------------------------------------------------------ done since last evening

type Finished = Pick<TaskView, 'id' | 'status' | 'completedAt' | 'updatedAt'> & { assigneeId?: string; assigneeKind: TaskView['assigneeKind'] };

/**
 * "Done since yesterday": what the person finished of their own list (their to-dos – never a colleague's) and the work
 * they handed off that is done, each once, finished at or after `since` (last evening), newest first.
 */
export function doneSince<T extends Finished>(todos: readonly T[], handed: readonly T[], since: number): T[] {
  const seen = new Set<string>();
  const mine = todos.filter((task) => task.assigneeKind === 'human' && (task.assigneeId === undefined || task.assigneeId === HUMAN_ID));
  return [...mine, ...handed]
    .filter((task) => task.status === 'done' && finishedAt(task) >= since && !seen.has(task.id) && Boolean(seen.add(task.id)))
    .sort((a, b) => finishedAt(b) - finishedAt(a));
}
