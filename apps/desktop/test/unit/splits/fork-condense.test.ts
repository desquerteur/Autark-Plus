// F26 (owner 16.11.2026: "das Unterbewusstsein vom neuen Agent … komprimiert alles weg, dann braucht er nur das, was er wirklich
// braucht") – a 'fork' part's first start (splits/fork.ts seedSplitSession): my record is copied into the part's thread up to the
// splitting run (ledger.fork), the part's subconscious condenses there with its brief as what wakes it (subconscious/service.ts
// condensePart → route-turn.ts condenseTurn), and the part starts from that record ('ledger') unless my warm native fork on the same
// model costs less (forkPays). My own record is never marked; a brief part makes no call; a later seeding keeps the copy; the
// pipeline (agents/split-turn.ts seedSplit) hands the part's notes and its turn's stop to the call.
// Owns: these checks. Never: a real model, engine or dispatcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerSetup } from '../context/ledger-fixture.ts';
import { seedSplitSession } from '../../../src/runtime/splits/fork.ts';
import { seedSplit } from '../../../src/runtime/agents/split-turn.ts';
import type { TurnRequest } from '../../../src/runtime/agents/turn-types.ts';
import { SubconsciousImpl } from '../../../src/runtime/subconscious/service.ts';
import { restoreItems } from '../../../src/runtime/context/ledger/restore.ts';
import type { Engine } from '../../../src/runtime/engines/types.ts';
import type { TurnPlan } from '../../../src/runtime/agents/turn-types.ts';
import type { StructuredRunner } from '../../../src/runtime/decision/types.ts';
import type { Account, RouteDecision } from '../../../src/shared/model/providers.ts';
import type { SplitContext, SplitTurn } from '../../../src/shared/model/splits.ts';

const MODEL = 'codex:gpt-6.1-sol';
const PART = 'split:spl_c';
const BRIEF = 'I have just split myself: what came before is me up to my agents.split call; from here on this session is this part.\nMy part #1 of 2 – Release notes\nWrite the release notes from build 4 only.';

/**
 * Tom's record: four finished turns with one long tool output each (t1–t4; run_4 splits), then a fifth turn after the split (t5).
 * The subconscious answers `condense`; the engine forks natively when asked.
 */
function setup(condense: Array<{ id: string; note: string }>) {
  const t = ledgerSetup();
  const runIds: string[] = [];
  for (let index = 1; index <= 5; index++) {
    const run = t.turn(t.say(`Step ${index} please, with some words.`).seq);
    t.ourCall(run, 'shell.exec', { command: `build ${index}` }, `build ${index} finished in 40${index} seconds\n${'log line\n'.repeat(400)}THE END ${index}`, `c${index}`);
    t.journal.finish(run, { status: 'done', endedAt: t.clock.now(), engine: 'codex', accountId: 'acc_1', model: MODEL });
    runIds.push(run);
    t.clock.advance(1000);
  }
  const prompts: string[] = [];
  const runner: StructuredRunner = async (call) => {
    prompts.push(call.prompt);
    const structured = { condense };
    return { text: JSON.stringify(structured), structured, by: 'fake' };
  };
  Object.assign(t.services, { catalog: { get: () => undefined, list: () => [] } });
  t.services.subconscious = new SubconsciousImpl({ services: () => t.services, runner });
  t.journal.start({ id: 'run_part', agentId: t.tom.id, trigger: 'split', splitId: 'spl_c' });
  const forks: string[] = [];
  const engine = { id: 'codex', caps: { fork: true }, async fork(input: { parentRef: string }) { forks.push(input.parentRef); return { ref: 'thr_fork' }; } } as unknown as Engine;
  const splitOf = (parentTokens: number, context: SplitContext = 'fork'): SplitTurn => ({
    splitId: 'spl_c', groupId: 'sgr_c', idx: 1, of: 2, title: 'Release notes', parentRunId: runIds[3], parentThread: 'main', parentConversationId: t.chat.id,
    context, firstTurn: true, parentSession: { engine: 'codex', accountId: 'acc_1', ref: 'thr_parent', contextTokens: parentTokens },
  });
  const seed = (parentTokens: number, context: SplitContext = 'fork') => seedSplitSession(t.services, {
    plan: { agent: t.tom, thread: PART } as unknown as TurnPlan, split: splitOf(parentTokens, context),
    route: { route: { modelId: MODEL } as RouteDecision, engine, account: { id: 'acc_1' } as Account, model: 'gpt-6.1-sol', effort: 'medium' },
    tools: [], toolNames: [], system: { stable: '', volatile: '' }, promptKey: 'pk', cwd: 'C:/work/repo', runId: 'run_part', brief: BRIEF,
  });
  const state = (thread: string, itemId: string) => t.ledger.items(t.tom.id, thread).find((item) => item.itemId === itemId)?.state;
  const seedNote = () => t.journal.items('run_part').findLast((item) => item.kind === 'note' && item.data.splitSeed)?.data;
  return { t, prompts, forks, engine, splitOf, seed, state, seedNote };
}

