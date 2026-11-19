// AF-023: which account runs a route when the one it was meant for cannot (used up, cooling, signed out, just failed).
// The router picks a model and an account among the runnable ones (router.ts); this step then looks at the account the
// route was meant for – the chat's or agent's choice (AF-021, shared/model/account-choice.ts), else the provider's first
// usable account for the wanted model (a pin whose accounts are all used up, else the picked model) – and:
//   it can run → the choice is applied (or the router's own pick stays, also a rotation plan's);
//   it cannot → 'ask' with a choice: the AF-021 stop; otherwise the use's fallback order in Settings › Models
//     (settings.json routing.fallbacks, shared/model/account-fallback.ts) – the first step whose account can run its model
//     now –, else the router's automatic pick (the same provider's next account with the same model first – accounts/
//     candidates.ts lets it stand in –, else the most similar model elsewhere, closestModel). The route is marked
//     accountSwitch {from, problem, until}, so the chat says so (account-choice.ts switchLine) – never silent.
// Steps name accounts of any provider (Claude, Codex, API keys, local servers – and Google Gemini in AF-024).
// Every account runs at most once per failure chain: the turn's failover passes the accounts that failed (exclude).
// Owns: that step and the nearest-model rule. Never: stores anything or reads settings itself (router.ts passes them).

import type { Account, ModelInfo, RouteDecision } from '../../shared/model/providers.ts';
import type { FallbackStep } from '../../shared/model/account-fallback.ts';
import { accountFallbackOf, stopText, type AccountChoice, type AccountStop } from '../../shared/model/account-choice.ts';
import { byPriority, isUsableState } from '../../shared/model/plan-roles.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { clampEffort } from '../models/efforts.ts';
import { accountName, accountProblem } from './account-choice.ts';
import { resolvePin } from './pins.ts';
import { tierRank } from './score.ts';

/** AF-024: a model id without its path – the Gemini API lists "models/gemini-2.5-pro", Gemini CLI "gemini-2.5-pro". */
const bareId = (id: string) => id.slice(id.lastIndexOf('/') + 1).toLowerCase();

/** How far `model` is from `target`: the same model elsewhere 0, else the tier distance + 1. */
function distance(target: ModelInfo, model: ModelInfo): number {
  if (model.model === target.model || bareId(model.model) === bareId(target.model)) return 0;
  return 1 + Math.abs(tierRank(model.tier) - tierRank(target.tier));
}

/** The item whose model is nearest to `target` (ties keep the given order – the router's score). */
export function closestModel<T>(target: ModelInfo, items: readonly T[], modelOf: (item: T) => ModelInfo): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const item of items) {
    const d = distance(target, modelOf(item));
    if (d < bestDistance) { best = item; bestDistance = d; }
  }
  return best;
}

/** The account a route on `model` is meant for when nobody chose one: the provider's first usable account (priority). */
export function intendedAccount(accounts: readonly Account[], model: ModelInfo): Account | undefined {
  return accounts.filter((account) => account.provider === model.provider && (!model.accounts.length || model.accounts.includes(account.id)) && isUsableState(account))
    .sort(byPriority)[0];
}

export interface SettleInput {
  decision: RouteDecision;
  choice: AccountChoice | undefined;
  /** The model the route was meant to run when it differs from the pick (a pin whose accounts all cannot run). */
  wanted?: ModelInfo;
  models: readonly ModelInfo[];
  accounts: readonly Account[];
  now: number;
  /** Accounts (and models) that failed in this turn's chain: never again. */
  exclude: ReadonlySet<string>;
  /** settings.json routing.accountFallback. */
  fallback: unknown;
  /** The use's fallback order (settings.json routing.fallbacks.<use>). */
  order: readonly FallbackStep[];
  /** Whether a model can serve this route at all (available, the turn's needs). */
  runnable: (model: ModelInfo) => boolean;
}

/** The model a step runs on `account`: its own, else the wanted one (same provider) or the nearest that account offers. */
function stepModel(input: SettleInput, step: FallbackStep, account: Account, wanted: ModelInfo): ModelInfo | undefined {
  if (step.model) return resolvePin(input.models, step.model);
  if (wanted.provider === account.provider && (!wanted.accounts.length || wanted.accounts.includes(account.id))) return wanted;
  const offered = input.models.filter((model) => model.provider === account.provider && model.available
    && (!model.accounts.length || model.accounts.includes(account.id)) && input.runnable(model));
  return closestModel(wanted, offered, (model) => model);
}

/** The first step of the order that can run now (not the troubled account, not failed in this chain). */
export function orderStep(input: SettleInput, from: Account, wanted: ModelInfo): { account: Account; model: ModelInfo } | undefined {
  for (const step of input.order) {
    if (step.account === from.id || input.exclude.has(step.account)) continue;
    const account = input.accounts.find((entry) => entry.id === step.account);
    if (!account) continue;
    const model = stepModel(input, step, account, wanted);
    if (!model || model.provider !== account.provider || !model.available || input.exclude.has(model.id) || !input.runnable(model)) continue;
    if (accountProblem(account, model, input.now, input.exclude)) continue;
    return { account, model };
  }
  return undefined;
}

/** The route with the account settled (see the header); throws the AF-021 stop in 'ask'. */
export function settleAccount(input: SettleInput): RouteDecision {
  const { decision, choice } = input;
  const picked = input.models.find((model) => model.id === decision.modelId);
  const wanted = input.wanted ?? picked;
  if (!picked || !wanted) return decision;
  const chosen = choice ? input.accounts.find((entry) => entry.id === choice.accountId) : undefined;
  const byChoice = chosen && chosen.provider === wanted.provider ? chosen : undefined; // a choice steers its own provider only
  const from = byChoice ?? intendedAccount(input.accounts, wanted);
  if (!from || (from.id === decision.accountId && wanted.id === decision.modelId)) return decision;
  const trouble = accountProblem(from, wanted, input.now, input.exclude);
  if (!trouble) {
    if (!byChoice || wanted.id !== decision.modelId) return decision; // automatic: the router's own pick stays
    const whose = choice!.source === 'chat' ? 'account chosen in this chat' : "the agent's account";
    return { ...decision, accountId: from.id, reason: `${decision.reason} · ${whose}` };
  }
  if (byChoice && accountFallbackOf(input.fallback) === 'ask') {
    const stop: AccountStop = { accountId: from.id, provider: from.provider, problem: trouble.problem, source: choice!.source, ...(trouble.until ? { until: trouble.until } : {}) };
    throw new WorkforceError('unavailable', stopText(accountName(input.accounts, from), trouble.problem, choice!.source), {
      details: { setup: true, accountChoice: stop }, // setup: the person decides – no quiet retry (agents/redelivery.ts)
    });
  }
  const marks = { from: from.id, problem: trouble.problem, source: byChoice ? choice!.source : 'auto' as const, ...(trouble.until ? { until: trouble.until } : {}) };
  const step = orderStep(input, from, wanted);
  if (step) {
    return {
      ...decision, modelId: step.model.id, engine: step.model.engine, accountId: step.account.id, effort: clampEffort(decision.effort, step.model.efforts),
      reason: `${decision.reason} · fallback order in Settings`, accountSwitch: { ...marks, byOrder: true },
    };
  }
  return { ...decision, accountSwitch: marks };
}
