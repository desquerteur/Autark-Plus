// Owner 16.11.2026: a run a mail started is an ordinary turn with every tool, so it can split (agents.split) – its split
// groups and lanes carry the mail origin. The split service hears how such a run ended like any other (dispatch-runs.ts
// execute/release → split-turn.ts turnEndedEarly, dispatch-settle.ts abandonRun): a crashed part fails its split, a crashed
// parent lets its groups go on ('failed'), a parent released after the person's Stop stops them ('stopped'), its run ends
// 'interrupted'. The chat-free retry of the mail's wakes stays. RunningTurns on fake services.
// Owns: these assertions only. Never: real engines, splits or timers beyond the release grace.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flush } from './fakes.ts';
import { abortTurn, runEntry, RunningTurns } from '../../../src/runtime/agents/dispatch-runs.ts';
import { groupWakes } from '../../../src/runtime/agents/dispatch-groups.ts';
import { laneKey } from '../../../src/runtime/agents/dispatch-lanes.ts';
import type { LiveStatus } from '../../../src/runtime/agents/dispatch-live.ts';
import type { TurnOutcome, TurnRequest } from '../../../src/runtime/agents/turn-types.ts';
import type { RuntimeServices, Wake } from '../../../src/runtime/contracts.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import type { SplitTurn } from '../../../src/shared/model/splits.ts';

const NOW = 1_000_000;
const MAIL = { source: 'app:mail1', label: 'New mail in office@example.test', mailProvenance: { appId: 'mail1', messageIds: ['INBOX/1/2'] } };
const TURN: SplitTurn = { splitId: 'sp_1', groupId: 'sg_1', idx: 1, of: 2, title: 'Part one', parentRunId: 'run_parent', parentThread: 'app:mail1', context: 'brief', firstTurn: true };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function rig(execute: (request: TurnRequest) => Promise<TurnOutcome>) {
  const ends: Array<Record<string, unknown>> = [];
  const parents: Array<[string, string]> = [];
  const finished: Array<{ runId: string; status?: string }> = [];
  const settled: string[] = [];
  const services = {
    clock: { now: () => NOW }, log: { info() {}, warn() {}, error() {}, debug() {} },
    tasks: { get: () => undefined },
    runs: {
      item: () => undefined, items: () => [], get: () => ({ status: 'running' }), updateItem() {},
      finish: (runId: string, patch: { status?: string }) => { finished.push({ runId, status: patch.status }); },
    },
    wakes: {
      done: (ids: string[]) => settled.push(`done:${ids.join(',')}`),
      release: (ids: string[], dueAt?: number) => settled.push(`release:${ids.join(',')}${dueAt === undefined ? '' : '@later'}`),
    },
    splits: {
      onSplitRunEnd: (splitId: string, end: Record<string, unknown>) => { ends.push({ splitId, ...end }); },
      afterParentTurn: (runId: string, status: string) => { parents.push([runId, status]); },
    },
  } as unknown as RuntimeServices;
  const live = { awake() {}, status() {}, emit() {} } as unknown as LiveStatus;
  const turns = new RunningTurns({ services: () => services, executor: { execute }, releaseMs: 20 }, live, () => {});
  return { services, turns, ends, parents, finished, settled };
}

function mailWake(): Wake {
  return { id: 'wk_1', agentId: 'ag_tom', reason: 'event', dueAt: 10, createdAt: 10, attempts: 1, origin: MAIL, note: 'New mail' };
}

test('a part of a mail-started run that crashes fails its split', async () => {
  const h = rig(async () => { throw new Error('boom'); });
  const entry = runEntry({ runId: 'run_s1', agentId: 'ag_tom', lane: laneKey('ag_tom', 'sp_1'), reason: 'split', split: TURN, origin: MAIL, wakeIds: [], attempts: 0, startedAt: 0 });
  h.turns.launch(h.services, entry, { runId: 'run_s1', agentId: 'ag_tom', reason: 'split', split: TURN, origin: MAIL, notes: [] });
  await entry.finished;
  assert.deepEqual(h.ends, [{ splitId: 'sp_1', runId: 'run_s1', status: 'failed', error: 'The turn failed unexpectedly.' }]);
  assert.deepEqual(h.finished, [{ runId: 'run_s1', status: 'failed' }]);
  assert.deepEqual(h.turns.lanes(), [], 'its lane is free');
});

test('a mail-started run that crashes lets the groups it split go on, and its mail comes back later', async () => {
  const h = rig(async () => { throw new Error('boom'); });
  h.turns.start(h.services, { id: 'ag_tom' } as Agent, groupWakes([mailWake()])[0]!);
  const entry = h.turns.get('ag_tom')!;
  await entry.finished;
  assert.deepEqual(h.parents, [[entry.runId, 'failed']]);
  assert.deepEqual(h.settled, ['release:wk_1@later'], 'the chat-free retry stays');
});

test("a mail-started run that ignores the person's Stop is released: run interrupted, the groups it split stop", async () => {
  const h = rig(() => new Promise<TurnOutcome>(() => {})); // a tool that never settles and ignores the signal
  h.turns.start(h.services, { id: 'ag_tom' } as Agent, groupWakes([mailWake()])[0]!);
  const entry = h.turns.get('ag_tom')!;
  await flush();
  abortTurn(entry, 'Stopped.', 'human');
  await sleep(60);
  await flush();
  assert.equal(h.turns.has('ag_tom'), false, 'released');
  assert.deepEqual(h.parents, [[entry.runId, 'stopped']]);
  assert.deepEqual(h.finished, [{ runId: entry.runId, status: 'interrupted' }]);
  assert.deepEqual(h.settled, ['done:wk_1'], 'the person stopped it: no retry');
});