test('a fork part: my record up to the split is copied, its subconscious condenses there with the brief, it starts from that record; mine stays whole', async () => {
  const { t, prompts, forks, seed, state, seedNote } = setup([{ id: 't1', note: 'build 1 finished in 401 seconds' }]);
  try {
    const result = await seed(150_000);
    assert.equal(prompts.length, 1, 'one condense call');
    assert.match(prompts[0], /this part starts now with the context so far and works on its one piece alone/);
    assert.match(prompts[0], /Write the release notes from build 4 only\./, 'the brief wakes it');
    assert.match(prompts[0], /- t1 · tool/, 'it reads the items of its copy');
    assert.doesNotMatch(prompts[0], /- t5 · tool/, 'my turn after the split is not in its copy');
    assert.equal(result.how, 'ledger');
    assert.equal(result.condensed, 1);
    assert.deepEqual(forks, [], 'a condensed start instead of my fork');
    assert.match(result.inputPrefix ?? '', /build 1 finished in 401 seconds/);
    assert.match(result.inputPrefix ?? '', /"compacted":"t1"/, 'the stamp brings the original back');
    assert.doesNotMatch(result.inputPrefix ?? '', /THE END 1/);
    assert.match(result.inputPrefix ?? '', /THE END 2/, 'the rest stays whole');
    assert.doesNotMatch(result.inputPrefix ?? '', /THE END 5/);
    assert.equal(state(PART, 't1'), 'condensed');
    assert.equal(state('main', 't1'), 'keep', 'my own record is never marked');
    assert.equal(t.ledger.items(t.tom.id, 'main').filter((item) => item.state !== 'keep').length, 0);
    assert.equal(state(PART, 't5'), undefined);
    assert.deepEqual({ splitSeed: seedNote()?.splitSeed, condensed: seedNote()?.condensed }, { splitSeed: 'ledger', condensed: 1 });
    assert.match(restoreItems(t.services, t.tom.id, PART, { ids: ['t1'] }), /THE END 1/, "the part's context.restore finds the original");
    assert.equal(state('main', 't1'), 'keep');
  } finally { t.cleanup(); }
});

test('my warm fork on the same model costs less than the condensed record: the part forks natively, its copy keeps the marks', async () => {
  const { t, forks, seed, state, seedNote } = setup([{ id: 't1', note: 'build 1 finished in 401 seconds' }]);
  try {
    const result = await seed(6_000);
    assert.equal(result.how, 'native');
    assert.deepEqual(forks, ['thr_parent']);
    assert.equal(result.condensed, 1);
    assert.equal(seedNote()?.condensed, 1);
    assert.equal(state(PART, 't1'), 'condensed');
    assert.equal(state('main', 't1'), 'keep');
  } finally { t.cleanup(); }
});

