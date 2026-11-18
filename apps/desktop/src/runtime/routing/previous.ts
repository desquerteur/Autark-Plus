// The request in force and the turn's effort, for router.ts.
// - Request (RouteRequest.previous.explicit; `asked` = 'model' or 'effort', absent = both): my own model.set names a model
//   or a kind of model (it applies where my context starts anew, or at once with `now`); an effort applies to whichever
//   model the turn gets. A route a request shaped reports by 'request' (BY_REQUEST, stored in runs.route.by).
// - Effort, free on every turn (17.11.2026, measured: 388 of 388 effort changes kept the cache): my own request's or my
//   task's effort > my fixed effort > my subconscious's effort for this turn > my settled effort (the one my newest turn
//   on this model ran at without a request – agents/next-route.ts; same model kept, same category) > default policy >
//   category default (clamped by the router). 13.11.2026: the person's effort in the chat's
//   chip is information on their line (context/render.ts).
//   B-089 (11.11.2026: what a run costs, written down): startEffortBy also names which of these the effort came from
//   ('request' | 'agent' | 'previous' | 'default'); the router carries it as RouteDecision.effortBy and the finish
//   stores it in runs.route.effortBy. startEffort keeps its two-field answer for its callers.
// - effortSource: the reason's words for an effort someone asked for – mine, my task's with who gave it, or my
//   subconscious's with its why (the measured "requested by the agent" on 204 runs was a task's request from its giver).
// Owns: these rules and their reason texts. Never: I/O, or leaves the policy band (the router passes only candidates
// inside it).

import type { RouteRequest } from '../contracts.ts';
import type { Effort, RouteDecision } from '../../shared/model/providers.ts';
import { ROUTE_BY_REQUEST, type EffortBy } from '../../shared/model/runs.ts';
import type { EffectivePolicy } from './policies.ts';
import { defaultEffortFor } from './categories.ts';

/**
 * RouteDecision.by of a route the agent's own request shaped. 'request' is not a member of
 * RouteDecision['by'] in shared/model/providers.ts yet (not owned here) – hence the cast; the
 * stored runs.route.by is a plain string.
 */
export const BY_REQUEST = ROUTE_BY_REQUEST as string as RouteDecision['by'];

/** The route reason of a turn on the model my own model.set named. */
export const MODEL_REQUESTED = 'requested by the agent';
/** Appended to the route reason when the agent's own request set the effort of a model it did not name. */
export const EFFORT_REQUESTED = 'effort requested by the agent';
/** How the reason opens for an effort my task carries from its giver. */
export const EFFORT_OF_TASK = 'effort from my task';
/** How the reason opens for an effort my subconscious set before the turn. */
export const SUBCONSCIOUS = 'my subconscious';

type Previous = NonNullable<RouteRequest['previous']>;

/** The agent named this model itself (an effort-only request leaves the model to the usual rules). */
export function modelAsked(previous: Previous | undefined): boolean {
  return Boolean(previous?.explicit) && previous?.asked !== 'effort';
}

function effortAsked(previous: Previous | undefined): boolean {
  return Boolean(previous?.explicit) && previous?.asked !== 'model';
}

/** The run `previous` comes from had this category (an unknown one counts as the same). */
export function sameCategory(previous: Previous | undefined, category: string): boolean {
  return !previous?.category || previous.category === category;
}

/** The effort before clamping, whether a request set it, and (B-089) where it came from – RouteDecision.effortBy. */
export function startEffortBy(policy: EffectivePolicy, previous: Previous | undefined, category: string, keptPrevious: boolean): { effort: Effort; requested: boolean; by: EffortBy } {
  const asked = effortAsked(previous) ? previous?.effort : undefined;
  // B-079 (live 07.11.: Nora's model.set xhigh, asked for by the owner, lost to her own fixed medium): my own request – and
  // my task's – beats my fixed effort; my subconscious's weighing for one turn does not.
  if (asked && previous?.by !== 'subconscious') return { effort: asked, requested: true, by: 'request' };
  if (policy.agentEffort) return { effort: policy.agentEffort, requested: false, by: 'agent' };
  if (asked) return { effort: asked, requested: true, by: 'request' };
  if (previous?.effort && keptPrevious && sameCategory(previous, category)) return { effort: previous.effort, requested: false, by: 'previous' };
  return { effort: policy.defaultEffort ?? defaultEffortFor(category), requested: false, by: 'default' };
}

/** The effort before clamping, and whether a request set it (startEffortBy without the origin). */
export function startEffort(policy: EffectivePolicy, previous: Previous | undefined, category: string, keptPrevious: boolean): { effort: Effort; requested: boolean } {
  const { effort, requested } = startEffortBy(policy, previous, category, keptPrevious);
  return { effort, requested };
}

/** Whose effort a request's is, as the route reason says it: my subconscious's with its why, my task's with who gave it, else my own. */
export function effortSource(previous: Previous | undefined): string {
  const why = previous?.why?.replace(/\s+/g, ' ').trim() ?? '';
  if (previous?.by === 'subconscious') return why ? `${SUBCONSCIOUS}: ${why}` : SUBCONSCIOUS;
  if (previous?.by === 'task') return why ? `${EFFORT_OF_TASK} (${why})` : EFFORT_OF_TASK;
  return EFFORT_REQUESTED;
}
