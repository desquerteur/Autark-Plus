// Owner 14.11.2026 ("Warum Fabel Fünf. Eins ist richtig schlecht / 5.2"): the newest version of a model family stands for the
// older ones that can run now (routing/pool.ts newestOnly, entryFor). The router and the subconscious see only the newest; a
// model I name in an older version runs as the newest; a start model the person pinned to the older version still runs it.
// Owns: these assertions only. Never: real engines, accounts or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, agent, mode, setup } from '../models/harness.ts';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { selectCandidates } from '../../../src/runtime/accounts/candidates.ts';
import { buildPool, newestOnly } from '../../../src/runtime/routing/pool.ts';
import { effectivePolicy } from '../../../src/runtime/routing/policies.ts';
import { offeredModels } from '../../../src/runtime/subconscious/route-turn.ts';
import type { Effort, EngineId, ModelInfo } from '../../../src/shared/model/providers.ts';

const F51 = 'claude:claude-fable-5-1';
const F52 = 'claude:claude-fable-5-2';
const HAIKU = 'claude:claude-haiku-5-5';
const OPUS = 'claude:claude-opus-5-5';
const ALL: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const caps = { vision: true, tools: true, structuredOutput: true };
const PRIORS = Priors.parse({
  version: 'test-newest', categories: {},
  models: [
    { match: 'claude-opus-5-5*', name: 'Claude Opus 5.5', tier: 'frontier', relCost: 0.6, caps, efforts: ALL, strengths: { chat: 0.4, writing: 0.5 } },
    { match: 'claude-fable-5-1*', name: 'Claude Fable 5.1', tier: 'frontier', relCost: 0.5, caps, efforts: ALL, strengths: { chat: 0.5, writing: 0.9 } },
    { match: 'claude-haiku-5-5*', name: 'Claude Haiku 5.5', tier: 'small', relCost: 0.03, caps, efforts: ['low', 'medium', 'high'], strengths: { chat: 0.4 } },
  ],
});

async function world(claude = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-fable-5-2', 'claude-haiku-5-5']) {
  const h = setup({ priors: PRIORS });
  h.accounts.upsert(account('acc_claude', 'claude'), false);
  h.accounts.candidates = (engine: EngineId, model?: string) => selectCandidates(h.accounts.accounts, engine, h.clock.now(), model);
  h.engine('claude').lists.set('claude', claude.map((model) => ({ model, name: model, efforts: ALL })));
  await h.catalog.refresh({ force: true });
  h.addChat('ch_1', ['ag_1']);
  const pool = (exclude: string[] = []) => buildPool({
    s: h.services, models: h.catalog.list(), category: 'writing', policy: effectivePolicy(h.services, agent('ag_1')), exclude: new Set(exclude),
  });
  return { ...h, pool };
}

const ids = (entries: Array<{ model: ModelInfo }>) => entries.map((entry) => entry.model.id).sort();

test('the pool keeps only the newest Fable while it can run; with 5.2 out 5.1 stays; other families are untouched', async () => {
  const w = await world();
  const pool = w.pool();
  assert.deepEqual(ids(pool.entries), [F52, HAIKU, OPUS].sort(), 'Fable 5.1 leaves, Haiku is no older Opus');
  assert.equal(pool.entryFor(w.catalog.get(F51)!)?.model.id, F52, 'a named 5.1 runs as 5.2');
  assert.equal(pool.unusable(w.catalog.get(F51)!), undefined, 'a pin of 5.1 still runs (unusable is unchanged)');
  const without = w.pool([F52]);
  assert.deepEqual(ids(without.entries), [F51, HAIKU, OPUS].sort(), 'the newest cannot run now: the older one stays');
  assert.equal(without.entryFor(w.catalog.get(F51)!)?.model.id, F51);
});

test('newestOnly compares versions inside a family only, dates and providers aside', () => {
  const m = (id: string) => ({ model: { id, model: id.slice(id.indexOf(':') + 1) } as ModelInfo });
  const kept = newestOnly([m('claude:claude-fable-5'), m('claude:claude-fable-5-1'), m('gw:anthropic/claude-fable-5.2'), m('claude:claude-sonnet-4-5-20250929'), m('codex:gpt-6.1-sol'), m('codex:gpt-6-luna')]);
  assert.deepEqual(kept.map((entry) => entry.model.id), ['gw:anthropic/claude-fable-5.2', 'claude:claude-sonnet-4-5-20250929', 'codex:gpt-6.1-sol', 'codex:gpt-6-luna']);
});

test('subconscious: my last turn on Fable 5.1 offers 5.2 in its place, never 5.1', async () => {
  const w = await world();
  Object.assign(w.services, { runs: { list: () => [{ model: F51, status: 'done' }] } });
  const { offers } = offeredModels(w.services, agent('ag_1'), { text: 'Schreib den Text für die Startseite.' });
  const offered = offers.map((offer) => offer.model.id);
  assert.ok(offered.includes(F52), offered.join(', '));
  assert.ok(!offered.includes(F51), offered.join(', '));
});

test('router: the agent naming Fable 5.1 runs on 5.2; the start model the person pinned to 5.1 still runs 5.1', async () => {
  const w = await world();
  const route = (patch: object) => w.router.route({ agent: agent('ag_1'), mode: mode('writing'), conversationId: 'ch_1', ...patch });
  const asked = await route({ previous: { modelId: F51, effort: 'high', explicit: true, asked: 'model' } });
  assert.equal(asked.modelId, F52, asked.reason);
  const pinned = await route({ agent: agent('ag_1', { modelPolicy: { pin: F51 } }) });
  assert.equal(pinned.modelId, F51, pinned.reason);
  const rules = await route({});
  assert.notEqual(rules.modelId, F51, rules.reason);
});
