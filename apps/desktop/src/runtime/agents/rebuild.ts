// Native rebuild of an agent's session from the context ledger (B-048 E2, back 01.11.2026) – the executor's side, called by
// turn-prepare.ts chooseSession. A turn rebuilds when (a) it runs on another engine than the agent's last turn
// ('switch'), or the engine has no usable session while the ledger has items ('no_session' – also after a renewal and in the
// retry after an ended session: owner 13.11.2026, "der Kontext geht nie verloren"),
// or (b) the ledger holds marks the session lacks that take something off it, or the session is past its renewal limit ('marks'):
// no minimum saving (q-r, 03.11.2026: with a gate of max(12k tokens, 25 %) the marks of almost every turn reached the session only every
// third turn, and a chat of medium items never). The engine (caps.rebuild) then
// starts a new native session holding the ledger view; the turn binds it and sends only the new chat lines.
// Owns: that choice (the view → RebuildItem mapping is rebuild-items.ts), the one call naming every condensed or hidden item
// when the ledger holds marks (context/ledger/marks.ts; every rebuild is a new session, and a hidden item leaves no other trace;
// placed in front of the agent's closing words), the size and shrink guards (a history above
// the renewal limit renews instead), the probe per CLI version (kv 'engine-rebuild-probe':
// model-free, once per version, a failed one again after a day), binding the new session (generation + 1; the
// replaced ref is recorded as superseded by sessions.ts), ledger.rebuilt, the run notes {rebuild: 'native' | 'fallback'},
// and the fallback memory (B-080 wave 3): a rebuilt session that ends on its first turn, or a rebuild the engine refuses, blocks
// rebuilds of that chat and engine for 6 h (process memory) – the turn renews as today; a rebuild that only timed out does not
// (a busy app-server; the next turn simply tries again), and a later turn never judges an earlier rebuild after the fact.
// B-049 F7: marks on an engine with caps.revert first keep the session, cut before the turn holding the first change, plus
// the tail (rebuild-revert.ts; note revert: true); any refusal starts a new one as before (note {rebuild: 'revert_fallback'}).
// B-049 F9: a rebuild for marks (same engine) that would not shrink the session – history plus the turn's
// prompt and tools against the context the engine last reported – is skipped (note {rebuild:
// 'skipped', why: 'not smaller than the live context', live, rebuilt}); a switch always rebuilds. A kept probe of an
// older revision (PROBE_REV) runs again once.
// 13.11.2026 (one context per agent): the ledger, the fallback memory and the session are keyed by the turn's thread – the
// agent's main thread, which holds every chat it saw; a split's part never rebuilds. Evening: every rebuild replays the whole
// record (no start after a renewal); the chat lines past their reach (window.ts oldChatLines) are hidden with the lean history.
// B-080 (owner 08.11.2026: no fixed compaction size, "komplett dynamisch"): there is no 64k gate: a history that does not fit the model's window
// (compaction-policy.ts fitLimit) gets its oldest tool work hidden (window.ts fitHides; ledger marks by 'window', named in the
// marks call and restorable) until it fits – only a history whose chat lines alone do not fit falls back ('too_large').
// B-080 wave 3: every size here (history, prompt and tools, the rebuilt binding's context) is in window.ts tokensOf, the unit of the
// engines' own counts – in chars/4 the fit landed at 92–96 % of the window and the guard let a growing rebuild through.
// B-089 (11.11.2026, live 10.11.: every model call re-sends the whole session – Codex p50 145k / p90 356k tokens, Claude p90 505k;
// 136 marks rebuilds skipped, 79 full cold replays, both weekly plans empty in three days): every native rebuild carries the lean
// history – the tool work of finished runs keeps its call in place and leaves its output, their reasoning is hidden (window.ts
// leanMarks; kept in full: this run, the newest run here, every run on this turn's open task, pins), written only once the guards
// let the rebuild run and before the fit, which stays the backstop (note lean: {condensed, hidden, before, after}). On the same
// engine with a usable session below the fit, a rebuild for savings runs when it pays (pays): saves S = the ledger's own plus the lean
// history's, resend R = the rebuilt history plus prompt and tools; a cold cache (CACHE_COLD_MS) needs S > 0 and a smaller session,
// a warm one S × n ≥ 9 × R (n: model calls of the agent's last finished run here – finished work builds up until it pays). S and R come from the ledger's rows (window.ts
// leanRows, rowsResend) – the view and its originals are read only once the rebuild runs. A wait writes {rebuild: 'skipped', why:
// 'does not pay yet'} only while marks of the subconscious wait; a lean saving alone waits in silence.
// Never: starts a turn, lets a failed rebuild fail the turn, or reads provider files.

