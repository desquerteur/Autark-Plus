// A person's own line (E1, 01.11.2026 – live D5: the Manager's answers to the person ran at medium and answered from
// memory): a turn that answers a new line of a person runs at effort high or above, on the model the agent is on.
// 17.11.2026 (the model settles; measured 15.–17.11.: the rule's move to the strongest model was one of the ways every
// employee ended up on its manager's model, and a two-word line of the person once ran at low effort): the line raises the
// effort and no longer moves the model – unless the agent's own model.set or its fixed effort says another.
// B-078 (D16, owner 06.11.2026: "2 % smarter at three times the price makes no sense; 20 % smarter at 1.5 times, for
// hard work, does"): the first choice of a tier weighs how capable a model is (its curated smarts) against its list price
// (relCost, not discounted by a plan – a plan's quota runs down at the same ratio), on top of the usual score in cost mode
// 'best'. So on a Claude plan the strongest tier's first choice is Opus 5.5, not the 2.5x pricier Fable (routing/kind.ts
// takes it for an agent that leads).
// Owns: what counts as a person's line, its effort floor and a tier's first choice. Never: changes state, picks the
// turn's model, or overrides an effort the person or the agent fixed.

import type { RouteRequest, RuntimeServices } from '../contracts.ts';
import type { Effort } from '../../shared/model/providers.ts';
import { SYSTEM_ID } from '../../shared/ids.ts';
import { effortRank } from '../models/efforts.ts';
import type { PoolEntry } from './pool.ts';
import { listPrice, tierRank } from './score.ts';

/** The lowest effort a person's own line runs at (clamped to what the model offers). */
export const PERSON_EFFORT: Effort = 'high';

/** The route reason's part for a turn whose effort the person's line raised. */
export const PERSON_TEXT = "a person's line · effort at least high";

/** Lines a person writes to an agent: a chat message or an answer to the agent's question (not a task card or status line). */
const REQUEST_KINDS: ReadonlySet<string> = new Set(['text', 'answer']);

/** New chat lines the agent has not read yet (its read cursor) hold a line written by a person. */
export function personAsks(s: Pick<RuntimeServices, 'chats'>, request: Pick<RouteRequest, 'agent' | 'conversationId' | 'split'>): boolean {
  if (!request.conversationId || request.agent.id === SYSTEM_ID || request.split) return false;
  try {
    const member = s.chats.members(request.conversationId).find((item) => item.memberId === request.agent.id && !item.leftAt);
    if (!member) return false;
    const unseen = s.chats.messages(request.conversationId, { afterSeq: member.readSeq ?? 0, limit: 40 });
    return unseen.some((message) => message.authorKind === 'human' && REQUEST_KINDS.has(message.kind));
  } catch {
    return false; // a chat service without messages (a fake) or a read error: the usual route
  }
}

/** The pool's entries of its highest tier (the strongest kind of model connected for this work). */
export function topTier<T extends Pick<PoolEntry, 'model'>>(pool: readonly T[]): T[] {
  const top = Math.max(-1, ...pool.map((entry) => tierRank(entry.model.tier)));
  return pool.filter((entry) => tierRank(entry.model.tier) === top);
}

/** One smarts point is worth 0.01 of score (a prior strength spans −1…+1). */
const SMARTS_WEIGHT = 0.01;
/** Smarts of a model the priors do not rate. */
const SMARTS_UNKNOWN = 70;
/** What the whole price range (relCost 0 → 1) costs in score: Fable at 2.5x Opus needs 30 smarts points more to win. */
export const PRICE_WEIGHT = 0.5;

type Scored = Pick<PoolEntry, 'model'> & { score?: number };

/** A model's worth as a tier's first choice: its score + smarts − list price (see the header). */
export function personValue(entry: Scored): number {
  const { model } = entry;
  const smarts = typeof model.smarts === 'number' ? model.smarts : SMARTS_UNKNOWN;
  return (entry.score ?? 0) + SMARTS_WEIGHT * smarts - PRICE_WEIGHT * listPrice(model);
}

/** The first choice among `ranked` (one tier, scored in cost mode 'best'): the highest personValue, the ranking's order on a tie. */
export function firstChoice<T extends Scored>(ranked: readonly T[]): T | undefined {
  return ranked.map((entry, index) => ({ entry, index, value: personValue(entry) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)[0]?.entry;
}

/** `effort` raised to PERSON_EFFORT when lower. */
export function personEffort(effort: Effort): Effort {
  return effortRank(effort) < effortRank(PERSON_EFFORT) ? PERSON_EFFORT : effort;
}
