// My day's groups (src/ui/day/day-groups.ts, B-041 §4.1 / contract §5.5): Needs you (what rang, the block in
// progress, overdue, what an agent or the host asks), Today (the day's blocks and near timers, by time), Unplanned
// (the person's own without a block), Later (snoozed, repeating, far timers, due or planned on a later day); another
// day lists its blocks and (B-080) Needs you by the badge's rule; the handed-off rows.
// Owns: these assertions only. Never: the DOM, rpc or real timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEvent } from '../../../src/shared/model/calendar.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { dayGroups, groupOf, handedOffRows } from '../../../src/ui/day/day-groups.ts';
import type { DayGroupInput } from '../../../src/ui/day/day-groups.ts';
import { countNow, needsYou } from '../../../src/shared/model/todo-later.ts';

const M = 60_000;
const H = 60 * M;
const DAY_START = new Date(2026, 9, 24, 0, 0, 0).getTime();
const DAY_END = DAY_START + 24 * H;
const NOW = DAY_START + 10 * H; // 10:00
let seq = 0;

function todo(patch: Partial<TaskView> = {}): TaskView {
  seq++;
  return {
    id: patch.id ?? `todo_${seq}`, conversationId: 'ch_todo', title: `To-do ${seq}`, notes: '', status: 'open', assigneeKind: 'human',
    createdBy: HUMAN_ID, priority: 0, ledger: {}, sort: seq, rev: 1, createdAt: NOW - 1000 * seq, updatedAt: NOW,
    steps: [], progress: { done: 0, total: 0 }, conversationTitle: 'To-dos', running: false,
    ...patch,
  };
}

function block(taskId: string, startAt: number, minutes = 30, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `cal_${taskId}`, ownerId: HUMAN_ID, kind: 'todo', taskId, startAt, endAt: startAt + minutes * M, sourceId: 'local',
    setBy: 'planner', state: 'planned', createdBy: 'system', rev: 1, createdAt: NOW, updatedAt: NOW, ...patch,
  };
}

const input = (slots: CalendarEvent[] = [], patch: Partial<DayGroupInput> = {}): DayGroupInput => ({
  now: NOW, dayStart: DAY_START, dayEnd: DAY_END, isToday: true, slots: new Map(slots.filter((slot) => slot.taskId).map((slot) => [slot.taskId!, slot])), ...patch,
});

const timer = (at: number, patch: Partial<TaskView> = {}) => todo({ widget: { type: 'timer', label: 'Stretch', at: new Date(at).toISOString() }, dueAt: at, ...patch });

test('Needs you: what rang, the block in progress, overdue, and what an agent or the host asks', () => {
  const rang = timer(NOW - 5 * M);
  const running = todo({ title: 'Kitchen' });
  const overdue = todo({ dueAt: NOW - H });
  const asked = todo({ createdBy: 'ag_mara', widget: { type: 'choice', options: ['A', 'B'] } });
  const slots = [block(running.id, NOW - 10 * M, 30)];
  for (const task of [rang, running, overdue, asked]) assert.equal(groupOf(task, input(slots)), 'needsYou', task.title);
  const agentApprove = todo({ createdBy: 'ag_mara', widget: { type: 'approve', action: 'Use the logo' } });
  assert.equal(groupOf(agentApprove, input()), 'needsYou', 'an agent-written approve is an ordinary question – it needs the person');
});

test('Today: the day\'s planned blocks and timers within 12 h, by time; Unplanned: the person\'s own without a block', () => {
  const taxes = todo({ title: 'Taxes' });
  const laundry = todo({ title: 'Laundry' });
  const stretch = timer(NOW + 30 * M, { title: 'Stretch' });
  const book = todo({ title: 'Book', estimateMin: 60 });
  const doneBlock = todo({ title: 'Was planned' });
  const slots = [block(taxes.id, NOW + 2 * H), block(laundry.id, NOW + H), block(doneBlock.id, NOW - 3 * H, 30, { state: 'done' })];
  const groups = dayGroups([taxes, book, stretch, laundry, doneBlock], input(slots));
  assert.deepEqual(groups.today.map((task) => task.title), ['Stretch', 'Laundry', 'Taxes']);
  assert.deepEqual(groups.unplanned.map((task) => task.title), ['Was planned', 'Book'], 'a done or cut block no longer places it (the calm order: older first)');
  assert.deepEqual(groups.needsYou, []);
});


