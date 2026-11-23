// The task part of the 13.11.2026 bridge (runtime/bridge/kontext-1311.ts): every old status and wait becomes one of
// the four states with its wait, the ledger keeps plan, facts, stalls and doneCount (lastProgressAt → movedAt), a new
// row comes back as it is, stored rows are rewritten once, and older PCs keep reading every row (no column dropped).
// Also the shared stuck rule (shared/model/task-stuck.ts).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate } from '../../../src/runtime/db/migrate.ts';
import type { Task } from '../../../src/shared/model/tasks.ts';
import { PAUSED_REASON } from '../../../src/shared/model/tasks.ts';
import { STUCK_MS, stuckOf } from '../../../src/shared/model/task-stuck.ts';
import { convertTaskRows, foldOwnSteps, simpleTask } from '../../../src/runtime/bridge/kontext-1311.ts';
import { TaskRepo } from '../../../src/runtime/tasks/repo.ts';

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);

function old(status: string, extra: Record<string, unknown> = {}): Task {
  return {
    id: 'task_1', title: 'T', notes: '', status, assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: 'human', priority: 0,
    ledger: {}, sort: 0, rev: 0, createdAt: NOW, updatedAt: NOW, ...extra,
  } as unknown as Task;
}

test('every old status and wait becomes one of the four states', () => {
  assert.equal(simpleTask(old('working')).status, 'open');
  assert.equal(simpleTask(old('cancelled')).status, 'dropped');
  assert.deepEqual(simpleTask(old('waiting', { waitingOn: { kind: 'external', reason: 'Felix', since: 5 } })).waitingOn, { on: 'outside', why: 'Felix', since: 5 });
  assert.deepEqual(simpleTask(old('waiting', { waitingOn: { kind: 'human', id: 'per_mara', reason: 'Antwort', since: 5 } })).waitingOn, { on: 'who', who: 'per_mara', why: 'Antwort', since: 5 });
  assert.deepEqual(simpleTask(old('waiting', { waitingOn: { kind: 'task', id: 'task_2', ids: ['task_3'], reason: 'After', since: 5 } })).waitingOn, { on: 'task', ids: ['task_3', 'task_2'], why: 'After', since: 5 });
  assert.deepEqual(simpleTask(old('waiting', { assigneeKind: 'human', waitingOn: { kind: 'schedule', reason: 'Snoozed', since: 5, until: 9 } })).waitingOn, { on: 'outside', why: 'Snoozed', since: 5, until: 9 });
  const needs = simpleTask(old('needs_you', { waitingOn: { kind: 'human', reason: 'Login', since: 5 } }));
  assert.deepEqual([needs.status, needs.waitingOn], ['waiting', { on: 'who', who: 'human', why: 'Login', since: 5 }]);
  assert.equal(simpleTask(old('needs_you', { assigneeKind: 'human' })).status, 'open', 'a person\'s rung to-do is open');
  const blocked = simpleTask(old('blocked'));
  assert.deepEqual([blocked.status, blocked.waitingOn?.on], ['waiting', 'outside']);
  const paused = simpleTask(old('open', { waitingOn: { kind: 'human', reason: PAUSED_REASON, since: 5 } }));
  assert.deepEqual([paused.status, paused.waitingOn], ['waiting', { on: 'who', who: 'human', why: PAUSED_REASON, since: 5 }]);
});

test('the ledger keeps plan, facts, stalls and doneCount; a new row comes back as it is', () => {
  const task = simpleTask(old('open', { ledger: { plan: ['a'], facts: ['f'], stalls: 2, doneCount: 3, lastProgressAt: 7, tried: [{}], nextCheckAt: 9, escalation: 'none', cancelledBy: 'human' } }));
  assert.deepEqual(task.ledger, { plan: ['a'], facts: ['f'], stalls: 2, doneCount: 3, movedAt: 7 });
  const fresh = old('waiting', { waitingOn: { on: 'who', who: 'human', why: 'x', since: 1 }, ledger: { movedAt: 3 } });
  assert.equal(simpleTask(fresh), fresh);
});

test('stored rows are rewritten once; every old column stays for older PCs', () => {
  const db = new Db(':memory:');
  migrate(db);
  db.run(`INSERT INTO tasks (id, title, notes, status, assignee_kind, assignee_id, created_by, priority, ledger, attempts, sort, rev, created_at, updated_at, waiting_on)
    VALUES ('task_1', 'T', '', 'needs_you', 'agent', 'ag_ida', 'human', 0, '{"tried":[],"plan":["a"]}', 4, 0, 0, 1, 1, '{"kind":"human","reason":"Login","since":1}')`);
  assert.equal(convertTaskRows(db), 1);
  assert.equal(convertTaskRows(db), 0);
  const row = db.get<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', ['task_1'])!;
  assert.deepEqual([row.status, JSON.parse(String(row.waiting_on)).on, JSON.parse(String(row.ledger)).plan, row.attempts], ['waiting', 'who', ['a'], 4]);
  const columns = db.all<{ name: string }>(`SELECT name FROM pragma_table_info('tasks')`).map((entry) => entry.name);
  for (const name of ['attempts', 'goal', 'human_reason', 'ledger', 'mode', 'next_at']) assert.ok(columns.includes(name), name);
  const repo = new TaskRepo(db);
  const task = repo.get('task_1')!;
  repo.save({ ...task, title: 'U', rev: task.rev + 1 }, task.rev);
  assert.equal(db.get<{ attempts: number }>('SELECT attempts FROM tasks WHERE id = ?', ['task_1'])!.attempts, 4, 'a save leaves the old columns as they are');
});

