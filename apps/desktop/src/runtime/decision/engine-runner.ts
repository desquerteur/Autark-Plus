// StructuredRunner over the real engines: routes a clean-context, tool-less turn to the
// cheapest suitable model (category 'cheap-chat', economy) and returns its (structured) answer.
// Up to 'strong' first; when nothing in that band is usable (e.g. only frontier models are
// connected, or all their accounts are limited) the economy pick of any tier. Used by the subconscious, the LLM
// decision fallback, the verifier and widget fills. Its listening turn (MM10) is listener.ts.
// The model is the Decisions use (settings.json routing.decision; "auto" = the helper default below) – the router's
// Settings use pin (routing/pins.ts), falling back to the cheap pick with a reason when it is not usable.
// SG: without an explicit choice the router prefers the helper default (routing/helper-default.ts:
// a Codex plan's small model at low effort); a caller's `effort` reaches it as an effort-only
// request (RouteRequest.previous asked 'effort'), and the answer says which effort ran and which
// efforts the model supports (so a retry at a higher effort is skipped when it would be the same).
// Every helper turn works in a folder of its own, <temp>/helper (HELPER_DIR, made again when the
// scratch folder lost it), so whatever an engine writes there never lands at the temp root, where
// uploads, opened copies and the CLIs' status probes live.
// A helper call that fails because of its account (limit, unavailable – accounts/failure.ts, the same rule
// as agent turns) records that on the account like an agent turn does (cooling, needs_login with the one
// sign-in to-do, error), so the router and later helper calls skip it, and goes once to another account.
// One time limit (`timeoutMs`) covers both attempts and the caller's signal cuts both; the account's
// limits the engine reports during a call are kept (updateLimits).
// A caller's deadline (`deadlineMs`) is part of the call's time limit: the call ends when it passes.
// B-089 (11.11.2026: live 09.–10.11. 177 decisions ended "The turn was stopped" – the 90 s default cut tool-timeout
// reviews that had 120 s; on 07.11. a 402 went over to a second connection with the same key and got 402 again):
// a caller's deadline is the call's time limit (the 90 s default holds only without one; an explicit `timeoutMs`
// still caps it); a failed account's consequence also lands on every connection with the same key and address
// (one account at the provider), the failover skips them all, and `log` says which way answered.
// What a call used goes to `onUsage` and with its answer as the engine reported it: all input, the cached part of it, the output.
// B-078 D14: a caller's `temperature` goes with the engine turn; an engine that takes one honours it, the others ignore it.
// KI-Runde 17.11.2026 (decision 7.1): createChatOpener keeps one such lean conversation open for as long as a call runs –
// it opens at the call's start, its stable part is sent once, each spoken line is one input on the kept session, and the
// text reaches the caller as the model writes it (calls/talker.ts). A stopped line keeps the session; a session that is
// gone, and an engine that keeps none, get the call so far as text. A lane that runs out goes once to another account.
// What each line used (model, kept, time to the first text, tokens) is one 'call voice line' in the log.
// Owns: the synthetic runtime agent, the one-shot engine call, the kept call conversation, and its one failover.
// Never: tools, sessions, approvals (every native approval is denied), the agent's own context.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from '../../shared/model/org.ts';
import type { Account, Effort, EngineId, RouteDecision } from '../../shared/model/providers.ts';
import type { AccountService, Clock, EngineRegistry, Logger, ModelCatalog, NotificationService, Paths, RouteRequest, Router } from '../contracts.ts';
import type { EngineEvent, EngineTurnResult, TurnInputItem } from '../engines/types.ts';
import { accountFailure, recordAccountFailure } from '../accounts/failure.ts';
import { cachedInput } from '../engines/shared.ts';
import { GENERAL_MODE } from '../modes/service.ts';
import { SYSTEM_ID, newId } from '../../shared/ids.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { failure } from '../tools/types.ts';
import type { StructuredRunner } from './types.ts';

/** The runtime itself as a routing subject (economy; never above 'strong' unless `anyTier`). */
export function runtimeAgent(now: number, anyTier = false): Agent {
  const band = anyTier ? { costMode: 'economy' as const } : { costMode: 'economy' as const, ceilingTier: 'strong' as const };
  return {
    id: SYSTEM_ID, name: 'Runtime', role: 'runtime helper', avatar: { kind: 'initials', value: 'R' }, instructions: '',
    mode: 'general', skills: [], modelPolicy: band,
    status: 'idle', createdBy: SYSTEM_ID, createdAt: now, updatedAt: now,
  };
}

