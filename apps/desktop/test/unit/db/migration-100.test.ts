// Migration 100 (runtime/db/migrations/100-run-usage.ts, B-089 11.11.2026): runs gets cached_tokens and model_calls on a
// database of the previous version; a row written before reads as before (both absent), a new one keeps both.
// Owns: checks of this schema step and the repository's mapping. Never: turn behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate, SCHEMA_VERSION } from '../../../src/runtime/db/migrate.ts';
import { RunRepo } from '../../../src/runtime/store/runs.ts';

test('migration 100 adds cached_tokens and model_calls; an old row reads as before', () => {
  const db = new Db(':memory:');
  migrate(db, { until: 99 });
  db.run(`INSERT INTO runs (id, agent_id, trigger, status, input_tokens, output_tokens, route) VALUES ('run_old', 'ag_tom', 'message', 'done', 1200, 80, '{"reason":"test","by":"rules","category":"chat"}')`);
  const before = new RunRepo(db).get('run_old')!;
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 100);
  const columns = db.all<{ name: string }>(`PRAGMA table_info(runs)`).map((column) => column.name);
  assert.ok(columns.includes('cached_tokens') && columns.includes('model_calls'));
  const repo = new RunRepo(db);
  const old = repo.get('run_old')!;
  assert.deepEqual(old, before, 'the old row reads exactly as before');
  assert.equal(old.cachedTokens, undefined);
  assert.equal(old.modelCalls, undefined);
  assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION }, 'applied once');
});

test('a run saved with cached tokens and model calls keeps both, also over a later save of the read run', () => {
  const db = new Db(':memory:');
  migrate(db);
  const repo = new RunRepo(db);
  repo.save({ id: 'run_1', agentId: 'ag_tom', trigger: 'message', status: 'running' });
  assert.equal(repo.get('run_1')!.cachedTokens, undefined);
  const done = { ...repo.get('run_1')!, status: 'done' as const, inputTokens: 12_400, cachedTokens: 9_800, outputTokens: 640, modelCalls: 7,
    route: { reason: 'test', by: 'rules', category: 'chat', effortBy: 'agent' as const } };
  repo.save(done);
  const read = repo.get('run_1')!;
  assert.deepEqual([read.inputTokens, read.cachedTokens, read.outputTokens, read.modelCalls], [12_400, 9_800, 640, 7]);
  assert.equal(read.route?.effortBy, 'agent');
  repo.save(read); // the journal's finish saves the merged run: the values stay
  assert.equal(repo.get('run_1')!.modelCalls, 7);
});