import type { RuntimeServices } from '../contracts.ts';
import type { Account, EngineId, RouteDecision } from '../../shared/model/providers.ts';
import type { Engine, RebuildItem, RebuildProbe } from '../engines/types.ts';
import type { LedgerItem, LedgerViewItem } from '../../shared/model/context-ledger.ts';
import { historyTokens, rebuildItems } from './rebuild-items.ts'; // B-049 F9: the view → items mapping (nested calls) lives there
import { marksCall, marksOf } from '../context/ledger/marks.ts';
import '../contracts/ledger.ts';
import { KvRepo } from '../store/kv.ts';
import { SessionStore, type SessionBinding } from './sessions.ts';
import { fitLimit } from './compaction-policy.ts';
import { FIT_REASON, LEAN_REASON, LEAN_TEXT, fitHides, leanMarks, leanRows, oldChatLines, rowsResend, tokensOf, type LeanMark } from '../context/ledger/window.ts';
import { turnCwd } from '../git/records.ts';
import type { ToolOffer } from './session-key.ts';
import type { TurnPlan, TurnRequest } from './turn-types.ts';
import { revertPlan } from './rebuild-revert.ts'; // B-049 F7 (with native-turns.ts)
import { keepTurnsBefore } from './native-turns.ts';

export { rebuildItems };
export const PROBE_NS = 'engine-rebuild-probe';
/** B-049 F9: what a probe checks grew (Codex: custom_tool_call items) – a kept probe of an older revision runs again once. */
export const PROBE_REV = 2;
const PROBE_RETRY_MS = 24 * 60 * 60 * 1000;
const BLOCK_MS = 6 * 60 * 60 * 1000;
const LAST_RUNS = 50;
const MEMORY = 500;
/** B-089: a provider's prompt cache lives at most about an hour – a session resting longer meets a cold cache on its next call. */
export const CACHE_COLD_MS = 60 * 60_000;
/** B-089: an uncached input token costs ten cached ones at Anthropic and OpenAI; the rebuild itself is the one uncached re-send
 *  beyond what a cached call would cost (10 − 1 = 9). */
export const CACHED_PRICE_RATIO = 9;

export type RebuildWhy = 'switch' | 'no_session' | 'marks';

/** Process memory: the run that last rebuilt each chat and engine (rebuildFellBack), chats whose rebuild failed, running probes. */
const pending = new Map<string, string>();
const blocked = new Map<string, number>();
const probing = new Map<string, Promise<RebuildProbe>>();
const probedHere = new Map<string, RebuildProbe>(); // versions the CLI did not name: kept for this process only
const overrated = new Map<string, number>(); // B-089: per chat and engine, the rows' saving the view last refused (not read again for less)

const keyOf = (agentId: string, conversationId: string, engine: EngineId) => `${agentId}|${conversationId}|${engine}`;
/** B-080: the engine did not answer in time (a busy app-server, codex/rpc.ts -32000) – no refusal, so nothing is kept or blocked for it. */
const timedOut = (reason?: string) => /did not answer|timed? ?out|timeout/i.test(reason ?? '');
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MEMORY) map.delete(map.keys().next().value!);
}

/** Forgets the process memory (tests). */
export function resetRebuildMemory(): void {
  pending.clear(); blocked.clear(); probing.clear(); probedHere.clear(); overrated.clear();
}

/** The engine of the agent's last turn (this run excluded; B-057 S9: never a split's run – its engine is no route memory). */
export function lastEngine(services: Pick<RuntimeServices, 'runs'>, agentId: string, runId: string): EngineId | undefined {
  try {
    const runs = services.runs.listTopLevel?.(agentId, LAST_RUNS) ?? services.runs.list(agentId, LAST_RUNS);
    return runs.find((run) => run.id !== runId && !run.splitId && run.engine && run.status !== 'queued')?.engine;
  } catch { return undefined; }
}

/**
 * The call naming every condensed or hidden item the ledger holds (none without marks). Every rebuild starts from the whole view,
 * where a hidden item leaves no trace but this. `since` (the first changed order, 0 without new marks) only names the call.
 */
