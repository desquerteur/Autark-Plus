// The one planned look of a task (runtime/tasks/next.ts): nextLook after a change, lookAfterTurn after the owner's
// turn, lookOf / noteOf / wakeReason when the look comes.
// Owns: these assertions only. Never: services, engines or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../../src/shared/model/tasks.ts';
import { PAUSED_REASON } from '../../../src/shared/model/tasks.ts';
import { STUCK_MS } from '../../../src/shared/model/task-stuck.ts';
import { OUTAGE_MAX_MS, RECHECK_MS, lookAfterTurn, lookOf, nextLook, noteOf, stallDelay, wakeReason } from '../../../src/runtime/tasks/next.ts';

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);
const HOUR = 3600_000;

function task(extra: Partial<Task> = {}): Task {
  return {
    id: 'task_1', title: 'Wochenbericht', notes: '', status: 'open', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: 'human',
    priority: 0, ledger: { movedAt: NOW - HOUR }, sort: 0, rev: 0, createdAt: NOW - 2 * HOUR, updatedAt: NOW - HOUR, ...extra,
  };
}

const turn = (extra: Partial<Parameters<typeof lookAfterTurn>[1]> = {}) => ({ agentId: 'ag_ida', taskId: 'task_1', runId: 'run_1', progressed: true, outcome: 'done' as const, ...extra });
const names = { zone: 'UTC', nameOf: (id: string) => ({ human: 'Felix', ag_jonas: 'Jonas' } as Record<string, string>)[id] ?? id };

test('nextLook: an agent\'s open work goes on now; finished and paused work plans nothing', () => {
  assert.equal(nextLook(task(), NOW), NOW);
  assert.equal(nextLook(task({ status: 'done' }), NOW), undefined);
  assert.equal(nextLook(task({ status: 'waiting', waitingOn: { on: 'who', who: 'human', why: PAUSED_REASON, since: NOW } }), NOW), undefined);
});

test('nextLook: a wait looks again at its until, a day after it began (outside) or two (someone, a task); a due time ahead comes first', () => {
  const since = NOW - HOUR;
  assert.equal(nextLook(task({ status: 'waiting', waitingOn: { on: 'outside', why: 'Testkonto fehlt', since } }), NOW), since + RECHECK_MS);
  assert.equal(nextLook(task({ status: 'waiting', waitingOn: { on: 'who', who: 'human', why: 'Antwort', since } }), NOW), since + STUCK_MS);
  assert.equal(nextLook(task({ status: 'waiting', waitingOn: { on: 'task', ids: ['task_2'], why: 'After', since } }), NOW), since + STUCK_MS);
  assert.equal(nextLook(task({ status: 'waiting', waitingOn: { on: 'outside', why: 'Snooze', since, until: NOW + 3 * HOUR } }), NOW), NOW + 3 * HOUR);
  assert.equal(nextLook(task({ status: 'waiting', dueAt: NOW + 2 * HOUR, waitingOn: { on: 'outside', why: 'x', since } }), NOW), NOW + 2 * HOUR);
});

test('nextLook: open work with pieces of others is looked at two days after its last move (a piece\'s end wakes it sooner)', () => {
  assert.equal(nextLook(task(), NOW, true), NOW - HOUR + STUCK_MS);
});

test('nextLook: a person\'s own to-do has nothing beyond its due time; work an agent gave them is looked at when stuck; "team" now', () => {
  assert.equal(nextLook(task({ assigneeKind: 'human', assigneeId: undefined, createdBy: 'human' }), NOW), undefined);
  assert.equal(nextLook(task({ assigneeKind: 'human', assigneeId: undefined, createdBy: 'human', dueAt: NOW + HOUR }), NOW), NOW + HOUR);
  assert.equal(nextLook(task({ assigneeKind: 'human', assigneeId: undefined, createdBy: 'ag_ida' }), NOW), NOW - HOUR + STUCK_MS);
  assert.equal(nextLook(task({ assigneeKind: 'team', assigneeId: undefined }), NOW), NOW);
});

