// Routing limits shared by router.ts and model-list.ts (moved out of router.ts unchanged, RT4):
// the error that says why no model fits a turn (no model, a missing capability, "never" priors, the policy band,
// or every account limited – with the earliest moment one is back; D8 (B-080): "paused" while they only cool for a few
// minutes after a provider error), and D1 (B-083): why a model I named cannot run now – the lead of my route's reason.
// Owns: these texts and when a model's accounts are back (backAt). Never: routes, or changes state.

import type { RouteRequest, RuntimeServices } from '../contracts.ts';
import type { Account, ModelInfo } from '../../shared/model/providers.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { blockedUntil } from '../accounts/candidates.ts';
import { LIMIT_COOLDOWN_MS } from '../accounts/failure.ts';
import { profileZone, stampText } from '../context/time.ts';
import { categoryLabel } from './categories.ts';
import { pinProblem } from './pins.ts';
import type { Pool } from './pool.ts';
import type { Need } from './score.ts';

export const NO_MODEL_MESSAGE = 'No model is connected. Add an account in Settings → Models.';
/** Models fit, but every account that could run them is limited: an outage (B-059: a chat-free run waits for it, tasks/outages.ts). */
export const LIMITED_MESSAGE = 'Every account that can run a suitable model is limited right now.';
/** D8 (B-080): every fitting account only cools for a few minutes after a provider error – no used-up window. */
export const PAUSED_MESSAGE = 'Every account that can run a suitable model is paused for a few minutes after a provider error.';
const NEED_TEXT: Record<Need, string> = {
  vision: 'No connected model can read images.',
  computerUse: 'No connected model supports computer use.',
  structured: 'No connected model supports structured answers.',
};

/**
 * When the models' accounts are back: the earliest blockedUntil (cooling or a used-up window) of the enabled ones – every
 * signed-in plan takes turns since 09.11.2026 (accounts/candidates.ts selectCandidates); `limited` = the account back first
 * waits for a used-up window, not only a cooling.
 */
export function backAt(s: Pick<RuntimeServices, 'accounts'>, models: readonly ModelInfo[], now: number): { until?: number; limited: boolean } {
  let accounts: Account[] = [];
  try { accounts = s.accounts.list().filter((account) => account.enabled); } catch { /* accounts that cannot be read: no time known */ }
  const byId = new Map(accounts.map((account) => [account.id, account]));
  let until: number | undefined;
  let limited = false;
  for (const model of models) {
    for (const id of model.accounts) {
      const account = byId.get(id);
      if (!account) continue;
      const at = blockedUntil(account, now, model.model);
      if (at === undefined || (until !== undefined && at >= until)) continue;
      until = at;
      limited = blockedUntil({ ...account, coolingUntil: undefined }, now, model.model) !== undefined; // as accounts/plan-hold.ts
    }
  }
  return { ...(until !== undefined ? { until } : {}), limited };
}

/** D8: only a short cooling after a provider error – "a few minutes" stays true (a 402 cools 6 h and reads "limited"). */
export function pausedOnly(back: { until?: number; limited: boolean }, now: number): boolean {
  return !back.limited && back.until !== undefined && back.until - now <= LIMIT_COOLDOWN_MS;
}

/** The first filter stage that left nothing, as the error the turn reports. */
export function nothingFits(input: {
  s: RuntimeServices; request: RouteRequest; connected: ModelInfo[]; capable: ModelInfo[]; suitable: ModelInfo[];
  bounded: ModelInfo[]; category: string; now: number;
}): WorkforceError {
  const { request, connected, capable, suitable, bounded } = input;
  if (!connected.length) return new WorkforceError('unavailable', request.exclude?.length ? 'No other model is available right now.' : NO_MODEL_MESSAGE);
  if (!capable.length) {
    const need = (['vision', 'computerUse', 'structured'] as Need[]).find((item) => request.needs?.[item]) ?? 'vision';
    return new WorkforceError('unavailable', NEED_TEXT[need], { details: { need, setup: true } });
  }
  // setup: true – the person (or the manager) has to change the setup; no outage that heals itself.
  if (!suitable.length) return new WorkforceError('unavailable', `No connected model is suitable for ${categoryLabel(input.category)}.`, { details: { setup: true } });
  if (!bounded.length) return new WorkforceError('unavailable', `No connected model fits the model policy of ${request.agent.name}.`, { details: { setup: true } });
  // Models fit, but every account that could run them is limited, excluded or unhealthy right now:
  // the earliest moment one of them is back (cooling or a used-up window of that model).
  const back = backAt(input.s, bounded, input.now);
  return new WorkforceError('unavailable', pausedOnly(back, input.now) ? PAUSED_MESSAGE : LIMITED_MESSAGE, back.until ? { retryAfterMs: back.until - input.now } : {});
}

/**
 * D1: "asked for <name> – <why it cannot run now>", the lead of the reason of my route when the model I named does not
 * run. No " · " inside: a route line shows the reason's first part.
 */
export function askedMiss(input: AskedInput): string {
  return `asked for ${input.named?.name ?? input.request.previous?.modelId ?? 'a model'} – ${missWhy(input)}`;
}

interface AskedInput { s: RuntimeServices; request: RouteRequest; pool: Pool; named?: ModelInfo; category: string; now: number }

function missWhy({ s, request, pool, named, category, now }: AskedInput): string {
  if (!named || !named.available) return 'no account of it is connected';
  const exclude = new Set(request.exclude ?? []);
  if (exclude.has(named.id) || named.accounts.some((id) => exclude.has(id))) return 'it just failed in this turn';
  const why = pool.unusable(named) ?? (pool.inBand(named) ? undefined : 'policy');
  if (why) return pinProblem(why, category);
  if (!pool.tiered.some((model) => model.id === named.id)) return 'below the tier this mode asks for';
  if (pool.accountsFor(named).length) return 'only a pay-per-use key runs it';
  const back = backAt(s, [named], now);
  const when = back.until !== undefined ? ` (${pausedOnly(back, now) ? 'paused' : 'limited'} until ${stampText(back.until, profileZone(s), now)})` : '';
  return `no account of it can run now${when}`;
}