export function marksItem(services: RuntimeServices, agentId: string, conversationId: string, since: number): RebuildItem | undefined {
  const call = marksCall(marksOf(services, agentId, conversationId));
  return call && { itemId: `marks${since}`, kind: 't', role: 'tool', text: call.output, call: { name: call.tool, args: call.args, callId: `call_context_marks_${since}`, output: call.output } };
}

/**
 * The history with the marks call in front of the agent's closing words (its trailing text, reasoning or own chat
 * lines without a call), so the rebuilt history still ends at the agent's own answer – a clean turn boundary.
 */
export function withMarks(items: RebuildItem[], marks: RebuildItem | undefined): RebuildItem[] {
  if (!marks) return items;
  let at = items.length;
  while (at > 0 && items[at - 1].role === 'assistant' && !items[at - 1].call) at--;
  return [...items.slice(0, at), marks, ...items.slice(at)];
}

/** The probe of `engine`'s rebuild for its CLI version: kv per version; a failed one again after a day; one at a time. */
export async function probeFor(services: RuntimeServices, engine: Engine, account: Account, cwd: string): Promise<RebuildProbe> {
  const now = services.clock.now();
  if (!engine.probeRebuild) return { version: 'none', ok: true, at: now };
  const version = (await engine.rebuildVersion?.(account).catch(() => undefined)) ?? 'unknown';
  const key = `${engine.id}@${version}`;
  const kv = new KvRepo(services.db);
  const cached = version === 'unknown' ? probedHere.get(key) : kv.get<RebuildProbe & { rev?: number }>(PROBE_NS, key);
  if (cached && (cached as { rev?: number }).rev === PROBE_REV && (cached.ok || now - cached.at < PROBE_RETRY_MS)) return cached;
  let running = probing.get(key);
  if (!running) {
    running = engine.probeRebuild(account, cwd).then((probe) => {
      const kept = { ...probe, version: probe.version || version, at: services.clock.now(), rev: PROBE_REV };
      // B-080: a probe that only timed out (a busy moment of the CLI) is not kept – the next rebuild probes again instead of a day without
      if (!kept.ok && timedOut(kept.reason)) { /* not kept */ }
      else if (version === 'unknown') remember(probedHere, key, kept);
      else kv.set(PROBE_NS, key, kept, services.clock.now());
      services.log.info('rebuild probe', { engine: engine.id, version, ok: kept.ok, ...(kept.reason ? { reason: kept.reason } : {}) });
      return kept;
    }).finally(() => probing.delete(key));
    probing.set(key, running);
  }
  return running;
}

/**
 * B-049 F9 guard: a rebuild for marks on the same engine must shrink the session – the rebuilt history plus the turn's
 * prompt and tool definitions below the context the engine last reported for the session (`live`). Unknown when the
 * engine reported none.
 */
export function shrinks(live: number | undefined, history: number, overhead: number): { ok: boolean; live?: number; rebuilt: number } {
  const rebuilt = history + overhead;
  if (!live || live <= 0) return { ok: true, rebuilt };
  return { ok: rebuilt < live, live, rebuilt };
}

/** The turn's prompt sections and native tool definitions in tokens (the rebuilt session starts with them). */
function overheadTokens(input: Pick<NativeRebuildInput, 'prompt' | 'offer'>): number {
  let tools = 0;
  try { tools = (JSON.stringify(input.offer.native ?? []) ?? '').length; } catch { tools = 0; }
  return tokensOf(input.prompt.stable.length + input.prompt.volatile.length + tools);
}

function note(services: RuntimeServices, runId: string, data: Record<string, unknown>): void {
  try { services.runs.item(runId, { kind: 'note', data, effectStatus: 'none' }); } catch { /* journal only */ }
}

/**
 * renewSession's hook for a session that ended in this run (overflow): the run's retry rebuilds from the record; when this run
 * had rebuilt that session, its first turn failed – note the fallback and block rebuilds of the thread and engine for a while
 * (the retry then gets the record as text, agents/history-text.ts). B-080 wave 3: the only judge of a rebuilt session's first turn – an interrupted run
 * (a Stop, the agent's own model.set now:true, a steer restart) or a next turn under a changed prompt says nothing about it.
 */
export function rebuildFellBack(services: RuntimeServices, agentId: string, thread: string | undefined, engine: EngineId, runId: string): boolean {
  const key = keyOf(agentId, thread ?? '', engine);
  if (pending.get(key) !== runId) return false;
  pending.delete(key);
  remember(blocked, key, services.clock.now() + BLOCK_MS);
  note(services, runId, { rebuild: 'fallback', reason: 'first_turn_error' });
  return true;
}

