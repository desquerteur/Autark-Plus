// CTX7 compaction policy over the real chat store, context service, knowledge store and run journal with one recording
// engine: B-080 – no working set; a session is renewed only past the fit of the window (80 %; an unknown window counts as
// 200k) on a 1M-window model and on an engine without caps.rebase, the engine-reported window before the catalog's.
// 13.11.2026: a renewed session or a session-less engine never gets a chat's history or a chat summary – only new lines,
// after the agent's own record when there is one (agents/history-text.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, model } from '../context/fixture.ts';
import { account } from '../models/harness.ts';
import { TurnExecutor } from '../../../src/runtime/agents/turn.ts';
import { SessionStore } from '../../../src/runtime/agents/sessions.ts';
import { DEFAULT_WINDOW, FIT_SHARE, fitLimit, pastFit } from '../../../src/runtime/agents/compaction-policy.ts';
import type { Engine, EngineCaps, EngineTurnInput, EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import type { ModelInfo, RouteDecision } from '../../../src/shared/model/providers.ts';

type Reply = (input: EngineTurnInput) => Partial<EngineTurnResult> | undefined;

const textOf = (input: EngineTurnInput | undefined) => (input?.input[0] as { text: string } | undefined)?.text ?? '';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(options: { caps?: Partial<EngineCaps>; catalogWindow?: number } = {}) {
  const f = fixture();
  const s = f.services;
  const agent = f.vid;
  const chat = f.chats.create({ title: 'Launch', agentIds: [agent.id], createdBy: 'human' });
  const calls: EngineTurnInput[] = [];
  const state: { reply?: Reply; sessions: number } = { sessions: 0 };
  const caps: EngineCaps = { sessions: true, dynamicTools: false, mcp: false, images: false, rebase: true, structured: false, ownTools: false, ...options.caps };
  const engine = {
    id: 'claude', caps,
    async run(input: EngineTurnInput): Promise<EngineTurnResult> {
      calls.push(input);
      const session = caps.sessions ? (input.session ?? { ref: `s${++state.sessions}`, generation: 1 }) : undefined;
      return { text: `answer ${calls.length}`, stop: 'done', ...(session ? { session } : {}), ...state.reply?.(input) };
    },
  } as unknown as Engine;
  const opus: ModelInfo = {
    ...model('claude:opus', 'frontier', 'Claude Opus'), provider: 'claude', engine: 'claude',
    caps: options.catalogWindow ? { contextTokens: options.catalogWindow } : {},
  };
  const route: RouteDecision = { modelId: opus.id, engine: 'claude', accountId: 'acc_claude', effort: 'medium', category: 'chat', reason: 'test', by: 'rules', alternatives: [] };
  const acc = account('acc_claude', 'claude');
  Object.assign(s, {
    router: { route: async () => route },
    engines: { get: () => engine },
    accounts: { get: (id: string) => (id === acc.id ? acc : undefined), markLimited: () => {}, updateLimits: () => {} },
    catalog: { get: (id: string) => (id === opus.id ? opus : undefined), list: () => [opus] },
    subconscious: {},
    tools: { get: () => undefined, specsFor: () => [], call: async () => ({ content: [{ type: 'text', text: 'ok' }] }) },
  });

  let runs = 0;
  const store = new SessionStore(f.db);
  return {
    ...f, s, agent, chat, calls, state,
    send: (body: string) => f.chats.send({ conversationId: chat.id, body, authorId: 'human' }),
    turn: () => new TurnExecutor(() => s).execute({
      runId: `run_${++runs}`, agentId: agent.id, conversationId: chat.id, reason: 'message', notes: [],
      signal: new AbortController().signal, control: { lastSeq: 0, steeredSeq: 0 },
    }),
    /** The low-priority work after a turn. */
    settled: async () => { await tick(); await tick(); },
    binding: () => store.get(agent.id, 'main', 'claude'),
    cursor: () => f.chats.members(chat.id).find((member) => member.memberId === agent.id)!.readSeq,
    notes: (runId: string) => s.runs.items(runId).filter((item) => item.kind === 'note' && item.name !== 'Answer').map((item) => item.data), // the final answer's item (B-047 D4) is no renewal note
  };
}

test('B-080: no working set – the fit is 80 % of the window, an unknown window counts as 200k', () => {
  assert.equal(FIT_SHARE, 0.8);
  assert.equal(fitLimit(1_000_000), 800_000, 'a 1M window holds 800k between turns, not 64k');
  assert.equal(fitLimit(258_400), 206_720);
  assert.equal(fitLimit(undefined), 0.8 * DEFAULT_WINDOW, 'an unknown window: the smallest frontier window');
  assert.equal(pastFit(200_000, 1_000_000), false, '200k of a 1M window keeps its session');
  assert.equal(pastFit(800_001, 1_000_000), true);
  assert.equal(pastFit(undefined, 1000), false);
});

test('a 1M-window session: 200k keep it (B-080: no 64k cliff), past 800k it is renewed – never with a chat history', async () => {
  const h = setup({ catalogWindow: 1_000_000 });
  h.state.reply = () => ({ contextTokens: 50_000 });
  h.send('Hello');
  await h.turn();
  h.send('Next step');
  await h.turn();
  assert.equal(h.calls[1].session?.ref, 's1', '50k of a 1M window keeps the session');

  h.state.reply = () => ({ contextTokens: 200_000 });
  h.send('More context');
  await h.turn();
  h.send('Still more');
  await h.turn();
  assert.equal(h.calls[3].session?.ref, 's1', '200k is no reason to drop the work');
  h.state.reply = () => ({ contextTokens: 850_000 });
  h.send('Huge output');
  await h.turn();
  assert.equal(h.binding()?.contextTokens, 850_000);
  h.state.reply = undefined;
  h.send('Over the working set');
  await h.turn();
  assert.equal(h.calls[5].session, undefined, '850k no longer fits the 1M window with room for the next turn (this engine has no rebuild)');
  assert.ok(!/Earlier messages|Summary of older/.test(textOf(h.calls[5])) && textOf(h.calls[5]).includes('Over the working set'), textOf(h.calls[5]));
  assert.deepEqual(h.notes('run_6'), [{ sessionRenewed: 'context' }]);
  assert.equal(h.binding()?.ref, 's2');
});

test('an engine with sessions but without caps.rebase and an unknown window renews past the fit of a 200k window', async () => {
  const h = setup({ caps: { rebase: false } });
  h.state.reply = () => ({ contextTokens: 150_000 });
  h.send('Hello');
  await h.turn();
  h.state.reply = () => ({ contextTokens: 170_000 });
  h.send('Next step');
  await h.turn();
  assert.equal(h.calls[1].session?.ref, 's1', '150k fits 80 % of the assumed 200k');
  h.state.reply = undefined;
  h.send('Again');
  await h.turn();
  assert.equal(h.calls[2].session, undefined, '170k does not');
  assert.deepEqual(h.notes('run_3'), [{ sessionRenewed: 'context' }]);
});

test('the window the engine reported for the model comes before the catalog window', async () => {
  const h = setup({ catalogWindow: 1_000_000 });
  h.state.reply = () => ({ contextWindow: 100_000, contextTokens: 85_000 });
  h.send('Hello');
  await h.turn();
  assert.equal(h.binding()?.contextWindow, 100_000);
  h.state.reply = undefined;
  h.send('Next step');
  await h.turn();
  assert.equal(h.calls[1].session, undefined, '85k is past 80 % of the reported 100k window (the catalog says 1M: 85k would stay)');
});

test('a session-less engine: every turn gets its new lines, never a chat summary or earlier chat lines', async () => {
  const h = setup({ caps: { sessions: false, rebase: false } });
  for (let i = 1; i <= 120; i++) h.send(`Line ${i}: budget ${i * 10} EUR`);
  assert.equal((await h.turn()).status, 'done');
  await h.settled();
  h.send('Where are we?');
  await h.turn();
  const text = textOf(h.calls[1]);
  assert.ok(!/Summary of older messages|Earlier messages/.test(text), text);
  assert.match(text, /Where are we\?/);
  assert.deepEqual(h.notes('run_1'), [], 'no compaction note: there are no chat summaries');
});
