// B-083 (Ultra as one being) – the dispatcher's side of a part's lane: continueNow with the lane's run switches the part's
// model inside its turn when that model runs on the turn's engine and account (no cut, no wake – a part has no chat to
// continue in), and answers false at once otherwise; a later refusal of the engine is told to the part. tell() folds a
// note into the running turn of any lane (main or part) – journaled {told}; a turn whose engine is not bound yet is tried
// again while it runs and handed to `onLost` when that turn ends without it; no such turn, or an engine that never
// steers: 'held'.
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import type { Engine } from '../../../src/runtime/engines/types.ts';
import type { SplitService } from '../../../src/runtime/contracts.ts';
import type { SplitTurn } from '../../../src/shared/model/splits.ts';
import { setNextRoute, takeNextRoute } from '../../../src/runtime/agents/next-route.ts';
import { flush, openWakes, setup } from './fakes.ts';

const TURN: SplitTurn = { splitId: 'sp_1', groupId: 'sg_1', idx: 1, of: 2, title: 'Part one', parentRunId: 'run_old', parentThread: 'ch_x', context: 'brief', firstTurn: true };
const MODELS: Record<string, { id: string; model: string; name: string; engine: string; accounts: string[] }> = {
  'claude:claude-opus-5-5': { id: 'claude:claude-opus-5-5', model: 'claude-opus-5-5', name: 'Claude Opus 5.5', engine: 'claude', accounts: ['acc_a'] },
  'claude:claude-sonnet-5': { id: 'claude:claude-sonnet-5', model: 'claude-sonnet-5', name: 'Claude Sonnet 5', engine: 'claude', accounts: ['acc_a'] },
  'codex:gpt-6.1-sol': { id: 'codex:gpt-6.1-sol', model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', engine: 'codex', accounts: ['acc_c'] },
};

async function lane(answer: boolean = true) {
  const h = setup();
  Object.assign(h.services, { catalog: { get: (id: string) => MODELS[id], list: () => Object.values(MODELS) } });
  h.org.add(agent('ag_tom', 'Tom'));
  h.services.splits = { turnFor: () => TURN, inputFor: () => [], get: () => undefined, onSplitRunEnd: () => {}, afterParentTurn: () => {}, stop: () => 0 } as unknown as SplitService;
  h.dispatcher.start();
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' }), 'started');
  await flush();
  const call = h.executor.last();
  const asked: Array<{ runId: string; model: string; effort: string }> = [];
  const steered: Array<{ runId: string; text: string }> = [];
  call.request.control.engine = {
    id: 'claude',
    setModel: async (runId: string, model: string, effort: string) => { asked.push({ runId, model, effort }); return answer; },
    steer: async (runId: string, text: string) => { steered.push({ runId, text }); return true; },
  } as unknown as Engine;
  call.request.onRoute?.({ model: 'claude:claude-opus-5-5', modelName: 'Claude Opus 5.5', effort: 'medium', engine: 'claude', accountId: 'acc_a' });
  return { h, call, runId: call.request.runId, asked, steered };
}

test("continueNow on a part's lane: switched inside its turn – no cut, no wake; another engine: false at once", async () => {
  const { h, call, runId, asked } = await lane(true);
  assert.equal(h.dispatcher.splitLanes()[0].runId, runId);
  // The agent's own chat-free next-step request (agent, no chat) is not the part's – an in-lane switch leaves it.
  const own = { modelId: 'claude:claude-opus-5-5', at: 0 };
  setNextRoute(h.db, 'ag_tom', own);
  assert.equal(h.dispatcher.continueNow('ag_tom', runId, '', { modelId: 'claude:claude-sonnet-5', effort: 'high' }), true);
  await flush();
  assert.deepEqual(asked, [{ runId, model: 'claude-sonnet-5', effort: 'high' }]);
  assert.deepEqual(takeNextRoute(h.db, 'ag_tom'), own, "the agent's own request stays");
  assert.equal(call.request.signal.aborted, false, 'never cut');
  assert.equal(h.executor.calls.length, 1, 'no second turn');
  assert.equal(openWakes(h.db).length, 0, 'nothing woken');
  assert.ok(h.runItems.some((item) => item.runId === runId && item.data.modelSet === 'in-turn'));

  assert.equal(h.dispatcher.continueNow('ag_tom', runId, '', { modelId: 'codex:gpt-6.1-sol' }), false, 'another engine: not inside this turn');
  assert.equal(h.dispatcher.continueNow('ag_tom', runId, ''), false, 'no target: nothing to switch to');
  assert.equal(h.dispatcher.continueNow('ag_ann', runId, '', { modelId: 'claude:claude-sonnet-5' }), false, "another agent's run");
  await flush();
  assert.equal(call.request.signal.aborted, false);
  assert.equal(asked.length, 1);
  call.finish();
  await flush();
  assert.equal(h.dispatcher.continueNow('ag_tom', runId, '', { modelId: 'claude:claude-sonnet-5' }), false, 'ended');
});

test('an engine that refuses the switch later: the part is told it stays on its model', async () => {
  const { h, runId, steered } = await lane(false);
  assert.equal(h.dispatcher.continueNow('ag_tom', runId, '', { modelId: 'claude:claude-sonnet-5' }), true);
  await flush();
  assert.deepEqual(steered, [{ runId, text: 'The switch to Claude Sonnet 5 did not take inside this turn – I stay on Claude Opus 5.5.' }]);
});

test('tell: a note into a lane\'s running turn at its next step, journaled; held without such a turn', async () => {
  const { h, call, runId, steered } = await lane();
  assert.equal(await h.dispatcher.tell('ag_tom', runId, 'My origin tells me: check v2 too.'), 'all');
  assert.deepEqual(steered, [{ runId, text: 'My origin tells me: check v2 too.' }]);
  assert.ok(h.runItems.some((item) => item.runId === runId && (item.data.told as { chars?: number })?.chars === 33));
  assert.equal(await h.dispatcher.tell('ag_ann', runId, 'x'), 'held', "another agent's run");
  assert.equal(await h.dispatcher.tell('ag_tom', 'run_none', 'x'), 'held', 'no such turn');
  call.request.control.engine = { id: 'acp' } as unknown as Engine;
  assert.equal(await h.dispatcher.tell('ag_tom', runId, 'x'), 'held', 'an engine that never steers');
  call.request.control.engine = undefined;
  assert.equal(await h.dispatcher.tell('ag_tom', runId, 'later'), 'refused', 'not bound yet: tried again while it runs');
  call.finish();
  await flush();
  assert.equal(await h.dispatcher.tell('ag_tom', runId, 'x'), 'held', 'ended');
});

test('tell: a refused note whose turn ends without it goes to onLost – never dropped; one the turn took does not', async () => {
  // Review 08.11.: 'refused' (engine not bound yet) counted as delivered; a turn that failed before its engine dropped the note.
  const { h, call, runId } = await lane();
  let lost = 0;
  assert.equal(await h.dispatcher.tell('ag_tom', runId, 'taken', () => { lost += 1; }), 'all');
  call.request.control.engine = undefined;
  assert.equal(await h.dispatcher.tell('ag_tom', runId, 'not yet', () => { lost += 1; }), 'refused');
  await flush();
  assert.equal(lost, 0, 'not while its turn runs (tried again)');
  call.finish({ status: 'failed' });
  await flush();
  assert.equal(lost, 1, 'its turn ended without it: handed on once');
  assert.equal(h.executor.calls.length, 1);
});
