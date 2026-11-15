// SubconsciousImpl: one service around the agents' turns, on the cheap decision model (the Decisions use); the good model
// is the main AI itself. Unterbewusstsein v1 (14.11.2026, measured .local/unterbewusstsein-20261113), v2 (15.11.2026): the job
// before a turn is one call the turn waits for (route-turn.ts routeTurn) – on a person's message, on a colleague's when only
// colleagues woke the turn, else on the turn's task (a task, schedule, retry, review or handoff wake), each with content (the cheap
// check, wake.ts): it sets the turn's model and effort – not while a request of the agent's own or of its task holds the turn
// (route-turn.ts requestHolds, which first ends a step the call set for an earlier message) – and opens the hits of the word search
// it chooses (they come first in the turn's trace); the turn waits for it at most ROUTE_WAIT_MS. Beside it a second call on the same
// model and system prompt condenses context items whose job is done (route-turn.ts condenseTurn, look.ts); nobody waits for that one.
// Each call leaves one info event. Nothing runs after a turn: what the calls leave, code condenses at the rebuild once its run is
// finished (context/ledger/window.ts leanText). ask() – the main AI's own call (the subconscious tool):
// the loop (flow.ts), its answer is the tool output. A trace kept in kv – put back by a turn that never reached its engine,
// the timeout decisions a native turn could not take in (agents/native-timeout.ts), or left by runs before v1 – is handed to
// the agent's next turn on that thread by beforeTurn() (a note or hit older than a day goes). Also verify() (a task result
// against its done-condition), toolTimeout() (the decision hub directly, for a tool call past its deadline) and
// widgetFor()/fillWidget() (the person's to-do widgets). The model is the engines' structured runner, one per call, its use
// booked on the agent it works for (a widget fill on the subconscious itself) – none while no model is connected.
// Owns: which call happens with which budget, the kept trace and failure isolation. Never: makes a turn wait longer than
// ROUTE_WAIT_MS, judges an agent's answer, or turns memory into instructions.

import { MAIN_THREAD } from '../../shared/model/origin.ts';
import type { RuntimeServices, Subconscious } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { Task, TaskResult } from '../../shared/model/tasks.ts';
import type { UiBlock } from '../../shared/blocks/catalog.ts';
import { capTrace, hasTrace, NOTE_CALL, type SubconsciousTrace, type TraceCall } from '../../shared/model/subconscious.ts';
import { createEngineRunner, type EngineRunnerDeps } from '../decision/engine-runner.ts';
import { bookTurnCost, priceTurn } from '../agents/turn-cost.ts';
import '../contracts/vectors.ts';
import type { StructuredRunner } from '../decision/types.ts';
import { askContext, type AskContext } from './exchange.ts';
import { runFlow, type FlowInput } from './flow.ts';
import { condenseTurn, requestHolds, routeTurn } from './route-turn.ts';
import { SUBCONSCIOUS_ID } from './tools.ts';
import { verifyResult, type Verdict } from './verify.ts';
import { hasContent } from './wake.ts';
import { chooseWidget, fillWidget } from './widget.ts';
import { chooseToolTimeout } from './tool-timeout.ts';
import type { ToolTimeoutInput } from '../tools/timeout.ts';

/** The time limit of one helper call (a cold CLI start on a loaded 8 GB PC took up to 200 s to its first request, q2m live 02.11.2026). */
const CALL_MS = 180_000;
/** The main AI's own call. Each step of a CLI that starts a process per call took 20–70 s on the 8 GB reference PC (Claude Code, measured 02.11.2026); the steps bound a run, this only catches a hang. */
export const ASK_MS = 300_000;
const ASK_STEPS = 12;
/** How long a turn waits for the call before it (one small structured call: 2.7–4.3 s measured on Luna/low, E4 arm NEW 14.11.2026). */
export const ROUTE_WAIT_MS = 12_000;
/** The limit of the call beside the turn that condenses its context (v2: the turn does not wait for it – 15.11. in codex exec up to ~28 s with 12 items). */
export const LOOK_MS = 60_000;
const PENDING_NS = 'subconscious_trace';
/** A kept note or hit older than this is about something else by now: it is dropped, not shown. */
const KEPT_MS = 24 * 60 * 60_000;
/** The calls that age: what a run told or found for the main AI, and what the call before a turn opened for it (put back by a turn that never ran). */
const ABOUT_NOW: ReadonlySet<string> = new Set([NOTE_CALL, 'agent.tell', 'vector.search', 'knowledge.open']); // agent.tell: rows kept before the name changed

