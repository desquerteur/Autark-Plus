// The harness of the native-rebuild tests (session-rebuild.test.ts, session-rebuild-b080.test.ts): the executor over the real chat
// store, context service and run journal with two recording engines (caps.rebuild) and a fake context ledger with a settable view
// and marks. B-080 wave 3: moved out of session-rebuild.test.ts so both files stay below 450 lines.

import { MAIN_THREAD } from '../../../src/shared/model/origin.ts';
import { fixture, model } from '../context/fixture.ts';
import { account } from '../models/harness.ts';
import { TurnExecutor } from '../../../src/runtime/agents/turn.ts';
import { SessionStore } from '../../../src/runtime/agents/sessions.ts';
import { resetRebuildMemory } from '../../../src/runtime/agents/rebuild.ts';
import type { Engine, EngineCaps, EngineRebuildInput, EngineTurnInput, EngineTurnResult, RebuildProbe } from '../../../src/runtime/engines/types.ts';
import type { EngineId, ModelInfo, RouteDecision } from '../../../src/shared/model/providers.ts';
import type { LedgerItem, LedgerViewItem } from '../../../src/shared/model/context-ledger.ts';
import type { RebuildNeed } from '../../../src/runtime/contracts/ledger.ts';

type Reply = (input: EngineTurnInput) => Partial<EngineTurnResult> | undefined;
export const ENDED: Partial<EngineTurnResult> = { text: '', stop: 'error', error: { code: 'conflict', message: 'The rebuilt session could not continue.', details: { rebase: true, rebuild: 'failed' } } };

export function rebuildingEngine(id: EngineId) {
  const calls: EngineTurnInput[] = [];
  const rebuilds: EngineRebuildInput[] = [];
  const state: { reply?: Reply; sessions: number; fail?: string; probe: Partial<RebuildProbe>; probes: number; version: string } = { sessions: 0, probe: {}, probes: 0, version: '1.0.0' };
  const caps: EngineCaps = { sessions: true, dynamicTools: false, mcp: false, images: false, rebase: true, structured: false, ownTools: false, rebuild: true };
  const engine = {
    id, caps,
    async run(input: EngineTurnInput): Promise<EngineTurnResult> {
      calls.push(input);
      const session = input.session ?? { ref: `${id}-s${++state.sessions}`, generation: 1 };
      return { text: `${id} answer ${calls.length}`, stop: 'done', session, ...state.reply?.(input) };
    },
    async rebuild(input: EngineRebuildInput) {
      if (state.fail) throw new Error(state.fail);
      rebuilds.push(input);
      return { ref: `${id}-r${rebuilds.length}`, generation: input.generation, items: input.items.length };
    },
    async rebuildVersion() { return state.version; },
    async probeRebuild(): Promise<RebuildProbe> { state.probes++; return { version: state.version, ok: true, at: 0, ...state.probe }; },
  } as unknown as Engine;
  return { engine, calls, rebuilds, state };
}

/** A context ledger with a settable view and marks (the LEDGER track's ContextLedger shape). */
export function fakeLedger() {
  const state: { view: LedgerViewItem[]; need?: RebuildNeed; marked: LedgerItem[]; rebuilt: number[]; marks: Array<{ itemId: string; state: string; by: string }> } = { view: [], marked: [], rebuilt: [], marks: [] };
  const item = (entry: LedgerViewItem): LedgerItem => ({ agentId: 'a', conversationId: 'c', itemId: entry.itemId, kind: entry.kind, order: entry.order, createdAt: 0, tokens: 10, title: entry.text.slice(0, 20), state: 'keep', origin: entry.origin });
  const ledger = {
    view: () => state.view,
    needsRebuild: () => state.need,
    items: (_a: string, _c: string, opts?: { since?: number }) => [...state.view.map(item), ...state.marked].filter((entry) => entry.order >= (opts?.since ?? 0)),
    // KI-Runde 17.11.2026: the thread's chat lines (the real ledger adds the agent's own posted words; this fake records none).
    lines: () => [...state.view.map(item), ...state.marked].filter((entry) => entry.kind === 'message'),
    rebuilt: (_a: string, _c: string, upTo: number) => { state.rebuilt.push(upTo); state.need = undefined; },
    record: () => { throw new Error('not used'); }, original: () => undefined,
    mark: (_a: string, _c: string, marks: Array<{ itemId: string; state: LedgerItem['state']; by: string }>) => { // B-080: the fit's hides leave the view and stand as marks
      for (const mark of marks) {
        state.marks.push({ itemId: mark.itemId, state: mark.state, by: mark.by });
        const entry = state.view.find((item) => item.itemId === mark.itemId);
        if (!entry || mark.state !== 'hidden') continue;
        state.view = state.view.filter((item) => item !== entry);
        state.marked.push({ ...item(entry), state: 'hidden' });
      }
    },
  };
  return { ledger, state };
}

