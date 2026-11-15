// B-057 – the turn pipeline's split parts (S2/S5/S9/S10/S12/S15), called with one line from each phase. A split's turn
// (TurnRequest.split, started on its own dispatcher lane – dispatch-lanes.ts) is its parent agent working on one part:
//   plan   – its own thread `split:<id>`, no task or member cursor (its run carries the chat its work is for – the
//            part's `chat`), in the parent's mode at the split while it still exists;
//   route  – S10 (routing/split-route.ts): 'same' (default) = the parent run's model and – unless the part names one –
//            its effort; 'cheap' = the router's 'cheaper' need from the parent's model; 'strong' = at least the strong
//            tier; a catalog model id = that model; the part's choice beats the agent's pin and fixed effort; B-083: the
//            part's temperature goes on the plan like a model.set request's (engines that take one send it);
//   session – the first turn without a binding on its thread is seeded from its parent (splits/fork.ts) and that ref is
//            bound under (agent, split thread, engine) with this turn's prompt key; the seed's text goes before the input;
//            the tool offer is its agent's, like its parent's (the agent's learned tools – S8; what a part finds through
//            tools.call is learned for its agent too, tools/registry.ts callThrough);
//   attempt – ToolContext.split, the parent's chat for reach, its folder (its worktree, else the group's), and on a warm
//            Codex app-server no heavy supervisor slot (S12);
//   finish – its <chat> blocks post like the agent's own; its final text goes to its origin – on its own, at once (gather.ts
//            returned); the split service hears how the run ended (B-080: a
//            done run that brought nothing back – no last words, no note to its origin, no files – fails, NOTHING_BACK).
// For the agent's own (non-split) turns: the "Split results" block of its parts that came back joins the turn input, and the
// turn's end lets the split service start the groups it created (afterParentTurn) and gather the parts it showed ('done').
// Owns: those split rules of the pipeline. Never: runs or stops a turn, touches the parent's session, ledger or chat
// cursor, or decides a split's lifecycle (runtime/splits/service.ts does).

import type { RouteRequest, RuntimeServices } from '../contracts.ts';
import type { SplitRunEnd } from '../contracts/splits.ts';
import type { Engine } from '../engines/types.ts';
import type { ModeInfo } from '../../shared/model/knowledge.ts';
import type { Account, RouteDecision } from '../../shared/model/providers.ts';
import type { Run, RunStatus } from '../../shared/model/runs.ts';
import type { WorkforceErrorData } from '../../shared/errors.ts';
import { splitThread, type SplitTurn } from '../../shared/model/splits.ts';
import { effectsKnown } from '../context/recent-actions.ts';
import { seedSplitSession, type SeedResult } from '../splits/fork.ts';
import { SHUTDOWN_CUT } from '../splits/reconcile.ts';
import { resultOf } from '../splits/results.ts';
import { SessionStore, type SessionBinding } from './sessions.ts';
import type { ToolOffer } from './session-key.ts';
import type { AttemptResult, RoutedTurn, TurnPlan, TurnRequest } from './turn-types.ts';

const FOCUS_CHARS = 4000;

type Previous = NonNullable<RouteRequest['previous']>;

/** The plan of a split's turn (planTurn's split branch); undefined when its agent is gone, archived or paused. */
export function planSplit(services: RuntimeServices, request: TurnRequest, resolveMode: (services: RuntimeServices, keys: Array<string | undefined>) => ModeInfo): TurnPlan | undefined {
  const split = request.split;
  const agent = services.org.get(request.agentId);
  if (!split || !agent || agent.archivedAt || agent.status === 'paused') return undefined;
  const previous = splitPrevious(services, split);
  return {
    agent, mode: resolveMode(services, [split.modeKey, agent.mode]), ...(request.origin ? { origin: request.origin } : {}),
    thread: splitThread(split.splitId), memberCursor: 0, focus: request.notes.map((note) => note.text).join('\n').slice(-FOCUS_CHARS),
    ...(previous ? { previous } : {}), ...(split.temperature !== undefined ? { temperature: split.temperature } : {}), // B-083
    needsVision: false, split,
  };
}

/** S10: RouteRequest.previous of a split's turn – its model choice as the agent's own explicit request. */
export function splitPrevious(services: Pick<RuntimeServices, 'runs' | 'log'>, split: Pick<SplitTurn, 'parentRunId' | 'model' | 'effort'>): Previous | undefined {
  let parent: Run | undefined;
  try { parent = services.runs.get(split.parentRunId); } catch (error) {
    services.log.warn('reading the parent run failed; the split routes as usual', { runId: split.parentRunId, error: String(error) });
  }
  const from = parent?.model;
  const effort = split.effort;
  const base = parent?.effort ?? 'medium';
  const choice = split.model?.trim() || 'same';
  const effortOnly: Previous | undefined = effort ? { modelId: '', effort, explicit: true, asked: 'effort' } : undefined;
  if (choice === 'strong') return effortOnly; // needs.tier (splitRoute) – the rules pick inside it
  if (choice === 'cheap') {
    const need = { kind: 'cheaper' as const, ...(from ? { from } : {}) };
    return effort ? { modelId: from ?? '', effort, explicit: true, need } : { modelId: from ?? '', effort: base, explicit: true, asked: 'model', need };
  }
  const modelId = choice === 'same' ? from : choice;
  if (!modelId) return effortOnly;
  // 'same' keeps the parent's effort unless the part names one; an explicit model takes the part's effort, else the rules'.
  // B-083 D1: `from` – the parent's model the part was forked on; it stays there while the named model cannot run.
  const on = from && from !== modelId ? { from } : {};
  if (choice === 'same' || effort) return { modelId, effort: effort ?? base, explicit: true, ...on };
  return { modelId, effort: base, explicit: true, asked: 'model', ...on };
}