export interface SubconsciousDeps {
  services: () => RuntimeServices;
  /** The decision model, also of widget fills (tests); false = none; absent = the engines' runner. */
  runner?: StructuredRunner | false;
}

type BeforeTurn = Parameters<NonNullable<Subconscious['beforeTurn']>>[0];

/** What the call before a turn weighs: the person's lines when a person wrote, else a colleague's with content, else the turn's task; undefined without content. */
function wakeOf(input: BeforeTurn): { said: string; from: 'person' | 'colleague' | 'task' } | undefined {
  const wake = input.said ? { said: input.said, from: 'person' as const }
    : input.woke && hasContent(input.woke) ? { said: input.woke, from: 'colleague' as const }
      : { said: input.taskText ?? '', from: 'task' as const };
  return hasContent(wake.said) ? wake : undefined;
}

export class SubconsciousImpl implements Subconscious {
  private readonly deps: SubconsciousDeps;
  /** The calls before a turn in flight (settle waits for them at the app's stop). */
  private readonly routing = new Set<Promise<unknown>>();

  constructor(deps: SubconsciousDeps) {
    this.deps = deps;
  }

  verify(task: Task, result: TaskResult): Promise<Verdict> {
    return verifyResult(this.deps.services(), task, result);
  }

  toolTimeout(input: ToolTimeoutInput & { agent: Agent; signal: AbortSignal }) {
    return chooseToolTimeout(this.deps.services(), input);
  }

  widgetFor(text: string): Promise<UiBlock> {
    return chooseWidget(this.deps.services(), text);
  }

  fillWidget(block: UiBlock, text: string): Promise<UiBlock> {
    const services = this.deps.services();
    return fillWidget(services, this.decisionRunner(services, SUBCONSCIOUS_ID), block, text);
  }

  /** What the agent's turn gets: the entries the call before it opened, then the trace kept for this thread. Never throws. */
  async beforeTurn(input: BeforeTurn): Promise<SubconsciousTrace | undefined> {
    const opened = await this.lookFirst(input);
    const kept = this.takeTrace(input.agent.id, input.thread);
    return opened.length ? { calls: [...opened, ...(kept?.calls ?? [])] } : kept;
  }