test('one "Needs you" rule: the badge (countNow) counts exactly the Needs-you group, the running block aside', () => {
  const asked = todo({ createdBy: 'ag_mara', title: 'Which tax year?' });
  const colleague = todo({ createdBy: 'per_anna', title: 'Sign the form' });
  const askedTomorrow = todo({ createdBy: 'ag_mara', dueAt: DAY_END + H });
  const overdue = todo({ dueAt: NOW - H });
  const own = [todo({ title: 'Laundry' }), todo({ title: 'Kitchen' }), todo({ title: 'Book' }), timer(NOW + H)];
  const plannedLater = todo({ title: 'Taxes' });
  const list = [asked, colleague, askedTomorrow, overdue, plannedLater, ...own];
  const slots = [block(plannedLater.id, NOW + 2 * H)];
  const groups = dayGroups(list, input(slots));
  assert.deepEqual(new Set(groups.needsYou.map((task) => task.id)), new Set([asked.id, colleague.id, overdue.id]));
  assert.equal(countNow(list, NOW, DAY_END), groups.needsYou.length, 'the badge and the group agree');
  assert.equal(needsYou(own[0], NOW, DAY_END), false, "the person's own unplanned to-do does not need them");
  assert.equal(needsYou(askedTomorrow, NOW, DAY_END), false, 'never a Later one');
  const running = todo({ title: 'Running' });
  const withRunning = dayGroups([...list, running], input([...slots, block(running.id, NOW - 10 * M)]));
  assert.equal(withRunning.needsYou.length - 1, countNow([...list, running], NOW, DAY_END), 'My day adds the block in progress');
  assert.equal(countNow([...list, running], NOW, DAY_END, new Set([running.id])), withRunning.needsYou.length, 'the briefing passes the running block');
});

test("another day lists its blocks by start – and B-080 Needs you on top, by the badge's rule", () => {
  const a = todo({ title: 'A' });
  const b = todo({ title: 'B' });
  const c = todo({ title: 'C', createdBy: 'ag_mara' });
  const tomorrow = { dayStart: DAY_END, dayEnd: DAY_END + 24 * H, isToday: false };
  const groups = dayGroups([a, b, c], input([block(b.id, DAY_END + 9 * H), block(a.id, DAY_END + 14 * H), block(c.id, NOW)], tomorrow));
  assert.deepEqual(groups.today.map((task) => task.title), ['B', 'A']);
  assert.deepEqual(groups.needsYou.map((task) => task.title), ['C'], 'asked by Mara: it needs the person whatever day is shown');
  assert.deepEqual([...groups.unplanned, ...groups.later], []);
});

test('B-080: a list of only needs-you items is not empty on another day, and Needs you counts what the badge counts', () => {
  // Live: the badge said 9 while the next day said "Nothing planned".
  const asked = todo({ title: 'Approve the invoice', createdBy: 'ag_mara' });
  const overdue = todo({ title: 'Call the bank', dueAt: NOW - H });
  const own = todo({ title: 'Read the book' });
  const list = [asked, overdue, own];
  const tomorrow = { dayStart: DAY_END, dayEnd: DAY_END + 24 * H, isToday: false };
  const groups = dayGroups(list, input([], tomorrow));
  assert.deepEqual(groups.needsYou.map((task) => task.title).sort(), ['Approve the invoice', 'Call the bank']);
  assert.equal(groups.needsYou.length, countNow(list, NOW), 'the same count as the badge (store.ts forYouCount)');
  assert.deepEqual([...groups.today, ...groups.unplanned, ...groups.later], [], "the person's own to-do without a block or date stays off another day");
});


test('a to-do for another day (window.date – typed while that day was shown): Unplanned on that day, Later today', () => {
  const tomorrow = '2026-10-25';
  const laundry = todo({ title: 'Laundry', window: { date: tomorrow } });
  const kitchen = todo({ title: 'Kitchen' });
  const planned = todo({ title: 'Planned', window: { date: tomorrow } });
  const slots = [block(planned.id, DAY_END + 9 * H)];
  const there = dayGroups([laundry, kitchen, planned], input(slots, { dayStart: DAY_END, dayEnd: DAY_END + 24 * H, isToday: false, date: tomorrow }));
  assert.deepEqual(there.unplanned.map((task) => task.title), ['Laundry']);
  assert.deepEqual(there.today.map((task) => task.title), ['Planned']);
  const here = dayGroups([laundry, kitchen], input([], { date: '2026-10-24' }));
  assert.deepEqual([here.unplanned.map((task) => task.title), here.later.map((task) => task.title)], [['Kitchen'], ['Laundry']]);
});
