// My day's live top and the list's time hints (src/ui/day/day-next.ts): what comes next – in time order, in the day's
// zone, never something whose time has passed, nothing on an empty day –, when a planned time has passed (the 30-minute
// line, a to-do without a time, a fixed time), when "High" still shows, the next free time and "done since yesterday".
// Owns: these assertions only. Never: the DOM, rpc or real timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../../../src/shared/model/calendar.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';
import { HUMAN_ID, SYSTEM_ID } from '../../../src/shared/ids.ts';
import { STALE_MS, askedBy, firstStale, dayTimeText, doneSince, freeSlot, isPast, nextUp, priorityWord, staleBlock, timeOf, tomorrowAt } from '../../../src/ui/day/day-next.ts';

const M = 60_000;
const H = 60 * M;
const DAY_START = Date.UTC(2026, 10, 17, 0, 0, 0);
const DAY_END = DAY_START + 24 * H;
const NOW = DAY_START + 14 * H + 5 * M; // 14:05 (UTC)
const MIRA = 'ag_mira';
let seq = 0;

function todo(patch: Partial<TaskView> = {}): TaskView {
  seq++;
  return {
    id: patch.id ?? `todo_${seq}`, conversationId: 'ch_todo', title: `To-do ${seq}`, notes: '', status: 'open', assigneeKind: 'human',
    createdBy: MIRA, priority: 0, ledger: {}, sort: seq, rev: 1, createdAt: NOW - 1000 * seq, updatedAt: NOW,
    steps: [], progress: { done: 0, total: 0 }, conversationTitle: 'Mira', running: false,
    ...patch,
  };
}

function block(taskId: string, startAt: number, minutes = 30, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `cal_${taskId}`, ownerId: HUMAN_ID, kind: 'todo', taskId, startAt, endAt: startAt + minutes * M, sourceId: 'local',
    setBy: 'agent', state: 'planned', createdBy: MIRA, rev: 1, createdAt: NOW, updatedAt: NOW, ...patch,
  };
}

function event(title: string, startAt: number, minutes = 60, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return { ...block('', startAt, minutes), id: `ev_${title}`, kind: 'event', taskId: undefined, title, setBy: 'person', createdBy: HUMAN_ID, ...patch };
}

const slots = (...list: CalendarEvent[]) => new Map(list.map((entry) => [entry.taskId!, entry]));
const at = (hour: number, minute = 0) => DAY_START + hour * H + minute * M;

test('next: the soonest of the list and the calendar by start, a to-do before an event at the same minute, and what follows', () => {
  const social = todo({ title: 'Social start: eight short questions', estimateMin: 10 });
  const film = todo({ title: 'Film the screen' });
  const record = todo({ title: 'Record one sentence' });
  const voice = todo({ title: 'Voice note' });
  const map = slots(block(social.id, at(16), 10), block(film.id, at(18), 5), block(record.id, at(18), 5), block(voice.id, at(20), 5));
  const next = nextUp([film, record, voice, social], [event('Call with the bank', at(18))], map, NOW, DAY_END);
  assert.equal(next?.task, social, 'the soonest, whatever its place in the list');
  assert.equal(next?.startAt, at(16));
  assert.equal(next?.minutes, 10, 'the block\'s length');
  assert.equal(next?.now, false);
  assert.deepEqual(next?.then, { at: at(18), count: 3 }, 'the two to-dos and the event at 18:00');
  const tie = nextUp([film], [event('Standup', at(18))], slots(block(film.id, at(18), 5)), NOW, DAY_END);
  assert.equal(tie?.task, film, 'a to-do before an event at the same minute');
  const meeting = nextUp([film], [event('Standup', at(15), 30)], slots(block(film.id, at(18), 5)), NOW, DAY_END);
  assert.equal(meeting?.task, undefined, 'an event can come first');
  assert.equal(meeting?.title, 'Standup');
  assert.equal(meeting?.minutes, 30);
});