test('lookAfterTurn: a moved task goes on now; an unmoved one doubles its pause; an outage retries within 30 min', () => {
  const moved = lookAfterTurn(task(), turn(), NOW, { splits: false, pieces: false });
  assert.deepEqual([moved.at, moved.ledger.stalls, moved.ledger.movedAt], [NOW, 0, NOW]);
  const stalled = lookAfterTurn(task({ ledger: { stalls: 2, movedAt: NOW - HOUR } }), turn({ progressed: false }), NOW, { splits: false, pieces: false });
  assert.deepEqual([stalled.at, stalled.ledger.stalls], [NOW + stallDelay(3), 3]);
  assert.equal(stallDelay(1), 60_000);
  assert.equal(stallDelay(40), 24 * HOUR);
  const outage = lookAfterTurn(task({ ledger: { stalls: 12 } }), turn({ progressed: false, outcome: 'limit' }), NOW, { splits: false, pieces: false });
  assert.equal(outage.at, NOW + OUTAGE_MAX_MS);
  const after = lookAfterTurn(task(), turn({ progressed: false, outcome: 'unavailable', retryAfterMs: 2 * HOUR }), NOW, { splits: false, pieces: false });
  assert.equal(after.at, NOW + 2 * HOUR);
});

test('lookAfterTurn: work its split groups do is looked at a day after its last move; a wait as nextLook says', () => {
  assert.equal(lookAfterTurn(task(), turn(), NOW, { splits: true, pieces: false }).at, NOW + RECHECK_MS);
  const waiting = task({ status: 'waiting', waitingOn: { on: 'who', who: 'human', why: 'Antwort', since: NOW } });
  assert.equal(lookAfterTurn(waiting, turn(), NOW, { splits: false, pieces: false }).at, NOW + STUCK_MS);
});

test('lookAfterTurn: a look at an old wait counts from that look – the wait is not looked at again at once', () => {
  const since = NOW - 3 * 24 * HOUR; // waits since three days, so since + a day lies in the past
  const outside = task({ status: 'waiting', waitingOn: { on: 'outside', why: 'Felix: Handy Mo 7:30?', since } });
  assert.equal(lookAfterTurn(outside, turn({ progressed: false }), NOW, { splits: false, pieces: false }).at, NOW + RECHECK_MS);
  const someone = task({ status: 'waiting', waitingOn: { on: 'who', who: 'ag_jonas', why: 'Fix', since } });
  assert.equal(lookAfterTurn(someone, turn({ progressed: false }), NOW, { splits: false, pieces: false }).at, NOW + STUCK_MS);
  assert.equal(nextLook(outside, NOW), since + RECHECK_MS); // outside a turn (e.g. at start) the overdue look comes now
});

test('lookOf, wakeReason and noteOf: why a due look comes, its rank and the note in my voice', () => {
  const since = NOW - 3 * 24 * HOUR;
  const waits = task({ status: 'waiting', waitingOn: { on: 'who', who: 'human', why: 'Handy-Test: 7:30 oder nachmittags?', since } });
  assert.equal(lookOf(waits, NOW), 'stuck');
  assert.equal(wakeReason('stuck'), 'retry');
  assert.match(noteOf(waits, 'stuck', NOW, names), /^My task "Wochenbericht" has not moved since .* – it waits on Felix since .*: |– Handy-Test/);
  const due = task({ dueAt: NOW - 1000, nextAt: NOW - 1000 });
  assert.equal(lookOf(due, NOW), 'due');
  assert.equal(wakeReason('due'), 'task');
  assert.match(noteOf(due, 'due', NOW, names), /^My task "Wochenbericht" is due now \(.*\); it is open\.$/);
  const ends = task({ status: 'waiting', waitingOn: { on: 'outside', why: 'Handy-Lauf um 15 Uhr', since, until: NOW - 1 } });
  assert.equal(lookOf(ends, NOW), 'wait-ends');
  assert.match(noteOf(ends, 'wait-ends', NOW, names), /^The wait of my task "Wochenbericht" ended/);
  assert.equal(lookOf(task({ ledger: { stalls: 2 } }), NOW), 'retry');
  assert.equal(lookOf(task(), NOW), 'continue');
  assert.equal(noteOf(task(), 'continue', NOW, names), 'I go on with my task "Wochenbericht".');
  assert.equal(lookOf(task({ status: 'waiting', waitingOn: { on: 'outside', why: 'Testkonto', since } }), NOW), 'recheck');
});