export interface NativeRebuildInput {
  plan: TurnPlan;
  request: TurnRequest;
  engine: Engine;
  account: Account;
  route: RouteDecision;
  /** Provider model id of the turn. */
  model: string;
  /** The usable binding of this engine and account (none after a renewal or for another account). */
  session?: SessionBinding;
  offer: ToolOffer;
  /** The turn's prompt as the engine gets it (the volatile part as buildTurn ends it). */
  prompt: { stable: string; volatile: string };
  promptKey: string;
  contextWindow?: number;
  /** The renewal this choice made first (a new prompt or mode). */
  renewed?: 'mode' | 'prompt';
  /** The session no longer fits the model's window (pastFit): any marks are worth a rebuild, the renewal only follows when nothing brings it in. */
  overLimit?: boolean;
}

/** Rebuilds the turn's native session from the ledger when one of the cases holds; undefined: today's path. */
export async function nativeRebuild(services: RuntimeServices, input: NativeRebuildInput): Promise<{ session: SessionBinding; sinceSeq: number } | undefined> {
  const { plan, request, engine, account, session } = input;
  const conversationId = plan.thread; // the ledger's key (the agent's main thread)
  const ledger = services.ledger;
  if (plan.split || !conversationId || !engine.caps.rebuild || !engine.rebuild || !ledger) return undefined;
  const agentId = plan.agent.id;
  const key = keyOf(agentId, conversationId, engine.id);
  if ((blocked.get(key) ?? 0) > services.clock.now()) return undefined;

  const last = lastEngine(services, agentId, request.runId);
  let need: ReturnType<typeof ledger.needsRebuild>;
  try { need = ledger.needsRebuild(agentId, conversationId, 0); } catch { need = undefined; }
  // B-080: past the fit the rebuild always runs (its fit hides the oldest tool work), with or without new marks. B-089: on the same
  // engine with a usable session below the fit it runs when it pays (weighed below, once the view is read).
  const why: RebuildWhy = last && last !== engine.id ? 'switch' : !session ? 'no_session' : 'marks';
  const forced = why !== 'marks' || input.overLimit === true;
  const fallback = (reason: string) => { note(services, request.runId, { rebuild: 'fallback', why, reason }); return undefined; };
  const overhead = overheadTokens(input);
  let rowsSaves = 0;
  if (!forced && session) { // B-089: weighed from the ledger's rows – no original is read for a turn that keeps its session
    let rows: LedgerItem[] = [];
    try { rows = ledger.items(agentId, conversationId); } catch { rows = []; }
    const keep = keptByFit(ledger, agentId, conversationId, rows, request.runId, rows);
    const estimate = [...leanRows(rows, leanKeep(services, plan, rows, keep, request.runId)), ...oldChatLines(rows, keep.pinned)];
    const leanSaving = estimate.reduce((sum, mark) => sum + mark.saves, 0);
    // A restore alone reaches the main AI as a call and moves its items back into place (its result condensed, context/ledger/capture.ts):
    // it rides along with the next saving (q-r2d s15: a restore made in a script kept its result in full, so it counted as a cost only).
    const saves = (need?.saves ?? 0) + leanSaving;
    if ((need?.marked === false && leanSaving <= 0) || saves <= 0) return undefined;
    const resend = rowsResend(rows, estimate) + overhead;
    // A view that refused this saving is not read again until the rows show clearly more (they count a call's arguments, which the
    // lean form keeps); nor is one read for a rebuild the rows already size no smaller than the live session.
    if (saves <= (overrated.get(key) ?? 0) * 1.25 || (session.contextTokens && resend >= session.contextTokens)) return undefined;
    rowsSaves = saves;
    const weighed = pays(services, session, { saves, resend, agentId, conversationId, runId: request.runId });
    if (!weighed.ok) { // the journal names a wait only when the subconscious's marks are the ones waiting
      if (need?.marked) note(services, request.runId, { rebuild: 'skipped', why: 'does not pay yet', saves, resend, calls: weighed.calls });
      return undefined;
    }
  }

  let split: ReturnType<typeof rebuildItems> = { items: [] };
  let entries: LedgerViewItem[] = [];
  const read = () => { entries = ledger.view(agentId, conversationId); split = rebuildItems(entries); };
  try { read(); } catch (error) { return fallback(`ledger: ${String(error).slice(0, 120)}`); }
  if (!split.items.length) return undefined; // nothing of the agent's own work to replay: today's path
  let since = need?.since ?? 0;
  let marks = marksItem(services, agentId, conversationId, since);
  const history = () => withMarks(split.items, marks);
  let items = history();
  let tokens = historyTokens(items);
  // B-089: the lean history – only the tool work of unfinished work stays in full (window.ts leanMarks); sized here, written below
  const fitKeep = keptByFit(ledger, agentId, conversationId, entries, request.runId);
  const lean: LeanMark[] = [...leanMarks(entries, leanKeep(services, plan, entries, fitKeep, request.runId)), ...chatReach(ledger, agentId, conversationId, entries, fitKeep.pinned)];
  const leaned = Math.max(0, tokens - lean.reduce((sum, mark) => sum + mark.saves, 0));
  let leanNote: { condensed: number; hidden: number; before: number; after: number } | undefined;
  let probe: RebuildProbe | undefined;
  if (!forced && session) {
    // B-089: weighed again with the view's own figures (the rows overrate a call with long arguments); a refusal is remembered
    const exact = (need?.saves ?? 0) + (tokens - leaned);
    if (exact <= 0 || !pays(services, session, { saves: exact, resend: leaned + overhead, agentId, conversationId, runId: request.runId }).ok) { remember(overrated, key, rowsSaves); return undefined; }
    const guard = shrinks(session.contextTokens, leaned, overhead); // B-049 F9: compaction never makes the session bigger (checked before anything is written)
    if (!guard.ok) { note(services, request.runId, { rebuild: 'skipped', why: 'not smaller than the live context', live: guard.live, rebuilt: guard.rebuilt }); return undefined; }
  }
  // B-080: sized by the rebuilt history (what the old session measured says nothing about the part the rebuild replays)
  const room = fitLimit(input.contextWindow) - overhead;
  if (lean.length) { // B-089: written only once the rebuild runs – a fit that could not bring the lean history in leaves it unwritten
    const leanIds = new Set(lean.map((mark) => mark.itemId));
    if (leaned > room && !fitHides(entries.filter((entry) => !leanIds.has(entry.itemId)), leaned - room, fitKeep).length) return fallback('too_large');
    probe = await probeOf(services, input);
    if (!probe.ok) return fallback(`probe ${probe.version}: ${probe.reason ?? 'failed'}`);
    try {
      ledger.mark(agentId, conversationId, lean.map((mark) => (mark.state === 'condensed'
        ? { itemId: mark.itemId, state: 'condensed' as const, by: 'window' as const, condensed: mark.text ?? LEAN_TEXT, reason: LEAN_REASON }
        : { itemId: mark.itemId, state: 'hidden' as const, by: 'window' as const, reason: mark.reason ?? LEAN_REASON })));
      const first = entries.find((entry) => entry.itemId === lean[0].itemId)?.order;
      if (first !== undefined) since = since > 0 ? Math.min(since, first) : first; // a revert cuts before the first item that changed
      read();
      marks = marksItem(services, agentId, conversationId, since);
      items = history();
      const before = tokens;
      tokens = historyTokens(items);
      leanNote = { condensed: lean.filter((mark) => mark.state === 'condensed').length, hidden: lean.filter((mark) => mark.state === 'hidden').length, before, after: tokens };
    } catch (error) { return fallback(`lean: ${String(error).slice(0, 120)}`); }
  }
  const excess = tokens - room;
  if (excess > 0) { // the oldest tool work goes first, as much as needed – the chat lines, the newest turn and pins stay
    const hidden = fitHides(entries, excess, keptByFit(ledger, agentId, conversationId, entries, request.runId));
    if (!hidden.length) return fallback('too_large');
    try {
      ledger.mark(agentId, conversationId, hidden.map((itemId) => ({ itemId, state: 'hidden' as const, by: 'window' as const, reason: FIT_REASON })));
      const first = entries.find((entry) => entry.itemId === hidden[0])?.order;
      if (first !== undefined) since = since > 0 ? Math.min(since, first) : first; // a revert cuts before the first item that changed
      read();
      marks = marksItem(services, agentId, conversationId, since);
      items = history();
      const before = tokens;
      tokens = historyTokens(items);
      note(services, request.runId, { fit: { hidden: hidden.length, before, after: tokens, room } });
    } catch (error) { return fallback(`fit: ${String(error).slice(0, 120)}`); }
    if (tokens > room) return fallback('too_large');
  }

  const cwd = turnCwd(services, plan.task, agentId);
  probe ??= await probeOf(services, input);
  if (!probe.ok) return fallback(`probe ${probe.version}: ${probe.reason ?? 'failed'}`);

  const store = new SessionStore(services.db);
  const previous = session ?? store.get(agentId, conversationId, engine.id);
  let result: Awaited<ReturnType<NonNullable<Engine['rebuild']>>> | undefined;
  const base = {
    runId: request.runId, agentId, account, model: input.model, cwd, items, tools: input.offer.native, toolNames: input.offer.names,
    system: input.prompt, generation: (previous?.generation ?? 0) + 1, probe,
  };
  // B-049 F7: marks on an engine that can revert keep the session and its prompt cache (rebuild-revert.ts); any refusal starts a new one.
  const turnKey = { agentId, conversationId, engine: engine.id };
  const revert = why === 'marks' && session && engine.caps.revert ? revertPlan(services, turnKey, session.ref, since, entries, split.items) : undefined;
  if (revert && session) {
    try { result = await engine.rebuild({ ...base, items: withMarks(revert.items, marks), revert: { ref: session.ref, beforeTurn: revert.turn } }); } catch (error) {
      note(services, request.runId, { rebuild: 'revert_fallback', reason: error instanceof Error ? error.message.slice(0, 200) : 'failed' });
    }
  }
  const reverted = result !== undefined;
  if (!result) {
    try { result = await engine.rebuild(base); } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : 'failed';
      // A refusal is not tried again every turn (each try starts and deletes a session); B-080 wave 3: a rebuild that only timed out is.
      if (!timedOut(reason)) remember(blocked, key, services.clock.now() + BLOCK_MS);
      return fallback(reason);
    }
  }
  const binding: SessionBinding = {
    agentId, conversationId, engine: engine.id, accountId: account.id, ref: result.ref, generation: result.generation, cursorSeq: plan.memberCursor,
    // B-080 wave 3: the whole context the session starts with (history plus prompt and tools) until the engine reports its own
    contextTokens: tokens + overhead, model: input.route.modelId, promptKey: input.promptKey, mode: plan.mode.key, updatedAt: services.clock.now(),
  };
  store.save(binding);
  if (reverted && revert) keepTurnsBefore(services.db, turnKey, result.ref, revert.turn, services.clock.now()); // B-049 F7: the cut turns are gone
  try {
    const upTo = ledger.items(agentId, conversationId).reduce((max, item) => Math.max(max, item.order), 0);
    if (upTo > 0) ledger.rebuilt(agentId, conversationId, upTo);
  } catch (error) { services.log.warn('marking the ledger rebuilt failed', { agentId, error: String(error) }); }
  remember(pending, key, request.runId);
  overrated.delete(key);
  note(services, request.runId, {
    rebuild: 'native', why, engine: engine.id, items: result.items, generation: result.generation, tokens,
    ...(last && last !== engine.id ? { from: last } : {}), ...(marks ? { marks: true } : {}), ...(probe.tier ? { tier: probe.tier } : {}),
    ...(reverted && revert ? { revert: true, fromOrder: revert.from } : {}), ...(leanNote ? { lean: leanNote } : {}),
  });
  return { session: binding, sinceSeq: plan.memberCursor };
}

