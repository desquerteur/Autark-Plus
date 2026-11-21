// B-083: the catalog's order. The newest version of each model family stands on top ("Fable 5.1" above "Fable 5",
// "Opus 5.5" above "Opus 4.6"), weaker but current models (Haiku 5.5, GPT-6 Luna) stay among the current ones, and the
// older versions of a family follow below with `newer` naming that family's newest. Family and version come from the
// provider model id alone, so plans, API keys, gateways and local servers all sort the same way.
// Owns: the current/older split (the family/version parse is family.ts), ModelInfo.newer and the catalog list order.
// Never: I/O, mutating its input, or reordering the specialists among themselves (media, decision and embedding models
// stay at the end in provider/name order – the chat menu never shows them).

import type { ModelInfo } from '../../shared/model/providers.ts';
import { byProviderName } from './catalog-merge.ts';
import { compareVersions, familyOf, type Family } from './family.ts';

export { compareVersions, familyOf, type Family } from './family.ts';

const TIER_RANK: Record<ModelInfo['tier'], number> = { frontier: 0, strong: 1, small: 2, local: 3 };
/** A chat strength at or below this means "never" (routing/score.ts NEVER): a specialist the chat menu never shows. */
const NEVER = -0.95;

function isSpecialist(model: ModelInfo): boolean {
  return Boolean(model.functions?.length) || (model.strengths.chat ?? 0) <= NEVER;
}

function withNewer(model: ModelInfo, newer?: string): ModelInfo {
  const copy = { ...model };
  delete copy.newer;
  if (newer) copy.newer = newer;
  return copy;
}

/**
 * The catalog list (pure, returns copies): current models first (no model of the same family has a higher version) by
 * smarts – a model without one borrows it from a sibling of the same family and version, e.g. a gateway's
 * anthropic/claude-opus-5.5 from claude-opus-5-5, else the family's best, so a release the priors do not know yet
 * stands where its predecessor stood – then tier, provider and name; then the older versions grouped under
 * their family's place, newest version first, each with `newer` = its family's newest (an available one when there is
 * one); then the specialists in provider/name order.
 */
export function catalogOrder(models: readonly ModelInfo[]): ModelInfo[] {
  const chat = models.filter((model) => !isSpecialist(model));
  const parsed = new Map(chat.map((model) => [model, familyOf(model.model)]));
  const of = (model: ModelInfo): Family => parsed.get(model)!;
  const key = (model: ModelInfo): string => `${of(model).family} ${of(model).version.join('.')}`;
  const top = new Map<string, number[]>();
  const smartsOf = new Map<string, number>();
  const familySmarts = new Map<string, number>();
  for (const model of chat) {
    const { family, version } = of(model);
    const best = top.get(family);
    if (!best || compareVersions(version, best) > 0) top.set(family, version);
    if (model.smarts === undefined) continue;
    smartsOf.set(key(model), Math.max(smartsOf.get(key(model)) ?? 0, model.smarts));
    familySmarts.set(family, Math.max(familySmarts.get(family) ?? 0, model.smarts));
  }
  const smarts = (model: ModelInfo): number => model.smarts ?? smartsOf.get(key(model)) ?? familySmarts.get(of(model).family) ?? -1;
  const rank = (a: ModelInfo, b: ModelInfo): number => smarts(b) - smarts(a) || TIER_RANK[a.tier] - TIER_RANK[b.tier] || byProviderName(a, b);
  const isCurrent = (model: ModelInfo): boolean => compareVersions(of(model).version, top.get(of(model).family)!) === 0;
  const current = chat.filter(isCurrent).sort(rank);
  const place = new Map<string, number>();
  const newest = new Map<string, ModelInfo>();
  current.forEach((model, index) => {
    const { family } = of(model);
    if (!place.has(family)) place.set(family, index);
    const head = newest.get(family);
    if (!head || (!head.available && model.available)) newest.set(family, model);
  });
  const older = chat.filter((model) => !isCurrent(model))
    .sort((a, b) => place.get(of(a).family)! - place.get(of(b).family)! || compareVersions(of(b).version, of(a).version) || rank(a, b));
  return [
    ...current.map((model) => withNewer(model)),
    ...older.map((model) => withNewer(model, newest.get(of(model).family)!.id)),
    ...models.filter(isSpecialist).sort(byProviderName).map((model) => withNewer(model)),
  ];
}