/** The split fields of a RouteRequest (routeRequest in turn-prepare.ts): the split marker and 'strong' as the tier floor. */
export function splitRoute(plan: Pick<TurnPlan, 'split'>): Partial<Pick<RouteRequest, 'split' | 'needs'>> {
  if (!plan.split) return {};
  return { split: { splitId: plan.split.splitId }, ...(plan.split.model?.trim() === 'strong' ? { needs: { tier: 'strong' } } : {}) };
}

/** A split's folder: its own (a worktree) or its group's (the parent's at the split); undefined = the usual folder. */
export function splitCwd(services: Pick<RuntimeServices, 'splits' | 'log'>, split: SplitTurn | undefined): string | undefined {
  if (!split) return undefined;
  if (split.cwd) return split.cwd;
  try { return services.splits?.get(split.splitId)?.group.cwd; } catch (error) {
    services.log.warn('reading the split group failed; the split runs in the usual folder', { splitId: split.splitId, error: String(error) });
    return undefined;
  }
}

/** S12: a split's turn on a Codex app-server that already runs for the account needs no heavy supervisor slot. */
export function warmSplit(plan: Pick<TurnPlan, 'split'>, turn: Pick<RoutedTurn, 'engine' | 'account'>): boolean {
  if (!plan.split || turn.engine.id !== 'codex') return false;
  try { return turn.engine.warm?.(turn.account) === true; } catch { return false; }
}

/** What seeding needs besides the plan (turn-prepare.ts buildTurn's rebuild context). */
export interface SeedContext { account: Account; model: string; offer: ToolOffer; prompt: { stable: string; volatile: string } }

/**
 * A split's first turn without a session on its thread: seeded from its parent (splits/fork.ts). A seeded ref is bound
 * under (agent, split thread, engine) with this turn's prompt key; `prefix` goes before the turn's input. Undefined =
 * the usual path (no split, not its first turn, or seeding failed – the split then starts fresh).
 */
export async function seedSplit(services: RuntimeServices, plan: TurnPlan, request: TurnRequest, engine: Engine, route: RouteDecision, promptKey: string, native: SeedContext | undefined): Promise<{ session?: SessionBinding; prefix?: string } | undefined> {
  const split = plan.split;
  if (!split?.firstTurn || !native) return undefined;
  let seed: SeedResult;
  try {
    seed = await seedSplitSession(services, {
      plan, split, route: { route, engine, account: native.account, model: native.model, effort: route.effort },
      tools: native.offer.native, toolNames: native.offer.names, system: native.prompt, promptKey, cwd: splitCwd(services, split), runId: request.runId,
    });
  } catch (error) {
    services.log.warn('seeding the split session failed; it starts fresh', { splitId: split.splitId, error: String(error) });
    return undefined;
  }
  const prefix = seed.inputPrefix?.trim() ? seed.inputPrefix : undefined;
  if (!seed.ref || !engine.caps.sessions) return prefix ? { prefix } : {};
  const session: SessionBinding = {
    agentId: plan.agent.id, conversationId: plan.thread, engine: engine.id, accountId: native.account.id, ref: seed.ref,
    generation: seed.generation ?? 1, cursorSeq: 0, model: route.modelId, promptKey, mode: plan.mode.key, updatedAt: services.clock.now(),
  };
  new SessionStore(services.db).save(session);
  return { session, ...(prefix ? { prefix } : {}) };
}

/** S6: the "Split results" block of the agent's own turn on this thread (its parts that ended and did not reach it yet); never a split's. */
export function splitResults(services: RuntimeServices, plan: Pick<TurnPlan, 'agent' | 'thread' | 'split'>): { splitIds: string[]; text: string } | undefined {
  if (plan.split || !services.splits) return undefined;
  try {
    const found = services.splits.pendingResults(plan.agent.id, plan.thread);
    return found && found.splitIds.length && found.text.trim() ? found : undefined;
  } catch (error) {
    services.log.warn('split results unavailable for this turn', { agentId: plan.agent.id, error: String(error) });
    return undefined;
  }
}