/** The view's chat lines past their reach (window.ts oldChatLines), sized as the rebuilt history counts them. */
function chatReach(ledger: NonNullable<RuntimeServices['ledger']>, agentId: string, thread: string, entries: readonly LedgerViewItem[], pinned: ReadonlySet<string>): LeanMark[] {
  let rows: LedgerItem[] = [];
  try { rows = ledger.items(agentId, thread, { kinds: ['message'] }); } catch { return []; }
  const shown = new Map(entries.map((entry) => [entry.itemId, entry]));
  return oldChatLines(rows, pinned).filter((mark) => shown.has(mark.itemId)).map((mark) => ({ ...mark, saves: tokensOf(shown.get(mark.itemId)!.text.length) }));
}

/**
 * B-089: the runs whose tool work the lean history keeps in full – this run, the newest run here (as the fit finds it) and every
 * run on this turn's task while that task is open; with the fit's pins (the closing words, what the main AI brought back).
 */
export function leanKeep(services: Pick<RuntimeServices, 'runs'>, plan: Pick<TurnPlan, 'task'>, entries: readonly { runId?: string }[], fit: { newestRun?: string; pinned: Set<string> }, runId: string): { runs: Set<string>; pinned: Set<string> } {
  const runs = new Set([runId, ...(fit.newestRun ? [fit.newestRun] : [])]);
  const task = plan.task && plan.task.status !== 'done' && plan.task.status !== 'dropped' ? plan.task.id : undefined;
  if (task) {
    for (const id of new Set(entries.map((entry) => entry.runId).filter((id): id is string => Boolean(id) && !runs.has(id!)))) {
      try { if (services.runs.get(id)?.taskId === task) runs.add(id); } catch { runs.add(id); } // unknown: kept, never set aside by guess
    }
  }
  return { runs, pinned: fit.pinned };
}

