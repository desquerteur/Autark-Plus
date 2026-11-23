// The calm For-you list's order and time rules (F04, src/ui/tasks/todo-time.ts via tasks/model.ts):
// a to-do that rang sorts first (before an open one due earlier); the
// "Later" split takes snoozed to-dos, repeating timers waiting for their next time, timers more
// than 12 h ahead and (B-041) any other to-do due on a later day, never one that rang; the badge
// counts only what is due now; the snooze choices' "Tomorrow" at the start of work across the
// 04:00 day boundary; a timer's row
// time and its countdown in the last hour; a snooze's end from its schedule; the For-you clock's
// next change (also when "now" becomes "1 minute ago" after a ring, "in 3 hours" moves on, or
// "Tomorrow" at midnight); the chat panel leaves "Later" to-dos out.
// Owns: these assertions only. Never: the DOM, rpc or real timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Schedule, TaskView } from '../../../src/shared/model/tasks.ts';
import { relative, time } from '../../../src/ui/lib/format.ts';
import {
  HOUR_MS, LATER_MS, MINUTE_MS, compareTodos, countNow, countdownMs, isLater, isRinging, isSnoozed, nextListChange,
  onForYouList, relativeChange, snoozeEnd, splitLater, timerAt, whenText,
} from '../../../src/ui/tasks/model.ts';
import { endOfToday, nextMorning, snoozeChoices } from '../../../src/ui/tasks/todo-time.ts';

const NOW = new Date(2026, 9, 20, 16, 55, 0).getTime(); // local time, 16:55
const DAY = 24 * HOUR_MS;
let seq = 0;

function todo(patch: Partial<TaskView> = {}): TaskView {
  seq++;
  return {
    id: patch.id ?? `todo_${seq}`, conversationId: 'ch_a', title: `To-do ${seq}`, notes: '', status: 'open', assigneeKind: 'human',
    createdBy: 'ag_ava', priority: 0, ledger: {}, sort: seq, rev: 1, createdAt: NOW - 1000 * seq, updatedAt: NOW,
    steps: [], progress: { done: 0, total: 0 }, conversationTitle: 'Alpha', running: false,
    ...patch,
  };
}

/** A timer to-do ringing at `at` (absolute, as the runtime stores it), due then. */
function timer(at: number, patch: Partial<TaskView> = {}): TaskView {
  return todo({ widget: { type: 'timer', label: 'Stretch', at: new Date(at).toISOString() }, dueAt: at, ...patch });
}

const snoozed = (patch: Partial<TaskView> = {}) => todo({ status: 'waiting', waitingOn: { on: 'outside', why: 'Snoozed', since: NOW - MINUTE_MS }, ...patch });




test('B-041 snooze choices: 10 minutes, 1 hour, tomorrow at the start of work – before 04:00 "tomorrow" is the coming morning', () => {
  const choices = snoozeChoices(NOW, '08:30');
  const morning = new Date(2026, 9, 21, 8, 30, 0).getTime();
  assert.deepEqual(choices.map((choice) => choice.until), [NOW + 10 * MINUTE_MS, NOW + HOUR_MS, morning]);
  assert.deepEqual(choices.map((choice) => choice.label), ['In 10 minutes', 'In 1 hour', `Tomorrow ${time(morning)}`]);
  const night = new Date(2026, 9, 21, 0, 40, 0).getTime();
  assert.equal(nextMorning(night, '08:00'), new Date(2026, 9, 21, 8, 0, 0).getTime(), '00:40: the coming morning, same date');
  assert.equal(nextMorning(new Date(2026, 9, 21, 4, 0, 0).getTime(), '08:00'), new Date(2026, 9, 22, 8, 0, 0).getTime(), 'from 04:00 on: the next date');
  assert.equal(nextMorning(NOW, 'later'), new Date(2026, 9, 21, 8, 0, 0).getTime(), 'an unreadable work start: 08:00');
});