/** Cheap/strong band first; nothing usable there → the best-value (economy) model of any tier. */
export async function routeHelper(deps: Pick<EngineRunnerDeps, 'router' | 'clock'>, purpose: string, extra: Pick<RouteRequest, 'needs' | 'exclude'>, effort?: Effort): Promise<RouteDecision> {
  const request = (anyTier: boolean): RouteRequest => ({
    agent: runtimeAgent(deps.clock.now(), anyTier),
    mode: { ...GENERAL_MODE, category: 'cheap-chat' },
    text: purpose,
    ...(effort ? { previous: { modelId: '', effort, explicit: true, asked: 'effort' as const } } : {}),
    ...extra,
  });
  try {
    return await deps.router.route(request(false));
  } catch (error) {
    if (!(error instanceof WorkforceError) || error.code !== 'unavailable') throw error;
    return deps.router.route(request(true));
  }
}

export interface EngineRunnerDeps {
  engines: EngineRegistry;
  router: Router;
  /** markLimited/markUnavailable: a failed attempt's account consequence; updateLimits: limits reported during a call. */
  accounts: Pick<AccountService, 'get' | 'markLimited' | 'markUnavailable' | 'updateLimits'> & Partial<Pick<AccountService, 'list'>>;
  catalog: Pick<ModelCatalog, 'get'>;
  paths: Pick<Paths, 'temp'>;
  clock: Clock;
  /** One time limit for the whole call, a failover's second attempt included (default 90 s). */
  timeoutMs?: number;
  /** The "Sign in to …" to-do when a helper call finds a plan signed out (accounts/failure.ts); missing = the state alone shows it. */
  notifications?: Pick<NotificationService, 'notify'>;
  /** What an attempt used, for who books it (the subconscious's runs: the spend journal). */
  onUsage?: (entry: { account: Account; route: RouteDecision; usage: NonNullable<EngineTurnResult['usage']> }) => void;
  /** B-089: the line that says which way answered after a failover. */
  log?: Pick<Logger, 'info'>;
}

/** B-089: the connections that are the same account at the provider as `account` (same key and address), itself excluded. */
function sameKey(deps: Pick<EngineRunnerDeps, 'accounts'>, account: Account): Account[] {
  if (!account.secretId) return [];
  let all: Account[] = [];
  try { all = deps.accounts.list?.() ?? []; } catch { return []; }
  // without an address of its own a connection's address is its provider's: the same key then means the same account only there
  return all.filter((other) => other.id !== account.id && other.secretId === account.secretId && (other.baseUrl ?? '') === (account.baseUrl ?? '')
    && (account.baseUrl ? true : other.provider === account.provider));
}

/** B-089: the call's time limit – the caller's deadline when it names one (an explicit `timeoutMs` still caps it), else `timeoutMs` or 90 s. */
export function callLimitMs(deps: Pick<EngineRunnerDeps, 'timeoutMs'>, deadlineMs?: number): number {
  const deadline = deadlineMs !== undefined && Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : undefined;
  if (deadline === undefined) return deps.timeoutMs ?? 90_000;
  return Math.min(deps.timeoutMs ?? Infinity, deadline);
}

/** The folder below temp that helper turns work in (never the temp root). */
export const HELPER_DIR = 'helper';

