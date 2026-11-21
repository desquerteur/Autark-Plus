// 17.11.2026 ("My day" package 2): what the list of agent changes shows – an agent's close, move or hand-over of the person's to-do within 24 hours, once per
// task, newest first; the person's own changes, undone entries, old entries and working-text-only changes are not in it.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskChange } from '../../../src/shared/model/tasks.ts';
import { agentChanges, changeVerb } from '../../../src/ui/day/day-changes.ts';

const HOUR = 3600_000;
const NOW = 1_800_000_000_000;
const entry = (patch: Partial<TaskChange>): TaskChange => ({ id: 'chg_1', at: NOW - HOUR, by: 'ag_ida', kind: 'finish', before: { status: 'open' }, after: { status: 'done' }, ...patch });
const task = (id: string, changes: TaskChange[], title = id) => ({ id, title, status: 'open' as const, ledger: { changes } });

test('the verbs: closed, closed as not needed, moved the time of, gave on; waiting or a new title is not worth a line', () => {
  assert.equal(changeVerb(entry({})), 'closed');
  assert.equal(changeVerb(entry({ after: { status: 'dropped' } })), 'closed as not needed');
  assert.equal(changeVerb(entry({ kind: 'update', before: { dueAt: 1 }, after: { dueAt: 2 } })), 'moved the time of');
  assert.equal(changeVerb(entry({ kind: 'give', before: { assigneeId: 'a' }, after: { assigneeId: 'b' } })), 'gave on');
  assert.equal(changeVerb(entry({ kind: 'update', after: { status: 'waiting' } })), undefined);
  assert.equal(changeVerb(entry({ kind: 'update', before: { title: 'a' }, after: { title: 'b' } })), undefined);
});

test('only others\' fresh, not undone changes, the latest per task, newest first', () => {
  const rows = [
    task('t_closed', [entry({ at: NOW - 3 * HOUR })]),
    task('t_mine', [entry({ by: 'human' })]),
    task('t_undone', [entry({ undone: NOW - 1000 })]),
    task('t_old', [entry({ at: NOW - 25 * HOUR })]),
    task('t_moved', [entry({ at: NOW - HOUR, kind: 'update', before: { dueAt: 1 }, after: { dueAt: 2 } })]),
    task('t_later_by_me', [entry({ at: NOW - 3 * HOUR }), entry({ id: 'chg_2', at: NOW - HOUR, by: 'human', kind: 'update', before: { priority: 0 }, after: { priority: 1 } })]),
    task('t_none', []),
  ];
  assert.deepEqual(agentChanges(rows, NOW).map((row) => [row.task.id, row.verb]), [['t_moved', 'moved the time of'], ['t_closed', 'closed']]);
  assert.deepEqual(agentChanges([...rows, rows[0]!], NOW).length, 2, 'a task listed twice counts once');
});
