// Migrations 107 and 108 (KI-Runde 17.11.2026, package C): runs gets cache_write_tokens, engine_sessions gets the engine's
// running cost total with the ref it counts (cost_total, cost_ref). A row written before reads as before; a new run keeps its
// cache writes; a binding keeps its total over a save (also of another ref) until setCostTotal writes a new one.
// Owns: checks of these schema steps and the repositories' mapping. Never: turn behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate, SCHEMA_VERSION } from '../../../src/runtime/db/migrate.ts';
import { RunRepo } from '../../../src/runtime/store/runs.ts';
import { SessionStore } from '../../../src/runtime/agents/sessions.ts';

test('migrations 107 and 108 add the columns; rows from before read as before', () => {
  const db = new Db(':memory:');
  migrate(db, { until: 106 });
  db.run(`INSERT INTO runs (id, agent_id, trigger, status, input_tokens, output_tokens, cached_tokens) VALUES ('run_old', 'ag_tom', 'message', 'done', 1200, 80, 900)`);
  db.run(`INSERT INTO engine_sessions (agent_id, conversation_id, engine, session_ref, cursor_seq, generation, updated_at) VALUES ('ag_tom', 'main', 'claude', 's1', 0, 1, 1)`);
  const before = new RunRepo(db).get('run_old')!;
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 108);
  assert.deepEqual(new RunRepo(db).get('run_old'), before);
  assert.equal(new SessionStore(db).get('ag_tom', 'main', 'claude')?.costTotal, undefined);
  assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION }, 'applied once');
});

test('a run keeps its cache writes; a binding keeps its cost total and the ref it counts over later saves', () => {
  const db = new Db(':memory:');
  migrate(db);
  const runs = new RunRepo(db);
  runs.save({ id: 'run_1', agentId: 'ag_tom', trigger: 'message', status: 'done', inputTokens: 1_009_000, cachedTokens: 900_000, cacheWriteTokens: 100_000 });
  assert.equal(runs.get('run_1')?.cacheWriteTokens, 100_000);
  runs.save({ ...runs.get('run_1')!, status: 'done' });
  assert.equal(runs.get('run_1')?.cacheWriteTokens, 100_000, 'a later save of the read run keeps it');
  const store = new SessionStore(db);
  const binding = { agentId: 'ag_tom', conversationId: 'main', engine: 'claude' as const, ref: 's1', generation: 1, cursorSeq: 0, updatedAt: 1 };
  store.save(binding);
  store.setCostTotal('ag_tom', 'main', 'claude', { ref: 's2', usd: 4.5 });
  store.save({ ...binding, ref: 's2', updatedAt: 2 });
  assert.deepEqual(store.get('ag_tom', 'main', 'claude')?.costTotal, { ref: 's2', usd: 4.5 }, 'the save of the ref it counts keeps it');
  store.remove('ag_tom', 'main', 'claude');
  store.save({ ...binding, ref: 's3', updatedAt: 3 });
  assert.equal(store.get('ag_tom', 'main', 'claude')?.costTotal, undefined, 'a binding made anew has none');
});