/** turn-finish: a split's run end goes to the split service; the agent's own turn starts its new groups and gathers the shown ones. */
export function splitTurnEnded(services: RuntimeServices, plan: TurnPlan, turn: Pick<RoutedTurn, 'splitParts'>, request: TurnRequest, attempt: AttemptResult, status: RunStatus): void {
  const splits = services.splits;
  if (!splits) return;
  try {
    if (plan.split) {
      splits.onSplitRunEnd(plan.split.splitId, splitEnd(services, request, attempt, status));
      return;
    }
    if (status === 'done' && turn.splitParts?.length) splits.markGathered(request.runId, turn.splitParts);
    splits.afterParentTurn(request.runId, status === 'done' ? 'done' : request.control.stopKind === 'human' ? 'stopped' : 'failed');
  } catch (error) {
    services.log.warn('split bookkeeping after the turn failed', { runId: request.runId, error: String(error) });
  }
}

/** B-080: why a part whose run ended without bringing anything back failed (it runs once more – splits/runner.ts). */
export const NOTHING_BACK = 'It ended without last words or a note to its origin – nothing came back.';

/**
 * How a split's run ended: the person's Stop → stopped; a shutdown cut → retryable; a failure is retryable while no effect
 * of it is unknown (and it is no setup error). B-080: a done run counts as done when it brought something back – its last
 * words or a note to its origin (splits/results.ts resultOf; turn-finish journaled its Answer before this) or files.
 */
function splitEnd(services: RuntimeServices, request: TurnRequest, attempt: AttemptResult, status: RunStatus): SplitRunEnd {
  const runId = request.runId;
  if (status === 'done') return resultOf(services.runs, { id: runId }) || attempt.result.files?.length ? { runId, status: 'done' } : { runId, status: 'failed', retryable: true, error: NOTHING_BACK };
  const kind = request.control.stopKind;
  if (status === 'interrupted' && kind === 'human') return { runId, status: 'stopped' };
  // S14: a shutdown cut is no failure of the part – it runs again (its next turn resumes its session and sees its earlier
  // actions in the recap), like the main lane's wakes that a shutdown releases.
  if (status === 'interrupted' && kind === 'shutdown') return { runId, status: 'failed', retryable: true, error: SHUTDOWN_CUT }; // its next attempt reads why (RESTART_NOTE)
  const { result } = attempt;
  const known = attempt.toolCalls === 0 || effectsKnown(services, runId, attempt.toolCalls);
  const error = status === 'interrupted'
    ? (kind ? 'The split was cut off.' : 'The engine interrupted the split.')
    : result.error?.message ?? (result.stop === 'limit' ? 'A usage limit was reached.' : 'The turn failed.');
  const retryable = known && result.error?.details?.setup !== true;
  // A usage limit (or the provider refusing for one): it waits for an account instead of using its retry at once (splits/holds.ts).
  const wait = status !== 'interrupted' && retryable && (result.stop === 'limit' || result.error?.code === 'rate_limited');
  return { runId, status: 'failed', retryable, error, ...(wait ? { wait: true } : {}) };
}

/** turn.ts failBeforeEngine: a split's run that never reached its engine (no model or account, a limit …). */
export function splitTurnFailed(services: RuntimeServices, plan: Pick<TurnPlan, 'split'>, runId: string, error: WorkforceErrorData): void {
  if (!plan.split) return; // an agent's own turn that never ran created no group
  const outage = error.code === 'rate_limited' || ((error.code === 'unavailable' || error.code === 'cancelled') && error.details?.setup !== true);
  const wait = error.code === 'rate_limited' || (error.code === 'unavailable' && error.details?.setup !== true); // no account can run it now: it waits for one
  try { services.splits?.onSplitRunEnd(plan.split.splitId, { runId, status: 'failed', retryable: outage, error: error.message, ...(wait ? { wait: true } : {}) }); } catch (failure) {
    services.log.warn('split bookkeeping after a failed start failed', { runId, error: String(failure) });
  }
}

/**
 * How a split's turn that never reached its finish ended (turnEndedEarly). `requeue`: its work never started (the
 * runtime stopped first) – back to queued without using an attempt; failed and retryable as well, so a split service
 * without `requeue` still runs it once more.
 */
const EARLY: Record<'skipped' | 'stopped' | 'cut' | 'crashed', Omit<SplitRunEnd, 'runId'>> = {
  skipped: { status: 'stopped', error: 'The agent is paused or archived.' },
  stopped: { status: 'stopped' },
  cut: { status: 'failed', retryable: true, requeue: true, error: 'The runtime stopped before the split ran.' },
  crashed: { status: 'failed', error: 'The turn failed unexpectedly.' },
};

/**
 * dispatch-runs.ts: a turn that ended without its finish – a split's turn planned no run (its agent is paused or archived
 * now), was stopped before it started (by the person, or cut by a
 * shutdown: re-queued) or crashed; a crashed agent's own run lets the groups it created start.
 */
export function turnEndedEarly(services: RuntimeServices, runId: string, split: SplitTurn | undefined, how: keyof typeof EARLY): void {
  const splits = services.splits;
  if (!splits) return;
  try {
    if (split) splits.onSplitRunEnd(split.splitId, { runId, ...EARLY[how] });
    else if (how === 'crashed') splits.afterParentTurn(runId, 'failed');
  } catch (error) {
    services.log.warn('split bookkeeping after an early end failed', { runId, error: String(error) });
  }
}
