// B-089 (11.11.2026: what a run costs, written down): a finished turn stores its cached input (summed over its attempts)
// and its model calls on the run, and its route says where the effort came from (effortBy); after a failover the count
// stays out. An attempt counts model calls only on an engine whose usage events come one per request (Codex).
// Owns: these assertions only. Never: real engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishTurn } from '../../../src/runtime/agents/turn-finish.ts';
import { planTurn } from '../../../src/runtime/agents/turn-prepare.ts';
import { runAttempt } from '../../../src/runtime/agents/turn-attempt.ts';
import { GENERAL_MODE } from '../../../src/runtime/modes/service.ts';
import type { Engine } from '../../../src/runtime/engines/types.ts';
import type { TurnPlan } from '../../../src/runtime/agents/turn-types.ts';
import type { Run } from '../../../src/shared/model/runs.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { setup } from './fixture.ts';

function rig() {
  const h = setup();
  const finished: Array<Partial<Run>> = [];
  Object.assign(h.services.runs, { finish: (_runId: string, patch: Partial<Run>) => { finished.push(patch); }, items: () => [], updateItem: () => {} });
  h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, body: 'Sum up the week' });
  return { ...h, finished };
}

test('a finished turn stores cached tokens and model calls, and its route carries effortBy', async () => {
  const h = rig();
  const request = h.request();
  const plan = (await planTurn(h.services, request))!;
  const turn = { ...h.routed(), route: { ...h.route, effortBy: 'agent' as const } };
  finishTurn(h.services, plan, turn, request, h.attempt({ text: 'Done.', stop: 'done' }, {
    usage: { inputTokens: 12_400, outputTokens: 640, cacheReadTokens: 9_000, cacheWriteTokens: 1_000 }, modelCalls: 7,
  }), undefined);
  const run = h.finished.at(-1)!;
  assert.deepEqual([run.inputTokens, run.cachedTokens, run.outputTokens, run.modelCalls], [12_400, 9_000, 640, 7], 'a cache write is input sent in full');
  assert.equal(run.route?.effortBy, 'agent');
});

test('no cache report and no count stay absent; after a failover the count stays out, the cached input sums both', async () => {
  const h = rig();
  const request = h.request();
  const plan = (await planTurn(h.services, request))!;
  finishTurn(h.services, plan, h.routed(), request, h.attempt({ text: 'Done.', stop: 'done' }, { usage: { inputTokens: 500, outputTokens: 20 } }), undefined);
  const plain = h.finished.at(-1)!;
  assert.equal('cachedTokens' in plain, false);
  assert.equal('modelCalls' in plain, false);
  assert.equal(plain.route?.effortBy, undefined, 'a route without an origin stores none');
  finishTurn(h.services, plan, h.routed(), request, h.attempt({ text: 'Done.', stop: 'done' }, {
    usage: { inputTokens: 3_000, outputTokens: 90, cachedInputTokens: 2_000 }, lastUsage: { inputTokens: 1_000, outputTokens: 40, cachedInputTokens: 800 }, modelCalls: 2,
  }), undefined);
  const merged = h.finished.at(-1)!;
  assert.equal(merged.cachedTokens, 2_000);
  assert.equal(merged.modelCalls, undefined, 'the final attempt alone is no count of the run');
});

test('an attempt counts model calls from per-request usage (Codex) and none from running totals (Claude)', async () => {
  const h = rig();
  const plan = { agent: h.tom, mode: GENERAL_MODE, conversationId: h.chat.id, thread: 'main', memberCursor: 0, focus: '' } as unknown as TurnPlan;
  h.state.script = async (input) => {
    input.onEvent({ type: 'usage', inputTokens: 1_000, outputTokens: 10, cachedInputTokens: 600 });
    input.onEvent({ type: 'usage', inputTokens: 1_100, outputTokens: 20, cachedInputTokens: 900 });
    input.onEvent({ type: 'usage', inputTokens: 1_200, outputTokens: 30 });
    return { text: 'Done.', stop: 'done', usage: { inputTokens: 3_300, outputTokens: 60, cachedInputTokens: 1_500 } };
  };
  const codex = { ...h.routed(), engine: { ...h.engine, id: 'codex' } as Engine };
  const counted = await runAttempt(h.services, plan, codex, h.request(), undefined);
  assert.equal(counted.modelCalls, 3);
  assert.equal(counted.usage.cachedInputTokens, 1_500);
  const claude = await runAttempt(h.services, plan, h.routed(), h.request(), undefined);
  assert.equal(claude.modelCalls, undefined, 'Claude reports running totals: no count');
});
