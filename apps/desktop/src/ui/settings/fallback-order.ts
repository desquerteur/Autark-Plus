// AF-023: Settings › Models – the fallback order of a use (Work, Decisions): "if the account is used up, take …". The
// steps are shown by name ("fritz2 · Same model", "Codex · GPT-6.1 Sol"), can be added (an account that serves the
// use, and optionally one of its models), moved up and down and removed; an empty order is Automatic. A pick writes
// settings.json routing.fallbacks.<use> (the whole list; the runtime checks it, shared/model/account-fallback.ts).
// Owns: these rules. Never: draws (FallbackOrder.tsx) or decides what runs (runtime/routing/account-fallback.ts).

import type { Account, ModelInfo, UsageSummary } from '../../shared/model/providers.ts';
import { MAX_FALLBACK_STEPS, type FallbackStep, type FallbackUse } from '../../shared/model/account-fallback.ts';
import { modelsFor } from '../../shared/model/models-uses.ts';
import type { RoutingSettings } from '../../shared/model/system.ts';
import { servingAccounts } from './uses-view.ts';

/** The model select's value for "the same model (or the nearest one this account has)". */
export const SAME_MODEL = '';

export interface StepView {
  key: string;
  account: string;
  model: string;
  /** "fritz2 · Same model". */
  label: string;
  /** The step's account is gone or turned off: it is skipped until it is back. */
  missing: boolean;
}

/** The short name of an account: the quota rail's plan name, else its label (never an e-mail domain). */
export function accountLabel(account: Account, usage: readonly UsageSummary[]): string {
  const name = (usage.find((entry) => entry.accountId === account.id)?.name?.trim() || account.label.trim() || account.provider);
  const at = name.indexOf('@');
  return (at > 0 ? name.slice(0, at) : name) || account.provider;
}

/** The order's steps as the list shows them. */
export function stepViews(order: readonly FallbackStep[], accounts: readonly Account[], models: readonly ModelInfo[], usage: readonly UsageSummary[]): StepView[] {
  return order.map((step, index) => {
    const account = accounts.find((entry) => entry.id === step.account);
    const model = step.model ? models.find((entry) => entry.id === step.model) : undefined;
    const who = account ? accountLabel(account, usage) : 'Removed account';
    const what = step.model ? model?.name ?? step.model.slice(step.model.indexOf(':') + 1) : 'Same model';
    return { key: `${index}:${step.account}:${step.model ?? ''}`, account: step.account, model: step.model ?? SAME_MODEL, label: `${who} · ${what}`, missing: !account || !account.enabled };
  });
}

/** The accounts a step can name: those that serve the use (in the accounts' order). */
export function accountChoices(use: FallbackUse, accounts: readonly Account[], models: readonly ModelInfo[], usage: readonly UsageSummary[]): Array<{ value: string; label: string }> {
  return servingAccounts(use, models, accounts).filter((account) => account.enabled).map((account) => ({ value: account.id, label: accountLabel(account, usage) }));
}

/** The models of one account for the use, after "Same model". */
export function modelChoices(use: FallbackUse, accountId: string, accounts: readonly Account[], models: readonly ModelInfo[]): Array<{ value: string; label: string }> {
  const account = accounts.find((entry) => entry.id === accountId);
  const own = account ? modelsFor(use, models).filter((model) => model.provider === account.provider && (!model.accounts.length || model.accounts.includes(account.id))) : [];
  return [{ value: SAME_MODEL, label: 'Same model' }, ...own.map((model) => ({ value: model.id, label: model.name }))];
}

/** The order with one more step at the end (a step already in it, or one too many, changes nothing). */
export function withStep(order: readonly FallbackStep[], account: string, model: string): FallbackStep[] {
  const step: FallbackStep = model ? { account, model } : { account };
  if (!account || order.length >= MAX_FALLBACK_STEPS || order.some((entry) => entry.account === step.account && entry.model === step.model)) return [...order];
  return [...order, step];
}

/** The order with step `index` moved by `delta` (−1 up, +1 down); at an end nothing moves. */
export function moved(order: readonly FallbackStep[], index: number, delta: -1 | 1): FallbackStep[] {
  const target = index + delta;
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The order without step `index`. */
export function without(order: readonly FallbackStep[], index: number): FallbackStep[] {
  return order.filter((_, at) => at !== index);
}

/** The settings patch that stores `order` for `use` (an empty list = Automatic). */
export function orderPatch(use: FallbackUse, order: readonly FallbackStep[]): { routing: Partial<RoutingSettings> } {
  return { routing: { fallbacks: { [use]: order.map((step) => (step.model ? { account: step.account, model: step.model } : { account: step.account })) } } };
}

/** The row's quiet line. */
export function orderHint(order: readonly FallbackStep[]): string {
  return order.length
    ? 'Tried top to bottom; a step that cannot run is skipped, then Automatic'
    : 'Automatic: the same model on the next account, else the most similar model elsewhere';
}
