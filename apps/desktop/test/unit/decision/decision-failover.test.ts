// B-089 (11.11.2026): a decision whose chosen way fails because of its account or model goes once to the next usable
// way; the chosen one is skipped without a call while it cools; both failing is today's "no answer". Live 07.11.: a 402
// on one Vercel connection went over to a second connection with the same key and got 402 again – the same key at the
// same address is one account at the provider. Live 09.–10.11.: the 90 s default cut reviews that had 120 s.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { account, setup } from '../models/harness.ts';
import { tempDir } from '../store/helpers.ts';
import { callLimitMs, createEngineRunner } from '../../../src/runtime/decision/engine-runner.ts';
import { DecisionHub } from '../../../src/runtime/decision/service.ts';
import { LlmDecisionBackend } from '../../../src/runtime/decision/llm-fallback.ts';
import type { DecisionBackend } from '../../../src/runtime/decision/types.ts';
import type { EngineRegistry, RouteRequest, Router } from '../../../src/runtime/contracts.ts';
import type { EngineModel, EngineTurnInput, EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import type { RouteDecision } from '../../../src/shared/model/providers.ts';

const HAIKU: EngineModel = { model: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', efforts: ['low', 'medium', 'high'] };
const LUNA: EngineModel = { model: 'gpt-6-luna', name: 'GPT-6 Luna', efforts: ['low', 'medium', 'high'] };
const TEMP = tempDir('wf-decision-failover-');
after(() => TEMP.cleanup());

const NO_CREDIT: EngineTurnResult = { text: '', stop: 'limit', error: { code: 'rate_limited', message: 'The credit of this key is used up (HTTP 402).' } };
const ANSWER: EngineTurnResult = { text: '{"choice":"yes","confidence":0.9}', stop: 'done', structured: { choice: 'yes', confidence: 0.9 } };
const lines = () => { const info: Array<{ message: string; data?: Record<string, unknown> }> = []; return { info, log: { debug() {}, warn() {}, error() {}, info(message: string, data?: Record<string, unknown>) { info.push({ message, data }); } } }; };

/** Three API-key connections (two with one key at one address) and a router that takes the first one not excluded. */
function keyWorld(script: (input: EngineTurnInput) => EngineTurnResult) {
  const h = setup();
  const url = 'https://gateway.example/v1';
  h.accounts.upsert(account('vercel-gemini', 'compatible', { baseUrl: url, secretId: 'secret://k1' }), false);
  h.accounts.upsert(account('vercel-free', 'compatible', { baseUrl: url, secretId: 'secret://k1' }), false);
  h.accounts.upsert(account('other-key', 'compatible', { baseUrl: url, secretId: 'secret://k2' }), false);
  const order = ['vercel-gemini', 'vercel-free', 'other-key'];
  const routes: RouteRequest[] = [];
  const router = { route: async (request: RouteRequest): Promise<RouteDecision> => {
    routes.push(request);
    const id = order.find((one) => !request.exclude?.includes(one) && h.accounts.get(one)?.state === 'ok');
    if (!id) throw new Error('Every account that can run a suitable model is limited right now.');
    return { modelId: `${id}:m`, engine: 'compatible', accountId: id, effort: 'low', category: 'cheap-chat', reason: '', by: 'rules', alternatives: [] } as RouteDecision;
  } } as unknown as Router;
  const runs: EngineTurnInput[] = [];
  const engines = { get: () => ({ run: async (input: EngineTurnInput) => { runs.push(input); return script(input); } }) } as unknown as EngineRegistry;
  const catalog = { get: (id: string) => ({ id, model: 'm', efforts: ['low', 'medium'] }) } as never;
  const { info, log } = lines();
  const runner = createEngineRunner({ engines, router, accounts: h.accounts, catalog, paths: { temp: TEMP.dir }, clock: h.clock, log });
  return { h, runner, runs, routes, info };
}

test('chosen connection answers 402: the question goes once to a way with another key, every connection of that key cools, the log names who answered', async () => {
  const w = keyWorld((input) => (input.account.id === 'other-key' ? ANSWER : NO_CREDIT));
  const out = await w.runner({ purpose: 'decision', system: 'D', prompt: 'P', schema: { type: 'object' } });
  assert.deepEqual(w.runs.map((run) => run.account.id), ['vercel-gemini', 'other-key'], 'not the twin with the same key');
  assert.equal(out.by, 'other-key:m');
  assert.deepEqual(w.routes[1].exclude, ['vercel-gemini', 'vercel-free']);
  assert.equal(w.h.accounts.get('vercel-gemini')?.state, 'cooling');
  assert.equal(w.h.accounts.get('vercel-free')?.state, 'cooling', 'the same account at the provider');
  assert.equal(w.h.accounts.get('other-key')?.state, 'ok');
  assert.deepEqual(w.info.map((line) => [line.message, line.data?.by, line.data?.failed]), [['helper call answered by another way', 'other-key:m', 'vercel-gemini:m (limit)']]);
});

test('both ways fail: the last failure, with the way it came from, reaches the caller and the hub has no answer, as before', async () => {
  const w = keyWorld(() => NO_CREDIT);
  await assert.rejects(w.runner({ purpose: 'decision', system: 'D', prompt: 'P' }), /HTTP 402\)\. \(other-key:m\)$/);
  assert.equal(w.runs.length, 2, 'one failover, no third call');
  assert.equal(w.info.length, 0);

  const again = keyWorld(() => NO_CREDIT);
  const hub = new DecisionHub({ backends: [new LlmDecisionBackend(again.runner)] });
  const result = await hub.decide({ purpose: 'other', type: 'choice', question: 'Q?', options: ['yes', 'no'] });
  assert.deepEqual([result.confidence, result.by, result.outcome], [0, 'none', 'unsure']);
});

test('the chosen decision model cools: it is skipped without a call, and it is the first try again once it is usable', async () => {
  const h = setup();
  h.accounts.upsert(account('acc_claude', 'claude'), false);
  h.accounts.upsert(account('acc_codex', 'codex'), false);
  h.engine('claude').lists.set('claude', [HAIKU]);
  h.engine('codex').lists.set('codex', [LUNA]);
  await h.catalog.refresh({ force: true });
  h.settings.update({ routing: { decision: 'claude:claude-haiku-5-5' } } as never);
  const runs: EngineTurnInput[] = [];
  const engines = { get: () => ({ run: async (input: EngineTurnInput) => { runs.push(input); return ANSWER; } }) } as unknown as EngineRegistry;
  const runner = createEngineRunner({ engines, router: h.router, accounts: h.accounts, catalog: h.catalog, paths: { temp: TEMP.dir }, clock: h.clock });

  await runner({ purpose: 'decision', system: 'D', prompt: 'P', schema: { type: 'object' } });
  assert.equal(runs.at(-1)?.account.id, 'acc_claude', 'the person\'s choice first');

  h.accounts.markLimited('acc_claude', h.clock.now() + 60 * 60_000);
  await runner({ purpose: 'decision', system: 'D', prompt: 'P', schema: { type: 'object' } });
  assert.deepEqual(runs.slice(1).map((run) => run.account.id), ['acc_codex'], 'no call on the cooling account');

  h.clock.advance(61 * 60_000);
  await runner({ purpose: 'decision', system: 'D', prompt: 'P', schema: { type: 'object' } });
  assert.equal(runs.at(-1)?.account.id, 'acc_claude', 'usable again: first try again');
});

test('a failed backend in the hub: the next one answers and the log says which', async () => {
  const { info, log } = lines();
  const broken: DecisionBackend = { id: 'systemone', available: () => true, decide: async () => { throw new Error('HTTP 402'); } };
  const cooling: DecisionBackend = { id: 'resting', available: () => false, decide: async () => { throw new Error('called'); } };
  const answering: DecisionBackend = { id: 'llm', available: () => true, decide: async () => ({ choice: 'yes', confidence: 0.9, by: 'llm:codex:gpt-6-luna' }) };
  const hub = new DecisionHub({ backends: [cooling, broken, answering], log: { ...log, warn() {} } as never });
  const result = await hub.decide({ purpose: 'other', type: 'choice', question: 'Q?', options: ['yes', 'no'] });
  assert.equal(result.choice, 'yes');
  assert.deepEqual(info.map((line) => [line.message, line.data?.failed, line.data?.by]), [['decision answered by another way', ['systemone'], 'llm:codex:gpt-6-luna']]);
});

test("a caller's deadline is the call's time limit; the 90 s default only without one; an explicit limit still caps", () => {
  assert.equal(callLimitMs({}, undefined), 90_000);
  assert.equal(callLimitMs({}, 120_000), 120_000, 'a 120 s tool-timeout review keeps its 120 s');
  assert.equal(callLimitMs({}, 5_000), 5_000);
  assert.equal(callLimitMs({ timeoutMs: 30_000 }, 120_000), 30_000);
  assert.equal(callLimitMs({ timeoutMs: 30_000 }, undefined), 30_000);
  assert.equal(callLimitMs({}, 0), 90_000);
});
