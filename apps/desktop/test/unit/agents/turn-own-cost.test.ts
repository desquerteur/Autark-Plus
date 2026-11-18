// Package C (KI-Runde 17.11.2026, cost is the turn's own): Claude Code reports the session's running total (total_cost_usd,
// restored on every --resume), so an attempt costs the difference to the total kept on the session binding; a total below
// the kept one, a new session or a session the attempt did not resume starts a new count. The engine's own model-call count
// (Claude Code's main-thread message_start) reaches the attempt; the run keeps the turn's cache writes.
// Owns: these assertions only. Never: real engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAttempt } from '../../../src/runtime/agents/turn-attempt.ts';
import { finishTurn } from '../../../src/runtime/agents/turn-finish.ts';
import { planTurn } from '../../../src/runtime/agents/turn-prepare.ts';
import { runTokens, turnOwnCost } from '../../../src/runtime/agents/turn-cost.ts';
import { SessionStore } from '../../../src/runtime/agents/sessions.ts';
import { GENERAL_MODE } from '../../../src/runtime/modes/service.ts';
import type { Engine, EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import type { RoutedTurn, TurnPlan } from '../../../src/runtime/agents/turn-types.ts';
import type { Run } from '../../../src/shared/model/runs.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { setup } from './fixture.ts';

test('turnOwnCost: the difference to the kept total; none kept or a lower total starts a new count', () => {
  assert.equal(turnOwnCost(41.83, 40.67), 1.16);
  assert.equal(turnOwnCost(6.53, undefined), 6.53);
  assert.equal(turnOwnCost(0.4, 2), 0.4, 'the engine counts anew');
  assert.equal(turnOwnCost(2, 2), 0);
});

function rig() {
  const h = setup({ sessions: true });
  const plan = { agent: h.tom, mode: GENERAL_MODE, conversationId: h.chat.id, thread: 'main', memberCursor: 0, focus: '' } as unknown as TurnPlan;
  const store = new SessionStore(h.services.db);
  /** One attempt that resumes `resumes` (none: a fresh session) and reports `total` on the session `endsOn`. */
  const turn = async (resumes: string | undefined, endsOn: string, total: number, engine: Engine = h.engine) => {
    h.state.script = async (input) => {
      if (!resumes) input.onEvent({ type: 'session', ref: endsOn, generation: 1 }); // the engine binds a fresh session at once
      input.onEvent({ type: 'usage', inputTokens: 900, outputTokens: 20, costUsd: total, modelCalls: 1 });
      input.onEvent({ type: 'usage', inputTokens: 1_000, outputTokens: 30, costUsd: total, modelCalls: 2 });
      return { text: 'Done.', stop: 'done', session: { ref: endsOn, generation: 1 }, usage: { inputTokens: 1_000, outputTokens: 30, costUsd: total, cacheReadTokens: 700, cacheWriteTokens: 250 } } satisfies EngineTurnResult;
    };
    const routed: RoutedTurn = { ...h.routed(), engine, ...(resumes ? { session: store.get(h.tom.id, 'main', engine.id) } : {}) };
    return runAttempt(h.services, plan, routed, h.request(), undefined);
  };
  return { ...h, plan, store, turn };
}

test('a Claude attempt costs the difference to the session\'s kept total and keeps the new one', async () => {
  const h = rig();
  const first = await h.turn(undefined, 'sess_1', 1.5);
  assert.equal(first.usage.costUsd, 1.5, 'a fresh session: its whole total is this turn\'s');
  assert.deepEqual(h.store.get(h.tom.id, 'main', 'claude')?.costTotal, { ref: 'sess_1', usd: 1.5 });
  const second = await h.turn('sess_1', 'sess_1', 2.25);
  assert.equal(second.usage.costUsd, 0.75, 'a resumed session: only what this turn added (the old code stored 2.25)');
  assert.equal(second.modelCalls, 2, 'the engine\'s own count of its model calls');
  const lower = await h.turn('sess_1', 'sess_1', 0.4);
  assert.equal(lower.usage.costUsd, 0.4, 'a total below the kept one starts a new count');
  assert.deepEqual(h.store.get(h.tom.id, 'main', 'claude')?.costTotal, { ref: 'sess_1', usd: 0.4 });
});

test('a new session ref starts a new count; a save of the binding keeps the total; another engine keeps what it reported', async () => {
  const h = rig();
  await h.turn(undefined, 'sess_1', 3);
  const moved = await h.turn('sess_1', 'sess_2', 5);
  assert.equal(moved.usage.costUsd, 5, 'the attempt ended on another session: that session\'s total is new');
  const binding = h.store.get(h.tom.id, 'main', 'claude')!;
  h.store.save({ ...binding, ref: 'sess_2', updatedAt: 2 }); // the finish binds the session the attempt ended on
  assert.deepEqual(h.store.get(h.tom.id, 'main', 'claude')?.costTotal, { ref: 'sess_2', usd: 5 });
  const next = await h.turn('sess_2', 'sess_2', 5.5);
  assert.equal(next.usage.costUsd, 0.5);
  h.store.save({ ...h.store.get(h.tom.id, 'main', 'claude')!, ref: 'sess_3', updatedAt: 3 }); // a rebuild binds a new ref
  const rebuilt = await h.turn('sess_3', 'sess_3', 0.9);
  assert.equal(rebuilt.usage.costUsd, 0.9, 'the kept total counts only for the ref it names');
  const codex = await h.turn(undefined, 'thr_1', 2, { ...h.engine, id: 'codex' } as Engine);
  assert.equal(codex.usage.costUsd, 2, 'an engine whose reported cost is no running total keeps it');
});

test('an attempt that throws after its cost streamed counts against the session it resumed, not as the whole total', async () => {
  const h = rig();
  await h.turn(undefined, 'sess_1', 10);
  h.state.script = async (input) => {
    input.onEvent({ type: 'usage', inputTokens: 900, outputTokens: 20, costUsd: 10.6, modelCalls: 1 });
    throw new Error('the engine process ended unexpectedly');
  };
  const failed = await runAttempt(h.services, h.plan, { ...h.routed(), session: h.store.get(h.tom.id, 'main', 'claude') }, h.request(), undefined);
  assert.equal(failed.result.stop, 'error');
  assert.equal(Math.round(failed.usage.costUsd! * 100) / 100, 0.6, 'the old code booked 10.60');
  assert.deepEqual(h.store.get(h.tom.id, 'main', 'claude')?.costTotal, { ref: 'sess_1', usd: 10.6 }, 'the next turn counts from here');
});

test('a session bound only at the finish (a resumed rebuilt transcript, no row yet) keeps its total for the next turn', async () => {
  // Measured 18.11.2026 on a real Claude session: a new agent's first turn resumed a rebuilt transcript, announced no fresh
  // session, and its total ($0.70) was kept nowhere; the next turn on that session – a fold cut before its first request –
  // stored the whole $0.70 again as its own.
  const h = rig();
  const ref = 'C:/data/engine-transcripts/claude/rebuilt.jsonl';
  const reported = (total: number): EngineTurnResult => ({ text: 'Done.', stop: 'done', session: { ref, generation: 1 }, usage: { inputTokens: 1_000, outputTokens: 30, costUsd: total } });
  h.state.script = async () => reported(0.7);
  const routed: RoutedTurn = { ...h.routed(), session: { ref, generation: 1 } as RoutedTurn['session'] };
  assert.equal(h.store.get(h.tom.id, 'main', 'claude'), undefined, 'no binding before the finish');
  const first = await runAttempt(h.services, h.plan, routed, h.request(), undefined);
  assert.equal(first.usage.costUsd, 0.7);
  finishTurn(h.services, h.plan, routed, h.request(), first, undefined);
  assert.deepEqual(h.store.get(h.tom.id, 'main', 'claude')?.costTotal, { ref, usd: 0.7 }, 'the finish keeps the total with the binding it saves');
  h.state.script = async () => reported(0.7);
  const cut = await h.turn(ref, ref, 0.7);
  assert.equal(cut.usage.costUsd, 0, 'a turn that added nothing costs nothing (the old code stored 0.70 again)');
});

test('the run keeps the turn\'s cache writes beside its cached reads', async () => {
  assert.deepEqual(runTokens({ usage: { inputTokens: 1_000, outputTokens: 5, cacheReadTokens: 700, cacheWriteTokens: 250 } }), { cachedTokens: 700, cacheWriteTokens: 250 });
  assert.deepEqual(runTokens({ usage: { inputTokens: 1_000, outputTokens: 5, cachedInputTokens: 600 } }), { cachedTokens: 600 }, 'no write reported: none stored');
  const h = setup();
  const finished: Array<Partial<Run>> = [];
  Object.assign(h.services.runs, { finish: (_runId: string, patch: Partial<Run>) => { finished.push(patch); }, items: () => [], updateItem: () => {} });
  h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, body: 'Sum up the week' });
  const request = h.request();
  const plan = (await planTurn(h.services, request))!;
  finishTurn(h.services, plan, h.routed(), request, h.attempt({ text: 'Done.', stop: 'done' }, {
    usage: { inputTokens: 12_400, outputTokens: 640, cacheReadTokens: 9_000, cacheWriteTokens: 3_000 },
  }), undefined);
  assert.equal(finished.at(-1)?.cacheWriteTokens, 3_000);
});