test('a timer row: ring time, a countdown in the last hour only ("17:00 · in 5 min")', () => {
  const five = new Date(2026, 9, 20, 17, 0, 0).getTime();
  assert.equal(timerAt(timer(five)), five);
  assert.equal(timerAt(todo({ dueAt: five })), undefined, 'a due date is no ring time');
  assert.equal(timerAt(todo({ widget: { type: 'timer', label: 'x', duration: 'PT5M' } })), undefined, 'not armed yet: no ring time');
  assert.equal(whenText(five, NOW), time(five), 'today: the clock time');
  assert.equal(countdownMs(five, NOW), 5 * MINUTE_MS);
  assert.equal(countdownMs(five, NOW + 30_000), 5 * MINUTE_MS, 'rounded up to whole minutes');
  assert.equal(countdownMs(five, five - 20_000), MINUTE_MS);
  assert.equal(countdownMs(five, five - HOUR_MS), HOUR_MS, 'exactly an hour ahead: the countdown starts');
  assert.equal(countdownMs(five, five - HOUR_MS - 1), undefined, 'more than an hour ahead: no countdown');
  assert.equal(countdownMs(five, five), undefined, 'it rings: no countdown');
  const tomorrow = new Date(2026, 9, 21, 9, 0, 0).getTime();
  assert.equal(whenText(tomorrow, NOW), `Tomorrow ${time(tomorrow)}`);
  const friday = new Date(2026, 9, 23, 9, 0, 0).getTime();
  assert.match(whenText(friday, NOW), new RegExp(`^\\S+ ${time(friday)}$`), 'this week: weekday and time');
  assert.notEqual(whenText(friday, NOW).split(' ')[0], 'Tomorrow');
  const nextMonth = new Date(2026, 10, 24, 9, 0, 0).getTime();
  assert.match(whenText(nextMonth, NOW), /24/, 'further: the date');
});

test('snoozeEnd: the pending one-shot timer of the to-do, not its repeating ring or another to-do\'s', () => {
  const schedule = (patch: Partial<Schedule>): Schedule => ({
    id: `sch_${++seq}`, ownerId: 'human', taskId: 'todo_x', kind: 'timer', title: 'Bread', spec: { at: NOW + 10 * MINUTE_MS }, payload: {},
    runs: 0, active: true, createdAt: NOW, ...patch,
  });
  const list = [
    schedule({ spec: { cron: '0 9 * * *' }, nextAt: NOW + MINUTE_MS }),
    schedule({ taskId: 'todo_y', spec: { at: NOW + 2 * MINUTE_MS } }),
    schedule({ active: false, spec: { at: NOW + 3 * MINUTE_MS } }),
    schedule({ kind: 'message', spec: { at: NOW + 4 * MINUTE_MS } }),
    schedule({ spec: { at: NOW + 10 * MINUTE_MS } }),
  ];
  assert.equal(snoozeEnd(list, 'todo_x'), NOW + 10 * MINUTE_MS);
  assert.equal(snoozeEnd([], 'todo_x'), undefined);
});

test('nextListChange: a timer leaves Later, its countdown starts and moves, it rings; a due time comes near and passes', () => {
  assert.equal(nextListChange([timer(NOW + 13 * HOUR_MS)], NOW), NOW + HOUR_MS, 'it joins the list 12 h ahead');
  assert.equal(nextListChange([timer(NOW + 5 * HOUR_MS)], NOW), NOW + 4 * HOUR_MS, 'its countdown starts an hour ahead');
  assert.equal(nextListChange([timer(NOW + 5 * MINUTE_MS)], NOW), NOW + MINUTE_MS, 'the next countdown minute');
  assert.equal(nextListChange([timer(NOW + 5 * MINUTE_MS)], NOW + 30_000), NOW + MINUTE_MS, 'from mid-minute to the next step');
  assert.equal(nextListChange([timer(NOW + 20_000)], NOW), NOW + 20_000, 'the ring itself');
  assert.equal(nextListChange([todo({ dueAt: NOW + 20_000 })], NOW), NOW + 20_000, 'a due time passes');
  assert.equal(nextListChange([todo({ dueAt: NOW + DAY + 10 * MINUTE_MS })], NOW), NOW + 10 * MINUTE_MS, 'a due time comes within a day');
  assert.equal(nextListChange([todo()], NOW), undefined, 'no time on the row: nothing changes by time');
  assert.equal(nextListChange([timer(NOW + 2 * DAY), timer(NOW + 5 * MINUTE_MS)], NOW), NOW + MINUTE_MS, 'the earliest change wins');
});


test('relativeChange: the next moment relative() reads differently – never later, never a moment without a change', () => {
  const at = NOW;
  const span = [-3 * DAY, -DAY - 1, -DAY, -2 * HOUR_MS, -HOUR_MS, -90_001, -90_000, -MINUTE_MS, -1, 0, 1, 59_999, MINUTE_MS, 89_999, 90_000, HOUR_MS - 1, HOUR_MS, 5 * HOUR_MS, DAY - 1, DAY, 3 * DAY];
  for (let offset = -3 * DAY; offset <= 3 * DAY; offset += 7 * MINUTE_MS + 13_001) span.push(offset);
  for (const offset of span) {
    const now = at - offset;
    const next = relativeChange(at, now);
    assert.ok(next > now, `after now (${offset})`);
    assert.notEqual(relative(at, next), relative(at, now), `it changes at ${next - now} ms (${offset})`);
    assert.equal(relative(at, next - 1), relative(at, now), `nothing changes before (${offset})`);
    assert.equal(relative(at, Math.floor((now + next) / 2)), relative(at, now), `nor in between (${offset})`);
  }
});
