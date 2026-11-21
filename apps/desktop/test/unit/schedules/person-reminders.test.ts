// #34: person reminders use the existing My day task and snooze flows, one task per occurrence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../chat/harness.ts';
import { SchedulerImpl } from '../../../src/runtime/schedules/scheduler.ts';
import { outcomeText } from '../../../src/ui/schedules/schedules-model.ts';

const M = 60_000;

test('due reminder appears in My day; completing it marks exactly its occurrence done', () => {
  const h = harness();
  h.scheduler.start();
  const at = h.clock.now() + M;
  const schedule = h.scheduler.create({ ownerId: 'human', kind: 'timer', title: 'Take a break', spec: { at, everyMs: M }, payload: { note: 'Walk outside' } });
  assert.equal(h.tasks.todos().length, 0);
  h.clock.advance(M);
  h.scheduler.tick();
  const [first] = h.tasks.todos();
  assert.equal(first.title, 'Take a break');
  assert.equal(first.notes, 'Walk outside');
  assert.equal(first.origin?.source, `schedule:${schedule.id}`);
  assert.equal(first.dueAt, at);
  h.scheduler.tick();
  assert.equal(h.tasks.todos().length, 1, 'same occurrence never creates twice');
  h.clock.advance(M);
  h.scheduler.tick();
  assert.equal(h.tasks.todos().length, 2, 'next occurrence is independent');
  h.tasks.answer({ taskId: first.id, answer: { confirmed: true }, by: 'human' });
  const runs = h.scheduler.get(schedule.id)!.history!;
  assert.equal(runs[0].taskId, first.id);
  assert.equal(outcomeText(runs[0]), 'Done');
  assert.equal(outcomeText(runs[1]), 'In My day');
  h.tasks.remove(first.id, 'human');
  assert.equal(outcomeText(h.scheduler.get(schedule.id)!.history![0]), 'Done', 'cleanup preserves completion');
  h.scheduler.stop();
});

test('snooze rings the same item; done and skip survive restart without affecting the source schedule', () => {
  const h = harness();
  h.scheduler.start();
  const schedule = h.scheduler.create({ ownerId: 'human', kind: 'timer', title: 'Stretch', spec: { at: h.clock.now() + M }, payload: {} });
  h.clock.advance(M); h.scheduler.tick();
  const task = h.tasks.todos()[0];
  const until = h.clock.now() + 5 * M;
  h.tasks.snooze(task.id, until);
  assert.equal(outcomeText(h.scheduler.get(schedule.id)!.history![0]), 'Snoozed');
  assert.equal(h.scheduler.get(schedule.id)!.history![0].personActions!.at(-1)!.until, until);
  h.clock.advance(5 * M); h.scheduler.tick();
  assert.equal(h.tasks.todos().length, 1);
  assert.equal(h.tasks.get(task.id)!.status, 'needs_you');
  h.tasks.setStatus(task.id, 'done', 'human');
  const actions = h.scheduler.get(schedule.id)!.history![0].personActions!;
  assert.deepEqual(actions.map(a => a.state), ['pending', 'snoozed', 'pending', 'done']);
  h.scheduler.stop();
  const restarted = new SchedulerImpl(h.services, { timers: h.timers });
  restarted.start();
  assert.equal(outcomeText(restarted.get(schedule.id)!.history![0]), 'Done');
  assert.equal(h.tasks.todos().length, 0);
  restarted.stop();
});

test('removing or cancelling a My day reminder records skip and keeps the source history', () => {
  const h = harness(); h.scheduler.start();
  const schedule = h.scheduler.create({ ownerId: 'human', kind: 'timer', title: 'Read', spec: { everyMs: M }, payload: {} });
  h.clock.advance(M); h.scheduler.tick();
  h.tasks.remove(h.tasks.todos()[0].id, 'human');
  assert.equal(outcomeText(h.scheduler.get(schedule.id)!.history![0]), 'Skipped');
  h.clock.advance(M); h.scheduler.tick();
  h.tasks.setStatus(h.tasks.todos()[0].id, 'cancelled', 'human');
  assert.equal(outcomeText(h.scheduler.get(schedule.id)!.history![1]), 'Skipped');
  assert.equal(h.scheduler.get(schedule.id)!.active, true);
  h.scheduler.stop();
});

test('missed reminders catch up once after restart, not again on a second restart', () => {
  const h = harness();
  const schedule = h.scheduler.create({ ownerId: 'human', kind: 'timer', title: 'Water plants', spec: { everyMs: M }, payload: {} });
  h.clock.advance(10 * M);
  h.scheduler.start(); h.scheduler.stop();
  const restarted = new SchedulerImpl(h.services, { timers: h.timers });
  restarted.start();
  assert.equal(h.tasks.todos().length, 1);
  assert.equal(restarted.get(schedule.id)!.history!.length, 1);
  restarted.stop();
});

test('person reminders keep separate occurrence tasks across Berlin summer/winter changes', () => {
  for (const date of [Date.UTC(2026, 9, 23, 4), Date.UTC(2027, 2, 26, 5)]) {
    const h = harness();
    h.clock.advance(date - h.clock.now());
    h.scheduler.start();
    const schedule = h.scheduler.create({ ownerId: 'human', kind: 'timer', title: 'Morning', spec: { times: ['06:00'], tz: 'Europe/Berlin' }, payload: {} });
    const firstAt = schedule.nextAt!;
    h.clock.advance(firstAt - h.clock.now()); h.scheduler.tick();
    const nextAt = h.scheduler.get(schedule.id)!.nextAt!;
    assert.ok([23, 25].includes((nextAt - firstAt) / (60 * M)));
    h.clock.advance(nextAt - h.clock.now()); h.scheduler.tick();
    const runs = h.scheduler.get(schedule.id)!.history!;
    assert.equal(runs.length, 2);
    assert.notEqual(runs[0].taskId, runs[1].taskId);
    assert.equal(h.tasks.todos().length, 2);
    assert.equal(h.wakeRows().length, 0, 'no agent wakes for person reminders');
    h.scheduler.stop();
  }
});