  /**
   * The call before a turn (route-turn.ts routeTurn), with the route left out while a request holds the turn: the turn's stop or
   * ROUTE_WAIT_MS ends the wait and the call, and a late answer sets and opens nothing. Beside it, not waited for, condenseTurn marks
   * the context (its own limit LOOK_MS, the turn's stop ends it). Each call leaves one info event: agent, what woke the turn, the line
   * it set (or 'same route', 'held by request', cut / failed) with how many entries it opened, or 'condensed' with how many items, and
   * its time in ms (runtime.log). Returns the opened entries' calls. Never throws.
   */
  private async lookFirst(input: BeforeTurn): Promise<TraceCall[]> {
    try {
      const services = this.deps.services();
      if (input.signal?.aborted) return [];
      const held = requestHolds(services, input.agent.id, input.taskId); // first on every turn: it ends a step set for an earlier message
      const wake = wakeOf(input);
      if (!wake) return []; // re-review 14.11.: no wait on a tool call in the chat – the main lane runs one turn at a time, only my parts' calls showed there
      const runner = this.decisionRunner(services, input.agent.id);
      if (!runner) return [];
      const started = Date.now();
      const wait = new AbortController();
      const timer = setTimeout(() => wait.abort(), ROUTE_WAIT_MS);
      (timer as { unref?: () => void }).unref?.();
      const signal = input.signal ? AbortSignal.any([input.signal, wait.signal]) : wait.signal;
      const call = routeTurn(services, runner, {
        agent: input.agent, conversationId: input.conversationId, thread: input.thread, ...wake, ...(input.mode ? { mode: input.mode } : {}),
        ...(input.vision ? { vision: true } : {}), ...(held ? { held: true } : {}), signal, deadlineMs: ROUTE_WAIT_MS,
      });
      this.track(call);
      const tidy = condenseTurn(services, this.decisionRunner(services, input.agent.id) ?? runner, { agent: input.agent, conversationId: input.conversationId, thread: input.thread, ...wake, ...(input.signal ? { signal: input.signal } : {}), deadlineMs: LOOK_MS });
      this.track(tidy);
      void tidy.then((condensed) => { if (condensed) this.logRoute(input.agent.id, wake.from, 'condensed', Date.now() - started, { condensed }); });
      const cut = new Promise<'cut'>((resolve) => signal.addEventListener('abort', () => resolve('cut'), { once: true }));
      const look = await Promise.race([call.then((done) => done ?? (signal.aborted ? 'cut' as const : held ? 'held by request' as const : 'failed' as const)), cut]).finally(() => clearTimeout(timer));
      const outcome = typeof look === 'string' ? look : look.line ?? (held ? 'held by request' : 'same route');
      this.logRoute(input.agent.id, wake.from, outcome, Date.now() - started, typeof look === 'string' ? {} : { opened: look.calls.length });
      return typeof look === 'string' ? [] : look.calls;
    } catch (error) {
      this.log('subconscious look failed', error);
      return [];
    }
  }

  /** A call in flight until it settles (settle waits for them at the app's stop). */
  private track(call: Promise<unknown>): void {
    this.routing.add(call);
    void call.finally(() => this.routing.delete(call));
  }

  private logRoute(agentId: string, wake: string, outcome: string, ms: number, did: { opened?: number; condensed?: number }): void {
    try { this.deps.services().log.info('subconscious route', { agentId, wake, outcome, ...did, ms }); } catch { /* nothing to report to */ }
  }

  /** A turn that never reached its engine: its trace waits for the next turn on the thread. Never throws. */
  putBack(agentId: string, thread: string, trace: SubconsciousTrace): void {
    this.keepTrace(agentId, thread, trace);
  }

  /** The person's Forget: a kept trace that mentions it never reaches the main AI. Never throws. */
  forget(match: (text: string) => boolean): void {
    try {
      const { db } = this.deps.services();
      for (const row of db.all<{ key: string; value: string }>('SELECT key, value FROM kv WHERE ns = ?', [PENDING_NS])) {
        if (match(row.value)) db.run('DELETE FROM kv WHERE ns = ? AND key = ?', [PENDING_NS, row.key]);
      }
    } catch (error) {
      this.log('subconscious trace not cleared', error);
    }
  }

  /** The main AI's own call: the loop with `ask` as the task; the answer is its tool output. Never throws. */
  async ask(input: { agent: Agent; conversationId?: string; thread?: string; taskId?: string; mode?: string; ask: string; context?: AskContext; signal?: AbortSignal }): Promise<string> {
    try {
      const services = this.deps.services();
      const result = await this.flow({
        agent: input.agent, conversationId: input.conversationId, thread: input.thread ?? MAIN_THREAD, taskId: input.taskId, ...(input.mode ? { mode: input.mode } : {}),
        task: input.ask, context: askContext(services, { agentId: input.agent.id, conversationId: input.conversationId, context: input.context }),
        maxSteps: ASK_STEPS, budgetMs: ASK_MS, signal: input.signal,
      });
      if (result.answer) return result.answer;
      if (result.end === 'no-model' || result.end === 'no-prompt') return 'The subconscious cannot answer: no model is connected for it.';
      if (result.end === 'failed' || result.end === 'budget') return 'The subconscious could not answer in time.';
      return 'The subconscious has nothing to add.';
    } catch (error) {
      this.log('subconscious ask failed', error);
      return 'The subconscious could not answer.';
    }
  }

