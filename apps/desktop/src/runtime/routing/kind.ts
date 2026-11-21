// Auto's default by an agent's kind (17.11.2026, the model settles – measured 15.–17.11.: seven of twelve employees ran on
// their managers' model, and nobody had a model of their own). An agent that leads (org/standard.ts leads: an active
// report, or hired from the manager or head template) runs on the strongest tier connected, on that tier's first choice;
// an agent that executes runs on the strong tier's best value (the strongest tier where no strong one is connected). The
// person's Model choice in Settings shifts both: Best puts everyone on the strongest tier, Cheaper one tier lower. A model
// fits its kind while its tier is the kind's tier – an agent on such a model stays on it, one that drifted moves when its
// context starts anew (router.ts). Everything comes from the router's own pool and ranking: no model is named here.
// Owns: the kind's tier, its default pick and the reason that names it. Never: reads the catalog or accounts itself,
// or changes state.

import type { PoolEntry } from './pool.ts';
import { TIER_ORDER } from './policies.ts';
import { firstChoice } from './person-turn.ts';
import { tierRank, type CostMode, type Tier } from './score.ts';

/** The tier Auto settles this kind on, from the tiers the pool holds; undefined for an empty pool. */
export function kindTier(pool: readonly Pick<PoolEntry, 'model'>[], lead: boolean, costMode: CostMode): Tier | undefined {
  const present = [...TIER_ORDER].reverse().filter((tier) => pool.some((entry) => entry.model.tier === tier)); // strongest first
  if (!present.length) return undefined;
  const top = present[0];
  const strong = present.includes('strong') ? 'strong' : top;
  const below = present.find((tier) => tierRank(tier) < tierRank(strong)) ?? strong;
  const step = costMode === 'best' ? 0 : (lead ? 0 : 1) + (costMode === 'economy' ? 1 : 0);
  return [top, strong, below][step];
}

/**
 * The kind's default from `pool`: on the strongest tier its first choice (smarts against list price, person-turn.ts
 * firstChoice over the ranking in cost mode 'best'), below it the tier's best value (the router's ranking in the person's
 * cost mode). `why` is the route reason's segment.
 */
export function kindDefault<R extends PoolEntry & { score?: number }>(input: {
  pool: readonly PoolEntry[]; rank: (entries: readonly PoolEntry[], mode: CostMode) => R[]; lead: boolean; costMode: CostMode;
}): { entry: R; why: string } | undefined {
  const tier = kindTier(input.pool, input.lead, input.costMode);
  if (!tier) return undefined;
  const inTier = input.pool.filter((entry) => entry.model.tier === tier);
  const strongest = input.pool.every((entry) => tierRank(entry.model.tier) <= tierRank(tier));
  const entry = strongest ? firstChoice(input.rank(inTier, 'best')) : input.rank(inTier, input.costMode)[0];
  const work = input.lead ? 'leading' : 'executing';
  return entry ? { entry, why: `${work} runs on the ${tier} tier's ${strongest ? 'first choice' : 'best value'}` } : undefined;
}