/**
 * B-089: does a rebuild for savings pay? A cold cache (the session rested past CACHE_COLD_MS) sends the next call uncached either
 * way: any saving pays. Warm, the next calls re-send the session cached at a tenth of the price, the rebuild re-sends `resend`
 * uncached once: it pays when `saves` × the calls of a run (modelCalls) ≥ CACHED_PRICE_RATIO × `resend`.
 */
function pays(services: RuntimeServices, session: SessionBinding, input: { saves: number; resend: number; agentId: string; conversationId: string; runId: string }): { ok: boolean; calls?: number } {
  if (services.clock.now() - session.updatedAt > CACHE_COLD_MS) return { ok: true };
  const calls = modelCalls(services, input.agentId, input.runId, session.contextTokens);
  return { ok: input.saves * calls >= CACHED_PRICE_RATIO * input.resend, calls };
}

/**
 * B-089: the model calls of the agent's last finished run (at least 1) – its own count where its engine reported one
 * (runs.model_calls), else its input over the session's context. One run, not an hour of them: a rebuild is possible at every turn,
 * so what it gains over waiting is one turn's calls – the saving of finished runs then builds up until it pays, and rebuilds batch.
 */
function modelCalls(services: Pick<RuntimeServices, 'runs'>, agentId: string, runId: string, context?: number): number {
  try {
    const runs = services.runs.listTopLevel?.(agentId, LAST_RUNS) ?? services.runs.list(agentId, LAST_RUNS);
    const run = runs.find((candidate) => candidate.id !== runId && !candidate.splitId && candidate.status === 'done');
    return Math.max(1, run?.modelCalls || (context && context > 0 ? Math.round((run?.inputTokens ?? 0) / context) : 1));
  } catch { return 1; }
}

