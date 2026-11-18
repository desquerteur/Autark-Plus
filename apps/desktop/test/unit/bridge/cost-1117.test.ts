// Bridge cost-1117 (KI-Runde 17.11.2026, package C): once per company the plan runs priced before it get their notional cost
// from their own tokens at today's prices – a Claude run that stored its session's running total and a Codex run that paid its
// cached input in full alike; a Claude plan run from before the cached count gets the difference to its session's previous
// run; a paid run's charge and a Codex run without a cached count stay; one log line counts the repaired runs; the figures
// and the mark are one transaction, so the repair runs once.
// Owns: these assertions only, on a temporary database built here. Never: a company's data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate } from '../../../src/runtime/db/migrate.ts';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { repriceRuns, runCost1117 } from '../../../src/runtime/bridge/cost-1117.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ModelInfo } from '../../../src/shared/model/providers.ts';
import { RESOURCES } from '../context/fixture.ts';

function company() {
  const db = new Db(':memory:');
  migrate(db);
  let at = 0;
  const run = (id: string, model: string, cols: { input: number; output: number; cached: number | null; basis: string; notional?: number; cost?: number; chat?: string }) => db.run(
    `INSERT INTO runs (id, agent_id, conversation_id, trigger, status, engine, model, started_at, input_tokens, output_tokens, cached_tokens, cost_basis, notional_usd, cost_usd)
     VALUES (?, 'ag_tom', ?, 'message', 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, cols.chat ?? 'chat_1', model.split(':')[0], model, ++at, cols.input, cols.output, cols.cached, cols.basis, cols.notional ?? null, cols.cost ?? null]);
  // Before migration 100 (no cached count): each Claude run stored its session's running total – 12.30, then 12.90, then a
  // new session at 0.70; another chat's session counts apart.
  run('run_old', 'claude:claude-opus-5-5', { input: 400_000, output: 900, cached: null, basis: 'plan', notional: 12.3 });
  run('run_old_2', 'claude:claude-opus-5-5', { input: 410_000, output: 700, cached: null, basis: 'plan', notional: 12.9 });
  run('run_other_chat', 'claude:claude-opus-5-5', { input: 10_000, output: 100, cached: null, basis: 'plan', notional: 13.5, chat: 'chat_2' });
  run('run_old_new_session', 'claude:claude-opus-5-5', { input: 50_000, output: 300, cached: null, basis: 'plan', notional: 0.7 });
  run('run_old_codex', 'codex:gpt-6.1-sol', { input: 50_000, output: 300, cached: null, basis: 'plan', notional: 0.4 });
  // Konrad's session as measured: the stored figure was the session's running total (41.83 after 68 turns).
  run('run_claude', 'claude:claude-opus-5-5', { input: 1_009_000, output: 10_000, cached: 900_000, basis: 'plan', notional: 41.83 });
  // GPT-6.1 Sol on the feed price: 232.03M × $2 + output, the cached part at the full price.
  run('run_sol', 'codex:gpt-6.1-sol', { input: 1_000_000, output: 10_000, cached: 970_000, basis: 'plan', notional: 2.1 });
  run('run_paid', 'claude:claude-opus-5-5', { input: 1_009_000, output: 10_000, cached: 900_000, basis: 'provider', cost: 7.5 });
  const sol = { id: 'codex:gpt-6.1-sol', model: 'gpt-6.1-sol', price: { source: 'feed', inputPerM: 2, outputPerM: 10 } } as unknown as ModelInfo;
  const logs: Array<{ message: string; data?: unknown }> = [];
  const services = {
    db, catalog: { get: (id: string) => (id === sol.id ? sol : undefined) }, clock: { now: () => 1_000 },
    paths: { resources: RESOURCES }, log: { info: (message: string, data?: unknown) => logs.push({ message, data }), warn: (message: string, data?: unknown) => logs.push({ message, data }) },
  } as unknown as RuntimeServices;
  const notional = (id: string) => db.get<{ notional_usd: number | null; cost_usd: number | null; cost_basis: string }>('SELECT notional_usd, cost_usd, cost_basis FROM runs WHERE id = ?', [id]);
  return { db, services, logs, notional };
}

test('the plan runs priced before get their notional cost from their own tokens, once, with one log line', () => {
  const c = company();
  runCost1117(c.services);
  // Uncached input at the write price: 109k × 8 + 900k × 0.2 + 10k × 20 = 0.872 + 0.18 + 0.2.
  assert.equal(c.notional('run_claude')?.notional_usd, 1.252, 'the old code kept 41.83');
  assert.equal(c.notional('run_sol')?.notional_usd, 0.354, '30k × 2 + 970k × 0.2 + 10k × 10');
  assert.deepEqual({ ...c.notional('run_paid') }, { notional_usd: null, cost_usd: 7.5, cost_basis: 'provider' }, 'a paid run\'s charge stays');
  assert.equal(c.notional('run_old')?.notional_usd, 12.3, 'the first run of a session: its total is its own');
  assert.equal(c.notional('run_old_2')?.notional_usd, 0.6, "the difference to the session's previous total (the old code kept 12.90)");
  assert.equal(c.notional('run_other_chat')?.notional_usd, 13.5, "another chat's session counts apart");
  assert.equal(c.notional('run_old_new_session')?.notional_usd, 0.7, 'a total below the previous one starts a new count');
  assert.equal(c.notional('run_old_codex')?.notional_usd, 0.4, 'a Codex run without its cached count stays');
  assert.equal(c.logs.length, 1);
  assert.deepEqual(c.logs[0].data, { runs: 3 });
  c.db.run(`UPDATE runs SET notional_usd = 99 WHERE id = 'run_claude'`);
  runCost1117(c.services);
  assert.equal(c.notional('run_claude')?.notional_usd, 99, 'the kv mark: it runs once per company');
  assert.equal(c.logs.length, 1);
});

test('the figures priced from tokens are the same when priced twice', () => {
  const c = company();
  const priors = Priors.load(path.join(RESOURCES, 'model-priors.json'));
  assert.equal(repriceRuns(c.services, priors), 3);
  const priced = () => c.db.all(`SELECT id, notional_usd, cost_usd FROM runs WHERE cached_tokens IS NOT NULL ORDER BY id`);
  const first = priced();
  repriceRuns(c.services, priors);
  assert.deepEqual(priced(), first);
});

test('the figures and the mark are one transaction: a mark that cannot be written leaves every figure as it was', () => {
  const c = company();
  const before = c.db.all('SELECT id, notional_usd, cost_usd FROM runs ORDER BY id');
  const run = c.db.run.bind(c.db);
  c.db.run = ((sql: string, params?: unknown[]) => {
    if (sql.includes('INSERT INTO kv')) throw new Error('disk full');
    return run(sql, params as never);
  }) as typeof c.db.run;
  runCost1117(c.services);
  c.db.run = run;
  assert.deepEqual(c.db.all('SELECT id, notional_usd, cost_usd FROM runs ORDER BY id'), before, 'the old code kept the repaired figures without the mark, and a second start subtracted again');
  assert.match(c.logs[0].message, /failed/);
  runCost1117(c.services);
  assert.equal(c.notional('run_old_2')?.notional_usd, 0.6, 'the next start repairs from the old figures');
});

test('a Codex model the catalog no longer holds is priced from the stored price list (review 2, 17.11.2026)', () => {
  const c = company();
  c.db.run(`INSERT INTO runs (id, agent_id, conversation_id, trigger, status, engine, model, started_at, input_tokens, output_tokens, cached_tokens, cost_basis, notional_usd)
    VALUES ('run_luna', 'ag_tom', 'chat_1', 'message', 'done', 'codex', 'codex:gpt-6-luna', 99, 100000, 1000, 90000, 'plan', 0.0245)`);
  // the daily OpenRouter list as price-feed.ts stores it; on the code before, gpt-6-luna kept its figure (cached input in full)
  new KvRepo(c.db).set('prices', 'openrouter', { at: 1, prices: { 'gpt-6-luna': [0.25, 2] } }, 1);
  assert.equal(repriceRuns(c.services, Priors.load(path.join(RESOURCES, 'model-priors.json'))), 4);
  assert.equal(c.notional('run_luna')?.notional_usd, 0.00675, '10k × 0.25 + 90k × 0.025 + 1k × 2');
});