export const view = (entries: Array<[string, LedgerViewItem['kind'], LedgerViewItem['role'], string, LedgerViewItem['call']?]>): LedgerViewItem[] =>
  entries.map(([itemId, kind, role, text, call], index) => ({ itemId, kind, role, text, origin: { engine: 'claude', model: 'claude:opus' }, order: index + 1, state: 'keep', ...(call ? { call } : {}) }));

export function setup() {
  resetRebuildMemory();
  const f = fixture();
  const s = f.services;
  const agent = f.vid;
  const chat = f.chats.create({ title: 'Launch', agentIds: [agent.id], createdBy: 'human' });
  const claude = rebuildingEngine('claude');
  const codex = rebuildingEngine('codex');
  const models = new Map<string, ModelInfo>([
    ['claude:opus', { ...model('claude:opus', 'frontier', 'Claude Opus'), provider: 'claude', engine: 'claude' }],
    ['codex:sol', model('codex:sol', 'frontier', 'GPT Sol')],
  ]);
  const route = (engine: 'claude' | 'codex'): RouteDecision => ({
    modelId: engine === 'claude' ? 'claude:opus' : 'codex:sol', engine, accountId: `acc_${engine}`, effort: 'medium', category: 'chat', reason: 'test', by: 'rules', alternatives: [],
  });
  const current = { engine: 'claude' as 'claude' | 'codex' };
  const accounts = new Map([['acc_claude', account('acc_claude', 'claude')], ['acc_codex', account('acc_codex', 'codex')]]);
  const { ledger, state: ledgerState } = fakeLedger();
  const notices: unknown[] = [];
  Object.assign(s, {
    router: { route: async () => route(current.engine) },
    engines: { get: (id: string) => (id === 'codex' ? codex.engine : claude.engine) },
    accounts: { get: (id: string) => accounts.get(id), markLimited: () => {}, updateLimits: () => {} },
    catalog: { get: (id: string) => models.get(id), list: () => [...models.values()], recordOutcome: () => {} },
    subconscious: {},
    tools: { get: () => undefined, specsFor: () => [], call: async () => ({ content: [{ type: 'text', text: 'ok' }] }) },
    ledger,
  });
  let runs = 0;
  const store = new SessionStore(f.db);
  return {
    ...f, s, agent, chat, claude, codex, ledgerState, notices, store,
    send: (body: string) => f.chats.send({ conversationId: chat.id, body, authorId: 'human' }),
    turn: (engine: 'claude' | 'codex') => {
      current.engine = engine;
      return new TurnExecutor(() => s).execute({
        runId: `run_${++runs}`, agentId: agent.id, conversationId: chat.id, reason: 'message', notes: [],
        signal: new AbortController().signal, control: { lastSeq: 0, steeredSeq: 0 },
      });
    },
    binding: (engine: EngineId) => store.get(agent.id, MAIN_THREAD, engine),
    cursor: () => f.chats.members(chat.id).find((member) => member.memberId === agent.id)!.readSeq,
    notes: (runId: string) => s.runs.items(runId).filter((item) => item.kind === 'note' && item.name !== 'Answer').map((item) => item.data as Record<string, unknown>),
  };
}

export const textOf = (input: EngineTurnInput | undefined) => (input?.input[0] as { text: string } | undefined)?.text ?? '';
