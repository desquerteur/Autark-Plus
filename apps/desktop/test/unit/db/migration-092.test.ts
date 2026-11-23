// Migration 92 (runtime/db/migrations/092-split-parent-session.ts, B-080): split_groups gets parent_session – the session
// the parent's splitting turn ended with, as JSON; a group from before keeps NULL (no recorded session).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate, SCHEMA_VERSION } from '../../../src/runtime/db/migrate.ts';
import { SplitRepo } from '../../../src/runtime/store/splits.ts';

const columns = (db: Db) => db.all<{ name: string }>('PRAGMA table_info(split_groups)').map((row) => row.name);

test('migration 92 adds split_groups.parent_session; an older group reads without one, a new one round-trips it', () => {
  const db = new Db(':memory:');
  migrate(db, { until: 91 });
  assert.equal(columns(db).includes('parent_session'), false);
  db.run(`INSERT INTO agents (id, name, avatar, created_by, created_at, updated_at) VALUES ('ag_ava', 'Ava', '{}', 'human', 0, 0)`);
  db.run(`INSERT INTO split_groups (id, agent_id, parent_run_id, thread, goal, status, created_at) VALUES ('sgr_old', 'ag_ava', 'run_1', 'ch_1', 'Old', 'running', 1)`);
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 92);
  assert.equal(columns(db).includes('parent_session'), true);
  const repo = new SplitRepo(db);
  assert.equal(repo.getGroup('sgr_old')?.parentSession, undefined, 'a group from before has no recorded session');
  const parentSession = { engine: 'codex' as const, accountId: 'acc_1', ref: 'thr_parent', contextTokens: 50_000, turn: 'turn_7' };
  assert.deepEqual(repo.updateGroup('sgr_old', { parentSession })?.parentSession, parentSession);
  repo.saveGroup({ ...repo.getGroup('sgr_old')!, id: 'sgr_new' });
  assert.deepEqual(repo.getGroup('sgr_new')?.parentSession, parentSession, 'saveGroup writes it too');
  assert.equal(repo.updateGroup('sgr_new', { parentSession: undefined })?.parentSession, undefined, 'undefined clears it');
  assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION }, 'applied once');
});