test('next: nothing whose time has passed – a block over for more than 30 minutes, an event that ended, a due time long gone; a running block is "now"', () => {
  const missed = todo({ title: 'Phone test' });
  const running = todo({ title: 'Write the offer' });
  const overdue = todo({ title: 'Send the mail', dueAt: at(12) });
  const later = todo({ title: 'Tomorrow\'s call' });
  const map = slots(block(missed.id, at(8), 15), block(running.id, at(14), 60), block(later.id, DAY_END + 9 * H));
  const next = nextUp([missed, overdue, later, running], [event('Lunch', at(12), 60)], map, NOW, DAY_END);
  assert.equal(next?.task, running);
  assert.equal(next?.now, true, 'its block runs');
  assert.equal(next?.then, undefined, 'nothing else today: tomorrow\'s block and everything past stay out');
  const justDue = todo({ dueAt: NOW - 10 * M, estimateMin: 5 });
  assert.equal(nextUp([justDue], [], new Map(), NOW, DAY_END)?.now, true, 'a due time 10 minutes ago is now, not yet past');
  assert.equal(nextUp([todo({ dueAt: NOW - 31 * M })], [], new Map(), NOW, DAY_END), undefined, 'a due time 31 minutes ago is past');
});

test('next: an empty day is nothing; without a time the top of the list', () => {
  assert.equal(nextUp([], [], new Map(), NOW, DAY_END), undefined);
  const first = todo({ title: 'Approve the logo' });
  const second = todo({ title: 'Read the contract' });
  const next = nextUp([first, second], [], new Map(), NOW, DAY_END);
  assert.equal(next?.task, first);
  assert.equal(next?.startAt, undefined);
  assert.equal(next?.now, false);
  const missed = todo();
  assert.equal(nextUp([missed], [], slots(block(missed.id, at(8))), NOW, DAY_END), undefined, 'a passed one is no top: its row asks for a new time');
});

test('the day\'s zone: tomorrow at the start of work is that zone\'s wall time, also across the clock change', () => {
  assert.equal(tomorrowAt('2026-11-17', '08:00', 'Europe/Vienna'), Date.UTC(2026, 10, 18, 7, 0));
  assert.equal(tomorrowAt('2026-11-17', '09:30', 'America/New_York'), Date.UTC(2026, 10, 18, 14, 30));
  assert.equal(tomorrowAt('2026-10-24', '08:00', 'Europe/Vienna'), Date.UTC(2026, 9, 25, 7, 0), 'winter time from 25 Oct');
  assert.equal(tomorrowAt('2026-10-23', '08:00', 'Europe/Vienna'), Date.UTC(2026, 9, 24, 6, 0), 'summer time the day before');
  assert.equal(tomorrowAt('2026-11-17', 'soon', 'UTC'), Date.UTC(2026, 10, 18, 8, 0), 'an unreadable clock: 08:00');
});

test('a passed time: the 30-minute line, a block still running, done blocks, a to-do without a time, a fixed time', () => {
  const missed = block('t1', at(8), 15);
  assert.equal(staleBlock(missed, at(8, 30)), undefined, '30 minutes after the start: not yet');
  assert.equal(staleBlock(missed, at(8, 30) + 1000), missed, 'just over 30 minutes');
  const long = block('t2', at(9), 120);
  assert.equal(staleBlock(long, at(10)), undefined, 'a block that still runs is no passed time');
  assert.equal(staleBlock(long, at(11)), long, 'once it is over');
  assert.equal(staleBlock(block('t3', at(8), 15, { state: 'done' }), NOW), undefined, 'a done block');
  assert.equal(staleBlock(block('t4', at(8), 15, { state: 'cut' }), NOW), undefined, 'a cut block');
  assert.equal(staleBlock(undefined, NOW), undefined, 'a to-do without a time never asks');
  const pinned = block('t5', at(8), 30, { setBy: 'person' });
  assert.equal(staleBlock(pinned, NOW), pinned, 'a time the person fixed asks too: only they move it');
  const ring = todo({ widget: { type: 'timer', label: 'Stretch', at: new Date(at(8)).toISOString() } });
  assert.deepEqual(timeOf(ring), { startAt: at(8), endAt: at(8) }, 'a timer\'s time is its ring');
  assert.equal(isPast(timeOf(ring)!, NOW), true);
  assert.equal(staleBlock(undefined, NOW), undefined, 'but without a block it keeps its own snooze');
  assert.equal(STALE_MS, 30 * M);
});

test('"High" only near its deadline: Urgent always, High less than an hour before its due time or past it, never without one', () => {
  assert.equal(priorityWord({ priority: 2 }, NOW), 'Urgent');
  assert.equal(priorityWord({ priority: 1, dueAt: NOW + 2 * H }, NOW), '', 'due in two hours: no word');
  assert.equal(priorityWord({ priority: 1, dueAt: NOW + 59 * M }, NOW), 'High');
  assert.equal(priorityWord({ priority: 1, dueAt: NOW - 3 * H }, NOW), 'High', 'overdue');
  assert.equal(priorityWord({ priority: 1 }, NOW), '', 'no due time');
  assert.equal(priorityWord({ priority: 0, dueAt: NOW - H }, NOW), '', 'normal stays normal');
});

