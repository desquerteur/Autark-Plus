// B-080 – a 'fork' part forks the session its parent's splitting turn ended with (runtime/splits/fork.ts recordedParent,
// SplitGroup.parentSession, migration 092): recorded when the group starts – with that run's native turn id – it stays the
// fork source when the parent's next turn renews or saves its binding again; the fork goes through that turn (Codex
// lastTurnId); another engine or account, or no recorded session, falls back to the text seed. FIXES-3 B1: a turn that still
// waits for its parts (agents.split with wait) records, on Claude Code, the session it runs on (Claude Code forks its transcript up to the split's call).
// Owns: these checks. Never: a real engine or the real dispatcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../../src/runtime/agents/sessions.ts';
import { recordTurn } from '../../../src/runtime/agents/native-turns.ts';
import { seedSplitSession, type SeedArgs } from '../../../src/runtime/splits/fork.ts';
import { forkParams } from '../../../src/runtime/engines/codex/fork.ts';
import type { Engine, EngineForkInput } from '../../../src/runtime/engines/types.ts';
import type { TurnPlan } from '../../../src/runtime/agents/turn-types.ts';
import type { Account, RouteDecision } from '../../../src/shared/model/providers.ts';
import type { SplitTurn } from '../../../src/shared/model/splits.ts';
import { CHAT, PARENT, T, part, world, type World } from './fixture.ts';

/** 13.11.2026: the text seed carries my record (agents/history-text.ts) – one chat line in it. */
const RECORD = { view: () => [{ itemId: 'm1', kind: 'message', role: 'user', text: '[09:00] Lena: Check the release notes.', origin: {}, order: 1, state: 'keep' }, { itemId: 'a2', kind: 'assistant', role: 'assistant', text: 'On it.', origin: {}, order: 2, state: 'keep' }] };

const binding = (ref: string, at: number) => ({
  agentId: 'ag_ava', conversationId: CHAT, engine: 'codex' as const, accountId: 'acc_1', ref, generation: 1, cursorSeq: 0, contextTokens: 50_000, updatedAt: at,
});

/** Ava's turn on codex/acc_1 ends with its session and its native turn recorded, then splits into one 'fork' part. */
function splitOnCodex(w: World) {
  const store = new SessionStore(w.db);
  const group = w.splits.create(w.ctx(), { goal: 'Check the release', parts: [part('Notes', { context: 'fork' })] });
  store.save(binding('thr_parent', T));
  recordTurn(w.db, { agentId: 'ag_ava', conversationId: CHAT, engine: 'codex' }, 'thr_parent', 'run_older', 'turn_6', T);
  recordTurn(w.db, { agentId: 'ag_ava', conversationId: CHAT, engine: 'codex' }, 'thr_parent', PARENT, 'turn_7', T);
  w.runs.finish(PARENT, { status: 'done', endedAt: T, engine: 'codex', accountId: 'acc_1', model: 'codex:gpt-6.1-sol' });
  w.splits.afterParentTurn(PARENT, 'done');
  return { store, groupId: group.id, turn: w.lanes.turns[0].turn, runId: w.lanes.lanes.get(w.lanes.started[0])!.runId };
}

function seed(w: World, split: SplitTurn, runId: string, on: { engine?: string; account?: string } = {}) {
  const forks: EngineForkInput[] = [];
  const engine = { id: on.engine ?? 'codex', caps: { fork: true }, async fork(input: EngineForkInput) { forks.push(input); return { ref: `thr_fork_${forks.length}` }; } } as unknown as Engine;
  const args: SeedArgs = {
    plan: { agent: { id: 'ag_ava' } } as unknown as TurnPlan, split,
    route: { route: { modelId: 'codex:gpt-6.1-sol' } as RouteDecision, engine, account: { id: on.account ?? 'acc_1' } as Account, model: 'gpt-6.1-sol', effort: 'medium' },
    tools: [], toolNames: [], system: { stable: '', volatile: '' }, promptKey: 'pk', cwd: 'C:/work/repo', runId,
  };
  return { forks, result: seedSplitSession(w.services, args) };
}

test('the group records the session its splitting turn ended with, with that run\'s native turn', () => {
  const w = world();
  const { groupId, turn } = splitOnCodex(w);
  const recorded = { engine: 'codex', accountId: 'acc_1', ref: 'thr_parent', contextTokens: 50_000, turn: 'turn_7' };
  assert.deepEqual(w.splits.list({ groupId })[0].parentSession, recorded, 'stored on the group (split_groups.parent_session)');
  assert.deepEqual(turn.parentSession, recorded, 'and handed to the part\'s turn (turnFor)');
});