/** The signal of one helper call: its time limit (callLimitMs) and the caller's own signal. */
export function callSignal(deps: Pick<EngineRunnerDeps, 'timeoutMs'>, signal: AbortSignal | undefined, deadlineMs?: number): AbortSignal {
  const limit = callLimitMs(deps, deadlineMs);
  const timeout = AbortSignal.timeout(Math.max(1, Math.round(limit)));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** One tool-less engine turn on a routed account and model – session-less, or on the kept session of a call's voice (`session`, `keep`). */
export async function runOnce(deps: Pick<EngineRunnerDeps, 'engines' | 'paths' | 'clock'>, engine: EngineId, target: { account: Account; model: string; effort: Effort },
  turn: { system: string; input: TurnInputItem[]; schema?: Record<string, unknown>; signal: AbortSignal; onEvent?: (event: EngineEvent) => void; temperature?: number;
    session?: { ref: string; generation: number }; keep?: true }): Promise<EngineTurnResult> {
  const cwd = path.join(deps.paths.temp, HELPER_DIR);
  await mkdir(cwd, { recursive: true, mode: 0o700 }); // temp is scratch: the folder may be gone
  return deps.engines.get(engine).run({
    runId: newId('run', deps.clock.now()),
    agentId: SYSTEM_ID,
    ...target,
    system: { stable: turn.system, volatile: '' },
    input: turn.input,
    tools: [],
    callTool: async () => failure('No tools in this call.'),
    cwd,
    outputSchema: turn.schema,
    readOnly: true,
    onEvent: turn.onEvent ?? (() => {}),
    signal: turn.signal,
    ...(turn.session ? { session: turn.session } : {}),
    ...(turn.keep ? { keep: turn.keep } : {}),
    ...temperatureOf(turn.temperature), // B-078 D14: an engine that takes a temperature reads it, the others ignore the field
  });
}

/** `{ temperature }` for a finite value in 0–2, else nothing. */
function temperatureOf(value: number | undefined): Record<string, number> {
  return typeof value === 'number' && Number.isFinite(value) ? { temperature: Math.max(0, Math.min(2, value)) } : {};
}

export function createEngineRunner(deps: EngineRunnerDeps): StructuredRunner {
  return async ({ purpose, system, prompt, schema, signal, effort, deadlineMs, temperature }) => {
    const cut = callSignal(deps, signal, deadlineMs); // one time limit for both attempts
    const needs = schema ? { structured: true } : undefined;
    const attempt = async (route: RouteDecision) => {
      const account = deps.accounts.get(route.accountId);
      const model = deps.catalog.get(route.modelId);
      if (!account || !model) throw new Error('structured runner: routed account/model vanished');
      const onEvent = (event: EngineEvent) => {
        if (event.type !== 'limits') return;
        try { deps.accounts.updateLimits(account.id, event.limits); } catch { /* bookkeeping only */ }
      };
      const result = await runOnce(deps, route.engine, { account, model: model.model, effort: route.effort }, { system, input: [{ type: 'text', text: prompt }], schema, signal: cut, onEvent, temperature });
      // What the attempt says about its account counts like an agent turn's, so the router skips that account next.
      if (result.usage) { try { deps.onUsage?.({ account, route, usage: result.usage }); } catch { /* bookkeeping only */ } }
      const failure = accountFailure(result);
      const twins = failure ? sameKey(deps, account) : [];
      if (failure) {
        // B-089: the same key at the same address is one account at the provider – its credit, limit or rejection is theirs too.
        for (const one of [account, ...twins]) { try { recordAccountFailure(deps, one, model.model, result); } catch { /* bookkeeping only: the call's own error still reaches the caller */ } }
      }
      return { route, model, result, failure, twins };
    };
    let done = await attempt(await routeHelper(deps, purpose, { needs }, effort));
    // One failover like an agent turn's: a used-up or unreachable account goes once to another one, within the same time limit.
    if (done.failure && !cut.aborted) {
      const first = done;
      const away = [first.route.accountId, ...first.twins.map((one) => one.id)];
      const other = await routeHelper(deps, purpose, { needs, exclude: away }, effort).catch(() => undefined);
      if (other && !away.includes(other.accountId) && !cut.aborted) {
        done = await attempt(other);
        if (!done.failure && done.result.stop === 'done') {
          try { deps.log?.info('helper call answered by another way', { purpose, failed: `${first.route.modelId} (${first.failure})`, by: other.modelId }); } catch { /* log only */ }
        }
      }
    }
    const { route, model, result } = done;
    if (result.stop !== 'done') throw new Error(`structured runner: ${result.error?.message ?? result.stop} (${route.modelId})`); // B-089: the log names the way that failed
    return { text: result.text, structured: result.structured, by: route.modelId, effort: route.effort, efforts: model.efforts, ...(result.usage ? { usage: result.usage } : {}) };
  };
}

// ------------------------------------------------------------------ KI-Runde 17.11.2026: a conversation kept for a call

/**
 * One line said to a kept conversation: its text, the caller's signal and budget, and the answer as it is written –
 * `onRestart` comes before a line that runs once more (a session that is gone, another account): its text starts anew.
 */
export interface ChatLine { input: string; signal?: AbortSignal; deadlineMs?: number; onText?: (delta: string) => void; onRestart?: () => void }

/** What one line answered: the whole text, the model that said it, and whether the session carried the earlier lines. */
export interface ChatSaid { text: string; by: string; kept: boolean }

/** A small model's conversation that lives as long as a call (calls/talker.ts): opened once with its stable part, one input per spoken line. */
export interface KeptChat {
  /** The call started: the lane is routed and, where the engine can, the session opens before the first line. Never throws. */
  open(): void;
  /** One line; lines run one after the other, so a stopped line has ended before the next one runs on its session. */
  say(line: ChatLine): Promise<ChatSaid>;
  /** The call ended: the session is let go (a shared process frees it where it can), also one a line still opens. */
  close(): void;
}

/** Opens such a conversation: its purpose for the route, its stable part as the system prompt and the effort it runs at. */
export type ChatOpener = (open: { purpose: string; system: string; effort?: Effort }) => KeptChat;

/** How the call so far opens a line that has no kept session to carry it. */
const EARLIER = 'Earlier in this call, in order:';
const ANSWERED = 'I answered:';
const EARLIER_LINES = 24;
const EARLIER_CHARS = 8000;

/** The route and session one kept conversation runs on. */
interface Held { route: RouteDecision; account: Account; model: string; session?: { ref: string; generation: number } }

/** One line's run on a held route: whether a session carried it, and what the engine answered. */
interface Ran { on: Held; kept: boolean; result: EngineTurnResult }

/**
 * A kept, tool-less conversation on the helper lane (routeHelper, as one-shot helper calls): the call's start routes it and
 * opens the session where the engine can (Engine.keepOpen), else the first line does; each later line is one input on it,
 * and the text reaches `onText` as the model writes it. A stopped line keeps the session. A session that is gone ('conflict':
 * its process ended or idled out) is noticed, and the line runs once more on a new one with the call so far in front – as
 * every line on an engine that keeps no session. A line whose account fails is recorded as a helper call records it and runs
 * once more on another account; when none can run, it fails as 'unavailable'. A line that runs once more calls `onRestart`
 * first, so its text starts anew. Nothing it opened outlives `close`.
 */
export function createChatOpener(deps: EngineRunnerDeps): ChatOpener {
  return ({ purpose, system, effort }) => {
    let held: Held | undefined;
    let closed = false;
    let queue: Promise<unknown> = Promise.resolve();
    const earlier: string[] = []; // the lines of this call and what I answered, for a turn that has no kept session
    const drop = (on: Held, ref: string | undefined) => {
      if (!ref) return;
      try { void deps.engines.get(on.route.engine).unload?.(on.account, ref)?.catch?.(() => undefined); } catch { /* the session idles out by itself */ }
    };
    const letGo = () => {
      const gone = held;
      held = undefined;
      if (gone) drop(gone, gone.session?.ref);
    };
    const lane = async (exclude?: string[]): Promise<Held> => {
      const route = await routeHelper(deps, purpose, exclude ? { exclude } : {}, effort);
      if (exclude?.includes(route.accountId)) throw new WorkforceError('unavailable', 'No other account can run the call voice now.');
      const account = deps.accounts.get(route.accountId);
      const model = deps.catalog.get(route.modelId);
      if (!account || !model) throw new Error('call voice: routed account/model vanished');
      return { route, account, model: model.model };
    };
    const attempt = async (line: ChatLine, cut: AbortSignal): Promise<Ran> => {
      held ??= await lane();
      const on = held;
      const kept = on.session !== undefined;
      // Without a kept session (an engine that keeps none, or a session that is gone) the call so far comes as text first.
      const before = kept || !earlier.length ? '' : `${EARLIER}\n${earlier.join('\n\n')}\n\n`;
      const began = Date.now();
      let firstMs: number | undefined;
      const other: Record<string, number> = {}; // what else the model did: a commentary, a reach for a tool (the log line names it)
      const onEvent = (event: EngineEvent) => {
        if (event.type === 'commentary' || event.type === 'tool_start') other[event.type] = (other[event.type] ?? 0) + 1;
        if (event.type === 'text') { firstMs ??= Date.now() - began; try { line.onText?.(event.delta); } catch { /* the reader's own business */ } return; }
        if (event.type !== 'limits') return;
        try { deps.accounts.updateLimits(on.account.id, event.limits); } catch { /* bookkeeping only */ }
      };
      const result = await runOnce(deps, on.route.engine, { account: on.account, model: on.model, effort: on.route.effort },
        { system, input: [{ type: 'text', text: `${before}${line.input}` }], signal: cut, onEvent, keep: true, ...(on.session ? { session: on.session } : {}) });
      if (result.usage) { try { deps.onUsage?.({ account: on.account, route: on.route, usage: result.usage }); } catch { /* bookkeeping only */ } }
      // Real run 18.11.2026: what each line of the voice used is seen nowhere else (no run, no transcript) – one line in the log.
      const use = result.usage ? { use: { input: result.usage.inputTokens, cached: cachedInput(result.usage), write: result.usage.cacheWriteTokens, output: result.usage.outputTokens } } : {};
      try { deps.log?.info('call voice line', { model: on.route.modelId, kept, stop: result.stop, ms: Date.now() - began, ...(firstMs !== undefined ? { firstMs } : {}), ...(Object.keys(other).length ? { other } : {}), ...use }); } catch { /* log only */ }
      const failed = accountFailure(result);
      if (failed) {
        for (const one of [on.account, ...sameKey(deps, on.account)]) { try { recordAccountFailure(deps, one, on.model, result); } catch { /* the call's own error reaches the caller */ } }
      }
      const session = result.session && deps.engines.get(on.route.engine).caps.sessions ? { ref: result.session.ref, generation: result.session.generation } : undefined;
      if (closed || held !== on) drop(on, session?.ref); // the call ended while the line ran: nothing of it outlives the call
      else if (failed || (result.stop !== 'done' && result.stop !== 'interrupted')) {
        if (session?.ref !== on.session?.ref) drop(on, session?.ref);
        letGo(); // the next line opens a new session
      } else {
        if (on.session && on.session.ref !== session?.ref) drop(on, on.session.ref);
        on.session = session; // a stopped line keeps it: the next line runs on it
      }
      return { on, kept, result };
    };
    const speak = async (line: ChatLine): Promise<ChatSaid> => {
      if (closed) throw new WorkforceError('unavailable', 'This call voice is closed.');
      const cut = callSignal(deps, line.signal, line.deadlineMs);
      const again = () => { try { line.onRestart?.(); } catch { /* the reader's own business */ } return attempt(line, cut); };
      let ran = await attempt(line, cut);
      const gone = ran.kept && ran.result.stop === 'error' && ran.result.error?.code === 'conflict';
      if (gone && !closed && !cut.aborted) ran = await again();
      if (accountFailure(ran.result) && !closed && !cut.aborted) {
        const away = [ran.on.account.id, ...sameKey(deps, ran.on.account).map((one) => one.id)];
        held = await lane(away); // no other account: 'unavailable', so the call hears the no-lane line
        ran = await again();
        if (accountFailure(ran.result)) throw new WorkforceError('unavailable', `No account can run the call voice now (${ran.on.route.modelId}).`);
      }
      const { on, kept, result } = ran;
      if (result.stop !== 'done') throw new WorkforceError(result.error?.code ?? 'internal', result.error?.message ?? `The call voice could not answer (${on.route.modelId}).`);
      earlier.push(`${line.input}\n${ANSWERED} ${result.text.trim() || '(nothing)'}`);
      while (earlier.length > EARLIER_LINES || earlier.join('').length > EARLIER_CHARS) earlier.shift();
      return { text: result.text, by: on.route.modelId, kept };
    };
    const opening = async () => {
      if (closed || held) return;
      const on = await lane();
      if (closed || held) return;
      held = on;
      const engine = deps.engines.get(on.route.engine);
      if (!engine.keepOpen) { await engine.prewarm?.(on.account); return; }
      const cwd = path.join(deps.paths.temp, HELPER_DIR);
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      const session = await engine.keepOpen({ account: on.account, model: on.model, effort: on.route.effort, system: { stable: system, volatile: '' }, cwd });
      if (closed || held !== on || on.session) drop(on, session.ref);
      else on.session = session;
    };
    const after = <T>(work: () => Promise<T>): Promise<T> => {
      const next = queue.then(work);
      queue = next.catch(() => undefined);
      return next;
    };
    return {
      open(): void {
        void after(opening).catch(() => undefined); // without a lane now, the first line routes again
      },
      say(line: ChatLine): Promise<ChatSaid> {
        if (closed) return Promise.reject(new WorkforceError('unavailable', 'This call voice is closed.'));
        return after(() => speak(line));
      },
      close(): void {
        closed = true;
        letGo();
      },
    };
  };
}