/** The probe of the turn's engine (a throw reads as a failed probe). */
function probeOf(services: RuntimeServices, input: NativeRebuildInput): Promise<RebuildProbe> {
  const cwd = turnCwd(services, input.plan.task, input.plan.agent.id);
  return probeFor(services, input.engine, input.account, cwd).catch((error): RebuildProbe => ({ version: 'unknown', ok: false, reason: String(error).slice(0, 120), at: services.clock.now() }));
}

/**
 * What the fit leaves in place besides chat lines: the newest turn here (its run, not this one), the history's closing words (the
 * last item of the agent's own work – without them the lines before it would fall back to the delta) and what the main AI brought back.
 */
function keptByFit(
  ledger: NonNullable<RuntimeServices['ledger']>, agentId: string, conversationId: string, entries: readonly Pick<LedgerViewItem, 'itemId' | 'kind' | 'runId' | 'order'>[], runId: string,
  rows?: readonly LedgerItem[], // B-089: the rows already read (the check before the view); their hidden ones are not in a view
): { newestRun?: string; pinned: Set<string> } {
  const own = [...entries].reverse().filter((entry) => entry.kind !== 'message' && !(rows && (entry as LedgerItem).state === 'hidden'));
  const newestRun = own.find((entry) => entry.runId && entry.runId !== runId)?.runId;
  let pinned = new Set<string>();
  try { pinned = new Set((rows ?? ledger.items(agentId, conversationId, { since: entries[0]?.order ?? 0 })).filter((item) => item.pinnedUntil !== undefined).map((item) => item.itemId)); } catch { /* none known */ }
  if (own[0]) pinned.add(own[0].itemId);
  return { ...(newestRun ? { newestRun } : {}), pinned };
}