test('a row\'s time names its day when it is not today', () => {
  assert.equal(dayTimeText(at(9, 30), 'UTC', '2026-11-17'), '09:30');
  assert.equal(dayTimeText(DAY_END + 18 * H, 'UTC', '2026-11-17'), 'Tomorrow 18:00');
  assert.equal(dayTimeText(at(8) - 24 * H, 'UTC', '2026-11-17'), 'Yesterday 08:00');
  assert.equal(dayTimeText(DAY_END + 2 * 24 * H + 23 * H, 'UTC', '2026-11-17'), 'Fri 20 Nov 23:00');
  assert.equal(dayTimeText(at(23, 30), 'Europe/Vienna', '2026-11-17'), 'Tomorrow 00:30', 'in the day\'s zone');
});

test('who asks: an agent or a colleague, never the person themselves or the app', () => {
  assert.equal(askedBy({ createdBy: MIRA }), MIRA);
  assert.equal(askedBy({ createdBy: 'per_01jab3k9z7mx2c4q' }), 'per_01jab3k9z7mx2c4q');
  assert.equal(askedBy({ createdBy: HUMAN_ID }), undefined);
  assert.equal(askedBy({ createdBy: SYSTEM_ID }), undefined);
});

test('the next free time: from the next quarter hour half an hour on, between busy times, before the end of the day', () => {
  const now = at(14, 5); // → 14:45
  assert.equal(freeSlot([], 15, now, at(20)), at(14, 45));
  assert.equal(freeSlot([{ startAt: at(14, 30), endAt: at(15, 10) }], 15, now, at(20)), at(15, 10), 'after what is busy');
  assert.equal(freeSlot([{ startAt: at(16), endAt: at(17) }, { startAt: at(14, 50), endAt: at(15, 58) }], 30, now, at(20)), at(17), 'a gap too short is skipped');
  assert.equal(freeSlot([{ startAt: at(15), endAt: at(19, 50) }], 30, now, at(20)), undefined, 'nothing left before the end of the day');
  assert.equal(freeSlot([], 15, at(19, 40), at(20)), undefined, 'the working day is over');
});

test('done since yesterday: the person\'s own list and what they handed off, once, since last evening, newest first', () => {
  const since = at(0) - 4 * H; // 20:00 the evening before
  const mail = todo({ id: 'mail', title: 'Send the mail', status: 'done', completedAt: at(9) });
  const code = todo({ id: 'code', title: 'Enter the code', status: 'done', completedAt: at(11) });
  const old = todo({ id: 'old', status: 'done', completedAt: since - M });
  const colleague = todo({ id: 'theirs', status: 'done', completedAt: at(10), assigneeId: 'per_01jab3k9z7mx2c4q' });
  const dropped = todo({ id: 'dropped', status: 'dropped', completedAt: at(10) });
  const handed = todo({ id: 'tax', title: 'Prepare the tax papers', assigneeKind: 'agent', assigneeId: MIRA, status: 'done', completedAt: at(7) });
  const done = doneSince([mail, code, old, colleague, dropped], [handed, code], since);
  assert.deepEqual(done.map((task) => task.id), ['code', 'mail', 'tax']);
});

test('firstStale: the first row in the list past its planned time asks; later ones wait as a line', () => {
  const now = at(16, 0);
  const slots = new Map([
    ['a', block('a', at(8, 0))],
    ['b', block('b', at(9, 0))],
    ['c', block('c', at(18, 0))], // still ahead
  ]);
  assert.equal(firstStale([{ id: 'x' }, { id: 'a' }, { id: 'b' }], slots, now), 'a', 'rows without a block are skipped; the first with a passed one asks');
  assert.equal(firstStale([{ id: 'b' }, { id: 'a' }], slots, now), 'b', 'in the list\'s order, not by time');
  assert.equal(firstStale([{ id: 'c' }, { id: 'x' }], slots, now), undefined, 'nothing past its time: nobody asks');
  assert.equal(firstStale([{ id: 'b' }], slots, now), 'b', 'a single one asks in its box');
  assert.equal(firstStale([{ id: 'a' }], new Map(), now), undefined);
});