test('the parent renews or saves its binding again after the split: the part still forks the recorded session, through that turn', async () => {
  for (const later of ['renewed', 'saved again', 'removed'] as const) {
    const w = world();
    const { store, groupId, turn, runId } = splitOnCodex(w);
    if (later === 'renewed') store.save(binding('thr_renewed', T + 2_000)); // its next turn renewed the session (sessionRenewed: context)
    if (later === 'saved again') store.save(binding('thr_parent', T + 2_000)); // a later turn on the same session
    if (later === 'removed') store.remove('ag_ava', CHAT, 'codex', T + 2_000); // an interrupted renewal left no binding
    const { forks, result } = seed(w, turn, runId);
    const seeded = await result;
    assert.equal(seeded.how, 'native', later);
    assert.equal(seeded.parentRef, 'thr_parent', later);
    assert.deepEqual(forks.map((fork) => [fork.parentRef, fork.lastTurn]), [['thr_parent', 'turn_7']], later);
    assert.equal(forkParams(forks[0], { model: 'gpt-6.1-sol' }).lastTurnId, 'turn_7', 'Codex thread/fork through the splitting turn');
    const part1 = w.splits.list({ groupId })[0].splits[0];
    assert.deepEqual(part1.fork, { how: 'native', engine: 'codex', accountId: 'acc_1', parentRef: 'thr_parent' }, later);
  }
});

/**
 * FIXES-3 B1: Ava's turn still runs on `engine` (the dispatcher's activity says so; its run's row names none yet) and waits for
 * one 'fork' part (agents.split with wait); her session there was bound at `boundAt`, with one finished native turn on it.
 */
function waitOn(w: World, engine: 'claude' | 'codex', boundAt: number) {
  new SessionStore(w.db).save({ ...binding('thr_parent', boundAt), engine });
  recordTurn(w.db, { agentId: 'ag_ava', conversationId: CHAT, engine }, 'thr_parent', 'run_older', 'turn_6', boundAt);
  Object.assign(w.lanes, { activity: () => [{ agentId: 'ag_ava', runId: PARENT, note: '', startedAt: T, engine, model: 'codex:gpt-6.1-sol' }] });
  const group = w.splits.create(w.ctx(), { goal: 'Check the release', parts: [part('Notes', { context: 'fork' })], wait: true });
  return { groupId: group.id, turn: w.lanes.turns[0].turn, runId: w.lanes.lanes.get(w.lanes.started[0])!.runId };
}

test('a waited part on Claude Code: the group records the session the running turn runs on, and the part forks it (FIXES-3 B1)', async () => {
  const w = world();
  const { groupId, turn, runId } = waitOn(w, 'claude', T - 60_000);
  const recorded = { engine: 'claude', accountId: 'acc_1', ref: 'thr_parent', contextTokens: 50_000, model: 'codex:gpt-6.1-sol' };
  assert.deepEqual(w.splits.list({ groupId })[0].parentSession, recorded, 'recorded while the splitting turn runs');
  const { forks, result } = seed(w, turn, runId, { engine: 'claude' });
  assert.equal((await result).how, 'native');
  assert.deepEqual(forks.map((fork) => [fork.parentRef, fork.lastTurn]), [['thr_parent', undefined]], 'Claude Code forks the transcript as it takes it – no turn names a fork point (review R6)');
});

test('a waited part on Codex keeps the text seed: its fork in the middle of a turn read 0 and 16,768 of 34,980 tokens cached (measured 18.11.2026)', async () => {
  const w = world();
  Object.assign(w.services, { ledger: RECORD });
  const { groupId, turn, runId } = waitOn(w, 'codex', T - 60_000);
  assert.equal(w.splits.list({ groupId })[0].parentSession, undefined);
  const { forks, result } = seed(w, turn, runId);
  assert.equal((await result).how, 'text');
  assert.equal(forks.length, 0);
});

test('a waited part whose running turn started its session (a first turn, a renewal): nothing finished to fork, the text seed', async () => {
  const w = world();
  Object.assign(w.services, { ledger: RECORD });
  const { groupId, turn, runId } = waitOn(w, 'claude', T + 1_000); // bound during the turn
  assert.equal(w.splits.list({ groupId })[0].parentSession, undefined);
  assert.equal((await seed(w, turn, runId, { engine: 'claude' }).result).how, 'text');
});

test('another engine or account, or a group without a recorded session, starts from the text seed', async () => {
  const w = world();
  Object.assign(w.services, { ledger: RECORD });
  const { turn, runId } = splitOnCodex(w);
  const claude = await seed(w, turn, runId, { engine: 'claude' }).result;
  assert.equal(claude.how, 'text');
  assert.deepEqual(claude.fellBack, ["native: the parent's turn ran on another engine"]);
  const other = seed(w, turn, runId, { account: 'acc_2' });
  assert.equal((await other.result).how, 'text');
  assert.deepEqual((await other.result).fellBack, ["native: the parent's turn ran on another account"]);
  assert.equal(other.forks.length, 0);
  const { parentSession: _none, ...unrecorded } = turn;
  const before = await seed(w, unrecorded, runId).result; // a group from before migration 092
  assert.equal(before.how, 'text');
  assert.deepEqual(before.fellBack, ["native: the parent's splitting turn left no session on this engine"]);
  assert.match(before.inputPrefix ?? '', /Lena: Check the release notes\./);
});