test('stuck: nothing moved for two days, unless a planned time is ahead', () => {
  const base = { assigneeKind: 'agent' as const, status: 'open' as const, ledger: { movedAt: NOW }, createdAt: NOW };
  assert.equal(stuckOf(base, NOW + STUCK_MS - 1), null);
  assert.deepEqual(stuckOf(base, NOW + STUCK_MS + 1), { why: 'Nothing moved', since: NOW });
  assert.equal(stuckOf({ ...base, dueAt: NOW + 3 * STUCK_MS }, NOW + STUCK_MS + 1), null);
  assert.equal(stuckOf({ ...base, status: 'waiting', waitingOn: { on: 'outside', why: 'x', since: NOW, until: NOW + 3 * STUCK_MS } }, NOW + STUCK_MS + 1), null);
  assert.deepEqual(stuckOf({ ...base, status: 'waiting', waitingOn: { on: 'who', who: 'human', why: 'Antwort', since: NOW } }, NOW + STUCK_MS + 1), { why: 'Antwort', since: NOW });
  assert.equal(stuckOf({ ...base, status: 'done' }, NOW + 9 * STUCK_MS), null);
  assert.deepEqual(stuckOf({ ...base, assigneeKind: 'team' }, NOW), { why: 'No owner yet', since: NOW });
});

test('the look the old system planned stays: ledger.nextCheckAt, else a queued retry, becomes next_at', () => {
  const db = new Db(':memory:');
  migrate(db);
  const insert = (id: string, ledger: string) => db.run(`INSERT INTO tasks (id, title, notes, status, assignee_kind, assignee_id, created_by, priority, ledger, sort, rev, created_at, updated_at)
    VALUES (?, 'T', '', 'open', 'agent', 'ag_ida', 'human', 0, ?, 0, 0, 1, 1)`, [id, ledger]);
  insert('task_1', `{"nextCheckAt":${NOW + 5000}}`);
  convertTaskRows(db);
  const row = db.get<{ next_at: number; ledger: string }>('SELECT next_at, ledger FROM tasks WHERE id = ?', ['task_1'])!;
  assert.equal(row.next_at, NOW + 5000);
  assert.equal(JSON.parse(row.ledger).nextCheckAt, undefined, 'the ledger is in the new shape');
});

test('old own steps: the parent\'s plan holds them, each unfinished step row is dropped (kept), its queued wake goes; once is enough', () => {
  const db = new Db(':memory:');
  migrate(db);
  const insert = (id: string, parent: string | null, status: string, title: string, ledger = '{}', owner = 'ag_ida', sort = 0) => db.run(`INSERT INTO tasks (id, parent_id, title, notes, status, assignee_kind, assignee_id, created_by, priority, ledger, sort, rev, created_at, updated_at)
    VALUES (?, ?, ?, '', ?, 'agent', ?, 'human', 0, ?, ?, 0, 1, 1)`, [id, parent, title, status, owner, ledger, sort]);
  insert('task_p', null, 'waiting', 'Montagstest', '{"plan":["✓ QR-Code qa/belege/handy-link.png","Mo 16.11.: Handy-Lauf"]}');
  insert('task_s1', 'task_p', 'open', 'QR-Code mit Link erzeugen', '{}', 'ag_ida', 0);
  insert('task_s2', 'task_p', 'done', 'Checkliste', '{}', 'ag_ida', 1);
  insert('task_j', 'task_p', 'open', 'Testgerät organisieren', '{}', 'ag_jonas', 2); // another owner: a piece, unchanged
  insert('task_q', null, 'open', 'Bericht');
  insert('task_q1', 'task_q', 'done', 'Daten holen', '{}', 'ag_ida', 0);
  insert('task_q2', 'task_q', 'open', 'Schreiben', '{}', 'ag_ida', 1);
  db.run(`INSERT INTO wakes (id, agent_id, reason, task_id, due_at, created_at) VALUES ('wk_1', 'ag_ida', 'task', 'task_s1', 1, 1)`);
  assert.equal(foldOwnSteps(db, NOW), 2);
  const row = (id: string) => db.get<{ status: string; next_at: number | null; ledger: string }>('SELECT status, next_at, ledger FROM tasks WHERE id = ?', [id])!;
  assert.deepEqual([row('task_s1').status, row('task_s1').next_at, row('task_s2').status, row('task_j').status, row('task_q2').status], ['dropped', null, 'done', 'open', 'dropped']);
  assert.deepEqual(JSON.parse(row('task_p').ledger).plan, ['✓ QR-Code qa/belege/handy-link.png', 'Mo 16.11.: Handy-Lauf'], 'a parent\'s own plan stays its record');
  assert.deepEqual(JSON.parse(row('task_q').ledger).plan, ['✓ Daten holen', 'Schreiben'], 'a parent without a plan gets its steps as the plan');
  assert.equal(db.get<{ n: number }>('SELECT count(*) AS n FROM wakes')!.n, 0);
  assert.equal(foldOwnSteps(db, NOW), 0, 'a second run changes nothing');
});
