// What an attempt's books count beyond its tokens (B-089, 11.11.2026: what a run costs, written down; moved out of
// turn-attempt.ts): an engine whose 'usage' events come one per model request (PER_REQUEST_USAGE: Codex) gives the attempt
// its model calls (AttemptResult.modelCalls). Package C (17.11.2026): an engine whose reported cost is the session's running
// total (SESSION_TOTAL_COST: Claude Code) costs the attempt the difference to the total kept on the session binding
// (agents/turn-cost.ts turnOwnCost; only when the attempt ended on the session it resumed; one that threw ended on it), and the
// attempt keeps the new total for that session (SessionStore.setCostTotal; AttemptResult.costTotal for finishTurn).
// Owns: those two engine sets, AttemptResult.modelCalls, the total read before an attempt (keptTotal) and kept after it (ownCost).
// Never: handles the engine's events or prices tokens (turn-attempt.ts / turn-cost.ts do).

import type { RuntimeServices } from '../contracts.ts';
import type { EngineTurnResult } from '../engines/types.ts';
import type { RoutedTurn, TurnPlan } from './turn-types.ts';
import { SessionStore } from './sessions.ts';
import { turnOwnCost } from './turn-cost.ts'; // package C

/** B-089: engines whose 'usage' events come one per model request (engines/codex/turn.ts: each thread/tokenUsage/updated). */
export const PER_REQUEST_USAGE: ReadonlySet<string> = new Set(['codex']);
/** Package C: engines whose reported cost is the session's running total, restored on every resume (Claude Code's total_cost_usd). */
const SESSION_TOTAL_COST: ReadonlySet<string> = new Set(['claude']);

declare module './turn-types.ts' {
  interface AttemptResult {
    /** B-089: the attempt's model requests – only from an engine that reports one usage event per request (absent: no count). */
    modelCalls?: number;
  }
}

/** Package C: whether the engine reports a session's running total, and the total kept for the session this attempt resumes. */
export function keptTotal(services: RuntimeServices, plan: TurnPlan, turn: RoutedTurn): { counts: boolean; usd?: number } {
  if (!SESSION_TOTAL_COST.has(turn.engine.id) || !turn.engine.caps.sessions) return { counts: false };
  if (!turn.session) return { counts: true };
  try {
    const total = new SessionStore(services.db).get(plan.agent.id, plan.thread, turn.engine.id)?.costTotal;
    return { counts: true, ...(total?.ref === turn.session.ref ? { usd: total.usd } : {}) };
  } catch { return { counts: true }; }
}

/**
 * Package C: the attempt's own cost from the session's running total; the total is kept for the session the attempt ended on
 * – here on its binding, and by finishTurn on the binding it saves (a session bound only then, e.g. a resumed rebuilt transcript, has no row yet).
 */
export function ownCost(services: RuntimeServices, plan: TurnPlan, turn: RoutedTurn, result: EngineTurnResult, total: number, kept: number | undefined): { usd: number; total?: { ref: string; usd: number } } {
  const ref = result.session?.ref ?? turn.session?.ref; // an attempt that threw names no session: it ran on the one it resumed
  if (ref) {
    try { new SessionStore(services.db).setCostTotal(plan.agent.id, plan.thread, turn.engine.id, { ref, usd: total }); } catch (error) {
      services.log.warn('keeping the session cost total failed', { agentId: plan.agent.id, error: String(error) });
    }
  }
  return { usd: turnOwnCost(total, ref !== undefined && ref === turn.session?.ref ? kept : undefined), ...(ref ? { total: { ref, usd: total } } : {}) };
}
