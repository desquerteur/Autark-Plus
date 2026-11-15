// B-080 – a 'fork' part's native fork fits the worker model's window by the main path's rule (splits/fork.ts windowOf, as
// agents/turn-prepare.ts chooseSession): the window the engine reported for that model on any thread (engine_sessions),
// else the catalog's, else DEFAULT_WINDOW. Live 09.11.: Codex runs Terra at 475,000 and Luna at 258,400 (the catalog
// has none for them) and Sol at 475,000 (the catalog says 1,050,000). A parent past the fit starts from the text seed.
// Owns: these checks. Never: a real engine or the real dispatcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../../src/runtime/agents/sessions.ts';
import { DEFAULT_WINDOW, FIT_SHARE } from '../../../src/runtime/agents/compaction-policy.ts';
import { seedSplitSession } from '../../../src/runtime/splits/fork.ts';
import type { Engine } from '../../../src/runtime/engines/types.ts';
import type { TurnPlan } from '../../../src/runtime/agents/turn-types.ts';
import type { Account, RouteDecision } from '../../../src/shared/model/providers.ts';
import type { SplitTurn } from '../../../src/shared/model/splits.ts';
import { CHAT, PARENT, T, world } from './fixture.ts';

/** 13.11.2026: the text seed carries my record (agents/history-text.ts) – one chat line in it. */
const RECORD = { view: () => [{ itemId: 'm1', kind: 'message', role: 'user', text: '[09:00] Lena: Check the release notes.', origin: {}, order: 1, state: 'keep' }, { itemId: 'a2', kind: 'assistant', role: 'assistant', text: 'On it.', origin: {}, order: 2, state: 'keep' }] };

const LIMIT = "native: the parent session exceeds the worker model's limit";

/** A 'fork' part of Ava's codex/acc_1 turn whose session held `parentTokens`; the worker runs `modelId` on Codex. */
async function seedOn(modelId: string, parentTokens: number, setup: { reported?: number; catalog?: number } = {}) {
  const w = world();
  w.runs.finish(PARENT, { status: 'done', endedAt: T, engine: 'codex', accountId: 'acc_1', model: 'codex:gpt-6.1-sol' });
  Object.assign(w.services, {
    catalog: { get: (id: string) => (id === modelId && setup.catalog ? { id, caps: { contextTokens: setup.catalog } } : undefined), list: () => [] },
    ledger: RECORD,
  });
  // Another agent's thread on the same model: the window Codex reported there.
  if (setup.reported) {
    new SessionStore(w.db).save({ agentId: 'ag_ben', conversationId: 'task:other', engine: 'codex', accountId: 'acc_2', ref: 'thr_ben', generation: 1,
      cursorSeq: 0, model: modelId, contextWindow: setup.reported, updatedAt: T - 60_000 });
  }
  const split: SplitTurn = {
    splitId: 'spl_w', groupId: 'sgr_w', idx: 1, of: 1, title: 'Repair run', parentRunId: PARENT, parentThread: CHAT, parentConversationId: CHAT,
    context: 'fork', firstTurn: true, parentSession: { engine: 'codex', accountId: 'acc_1', ref: 'thr_parent', contextTokens: parentTokens },
  };
  const forks: string[] = [];
  const engine = { id: 'codex', caps: { fork: true }, async fork(input: { parentRef: string }) { forks.push(input.parentRef); return { ref: 'thr_fork' }; } } as unknown as Engine;
  const result = await seedSplitSession(w.services, {
    plan: { agent: { id: 'ag_ava' } } as unknown as TurnPlan, split,
    route: { route: { modelId } as RouteDecision, engine, account: { id: 'acc_1' } as Account, model: modelId.split(':')[1], effort: 'medium' },
    tools: [], toolNames: [], system: { stable: '', volatile: '' }, promptKey: 'pk', cwd: 'C:/work/repo', runId: 'run_w',
  });
  return { result, forks };
}

test('(a) no catalog window, Codex reported 475,000 for the model elsewhere: a 250,856-token parent forks natively', async () => {
  const { result, forks } = await seedOn('codex:gpt-6.1-terra', 250_856, { reported: 475_000 });
  assert.equal(result.how, 'native');
  assert.equal(result.fellBack, undefined);
  assert.deepEqual(forks, ['thr_parent']);
});

test('(b) reported 258,400 (fit 206,720): a 245,110-token parent starts from the text seed', async () => {
  const { result, forks } = await seedOn('codex:gpt-6-luna', 245_110, { reported: 258_400 });
  assert.equal(result.how, 'text');
  assert.deepEqual(result.fellBack, [LIMIT]);
  assert.match(result.inputPrefix ?? '', /Lena: Check the release notes\./);
  assert.deepEqual(forks, []);
});

test('(c) the reported window beats the catalog: 1,050,000 listed, 475,000 reported, a 400,000-token parent does not fit', async () => {
  const { result } = await seedOn('codex:gpt-6.1-sol', 400_000, { reported: 475_000, catalog: 1_050_000 });
  assert.equal(result.how, 'text');
  assert.deepEqual(result.fellBack, [LIMIT]);
  const catalogOnly = await seedOn('codex:gpt-6.1-sol', 400_000, { catalog: 1_050_000 });
  assert.equal(catalogOnly.result.how, 'native', 'nothing reported: the catalog window holds');
});

test('(d) nothing reported and no catalog window: DEFAULT_WINDOW as before', async () => {
  const fit = Math.floor(FIT_SHARE * DEFAULT_WINDOW);
  assert.equal((await seedOn('codex:gpt-6.1-terra', fit)).result.how, 'native');
  const over = await seedOn('codex:gpt-6.1-terra', fit + 1);
  assert.equal(over.result.how, 'text');
  assert.deepEqual(over.result.fellBack, [LIMIT]);
});