  /** Resolves when the calls before a turn in flight ended – at once when none runs (the app's stop, compose/lifecycle.ts; tests). */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.routing]);
  }

  private flow(input: FlowInput) {
    const services = this.deps.services();
    return runFlow(services, this.decisionRunner(services, input.agent.id), input);
  }

  private keepTrace(agentId: string, thread: string, trace: SubconsciousTrace): void {
    try {
      const { db, clock } = this.deps.services();
      const key = `${agentId}:${thread}`;
      const now = clock.now();
      const held = db.get<{ value: string; updated_at: number }>('SELECT value, updated_at FROM kv WHERE ns = ? AND key = ?', [PENDING_NS, key]);
      const before = held ? (JSON.parse(held.value) as SubconsciousTrace).calls.map((call) => ({ ...call, at: call.at ?? held.updated_at })) : []; // a row of 0.2.9 has no `at`
      const calls = [...before, ...trace.calls.map((call) => ({ ...call, at: call.at ?? now }))];
      db.run('INSERT INTO kv (ns, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [PENDING_NS, key, JSON.stringify(capTrace({ calls })), now]);
    } catch (error) {
      this.log('subconscious trace not kept', error);
    }
  }

  private takeTrace(agentId: string, thread: string): SubconsciousTrace | undefined {
    try {
      const { db, clock } = this.deps.services();
      const key = `${agentId}:${thread}`;
      const held = db.get<{ value: string; updated_at: number }>('SELECT value, updated_at FROM kv WHERE ns = ? AND key = ?', [PENDING_NS, key]);
      if (!held) return undefined;
      db.run('DELETE FROM kv WHERE ns = ? AND key = ?', [PENDING_NS, key]);
      const oldest = clock.now() - KEPT_MS;
      const trace = { calls: (JSON.parse(held.value) as SubconsciousTrace).calls.filter((call) => !ABOUT_NOW.has(call.tool) || (call.at ?? held.updated_at) >= oldest) };
      return hasTrace(trace) ? trace : undefined;
    } catch (error) {
      this.log('subconscious trace not read', error);
      return undefined;
    }
  }

  private connected(services: RuntimeServices): boolean {
    try { return services.catalog.list().some((model) => model.available); } catch { return false; }
  }

  private runnerDeps(services: () => RuntimeServices, agentId: string) {
    return {
      get engines() { return services().engines; },
      get router() { return services().router; },
      get accounts() { return services().accounts; },
      get catalog() { return services().catalog; },
      get paths() { return services().paths; },
      get clock() { return services().clock; },
      get notifications() { return services().notifications; },
      timeoutMs: CALL_MS, // the widget fill brings its own shorter signal (widget.ts WIDGET_FILL_MS)
      onUsage: (entry: Parameters<NonNullable<EngineRunnerDeps['onUsage']>>[0]) => this.bookUse(entry, agentId),
    };
  }

  /** The model's use on a pay-per-use account, like an agent turn's, on the agent the call works for (nothing for a plan or a local model). */
  private bookUse(entry: Parameters<NonNullable<EngineRunnerDeps['onUsage']>>[0], agentId: string): void {
    const services = this.deps.services();
    const cost = priceTurn(services, entry, { usage: entry.usage }, '').run;
    bookTurnCost(services, agentId, 'subconscious', cost);
  }

  /** The decision model (the Decisions use), one runner per call so its use is booked on `agentId`: none when nothing is connected. */
  private decisionRunner(services: RuntimeServices, agentId: string): StructuredRunner | undefined {
    if (this.deps.runner === false) return undefined;
    if (this.deps.runner) return this.deps.runner;
    if (!this.connected(services)) return undefined;
    return createEngineRunner(this.runnerDeps(this.deps.services, agentId));
  }

  private log(message: string, error: unknown): void {
    try { this.deps.services().log.debug(message, { error: String(error) }); } catch { /* nothing to report to */ }
  }
}