test('the same fork on a cold cache: the condensed record (my fork would read everything uncached anyway)', async () => {
  const { t, forks, seed } = setup([{ id: 't2', note: 'build 2 finished in 402 seconds' }]);
  try {
    t.clock.advance(2 * 60 * 60_000);
    const result = await seed(6_000);
    assert.equal(result.how, 'ledger');
    assert.deepEqual(forks, []);
  } finally { t.cleanup(); }
});

test('nothing condensed: my native fork as before, with the part\'s copy of my record in place for its restores', async () => {
  const { t, prompts, forks, seed, state, seedNote } = setup([]);
  try {
    const result = await seed(150_000);
    assert.equal(prompts.length, 1);
    assert.equal(result.how, 'native');
    assert.equal(result.condensed, undefined);
    assert.equal(seedNote()?.condensed, undefined);
    assert.deepEqual(forks, ['thr_parent']);
    assert.deepEqual(t.ledger.items(t.tom.id, PART).map((item) => item.itemId).filter((id) => id.startsWith('t')), ['t1', 't2', 't3', 't4']);
    assert.equal(state(PART, 't1'), 'keep');
  } finally { t.cleanup(); }
});

test('a brief part makes no call and gets no copy; a later seeding of a fork part keeps its copy and calls nothing again', async () => {
  const { t, prompts, seed } = setup([{ id: 't1', note: 'build 1 finished in 401 seconds' }]);
  try {
    assert.equal((await seed(150_000, 'brief')).how, 'fresh');
    assert.equal(prompts.length, 0);
    assert.equal(t.ledger.items(t.tom.id, PART).length, 0);
    await seed(150_000);
    assert.equal(prompts.length, 1);
    const rows = t.ledger.items(t.tom.id, PART).length;
    const again = await seed(150_000);
    assert.equal(prompts.length, 1, 'no second call on a part that holds its record');
    assert.equal(t.ledger.items(t.tom.id, PART).length, rows, 'no second copy');
    assert.equal(again.how, 'native', 'nothing newly condensed: my fork');
  } finally { t.cleanup(); }
});

test('the pipeline hands the part\'s notes and its turn\'s stop to the call; a stopped turn condenses nothing and starts as before', async () => {
  const { t, engine, splitOf, prompts } = setup([{ id: 't1', note: 'build 1 finished in 401 seconds' }]);
  try {
    const impl = t.services.subconscious;
    const seen: Array<{ brief: string; thread: string; aborted?: boolean }> = [];
    t.services.subconscious = { ...impl, condensePart: (input) => { seen.push({ brief: input.brief, thread: input.thread, aborted: input.signal?.aborted }); return impl.condensePart!(input); } };
    const split = { ...splitOf(150_000), cwd: 'C:/work/repo' };
    const plan = { agent: t.tom, thread: PART, split, mode: { key: 'general' }, memberCursor: 0 } as unknown as TurnPlan;
    const stop = new AbortController();
    const request = { runId: 'run_part', agentId: t.tom.id, reason: 'split', split, signal: stop.signal, notes: [{ text: BRIEF, at: 0 }, { text: 'Part #2 found: build 4 is green.', at: 0 }] } as unknown as TurnRequest;
    const route = { modelId: MODEL, engine: 'codex', accountId: 'acc_1', effort: 'medium' } as RouteDecision;
    const native = { account: { id: 'acc_1' } as Account, model: 'gpt-6.1-sol', offer: { native: [], names: [] }, prompt: { stable: '', volatile: '' } };
    stop.abort();
    const cut = await seedSplit(t.services, plan, request, engine, route, 'pk', native);
    assert.deepEqual(seen, [{ brief: `${BRIEF}\n\nPart #2 found: build 4 is green.`, thread: PART, aborted: true }]);
    assert.equal(prompts.length, 0, 'the stop ends the call before it runs');
    assert.equal(cut?.prefix, undefined, 'my native fork, as before');
    assert.equal(state(t, 't1'), 'keep');
  } finally { t.cleanup(); }
});

function state(t: ReturnType<typeof setup>['t'], itemId: string) {
  return t.ledger.items(t.tom.id, PART).find((item) => item.itemId === itemId)?.state;
}
