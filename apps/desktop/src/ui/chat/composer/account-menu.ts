// AF-021: the account choice in the model menu, on the agent page and under a failed turn – which accounts a
// provider offers (enabled, by priority) with their short name (the quota rail's plan name, else the label), the
// share left of their tightest limit window and when it resets, or why they cannot run now; what is selected
// (chat choice → agent default → Automatic, shared/model/account-choice.ts); what a pick writes; and the account
// the chip names (only where the provider has more than one).
// Owns: these rules. Never: draws, saves or decides the runtime's route.

import type { Account, UsageSummary } from '../../../shared/model/providers.ts';
import { ACCOUNT_AUTO, accountChoiceOf } from '../../../shared/model/account-choice.ts';
import { leftOf, shortReset } from '../../lib/limits.ts';

export interface AccountOption {
  id: string;
  provider: string;
  name: string;
  /** Share left of the tightest window that still applies (0..100); undefined = unknown. */
  left?: number;
  /** When that window (or the cooling) ends. */
  resetsAt?: number;
  /** Why it cannot run now. */
  trouble?: 'limit' | 'signed_out' | 'off';
}

const byPriority = (a: Account, b: Account) => a.priority - b.priority || a.createdAt - b.createdAt;

/** The accounts of `provider` the person can choose, by priority. */
export function accountOptions(accounts: readonly Account[], usage: readonly UsageSummary[], provider: string | undefined, now: number): AccountOption[] {
  if (!provider) return [];
  return accounts.filter((account) => account.provider === provider && account.enabled).sort(byPriority).map((account) => {
    const name = usage.find((entry) => entry.accountId === account.id)?.name?.trim() || account.label.trim() || provider;
    let left: number | undefined;
    let resetsAt: number | undefined;
    for (const window of account.limits?.windows ?? []) {
      const share = leftOf(window, now);
      if (share === undefined) continue;
      if (left === undefined || share < left) { left = share; resetsAt = window.resetsAt; }
    }
    let trouble: AccountOption['trouble'];
    if (account.state === 'needs_login' || account.state === 'error') trouble = 'signed_out';
    else if (account.state === 'disabled') trouble = 'off';
    else if (account.coolingUntil !== undefined && account.coolingUntil > now) { trouble = 'limit'; resetsAt = Math.max(resetsAt ?? 0, account.coolingUntil); }
    else if (left === 0 && resetsAt !== undefined && resetsAt > now) trouble = 'limit';
    return { id: account.id, provider: account.provider, name, ...(left !== undefined ? { left } : {}), ...(resetsAt !== undefined ? { resetsAt } : {}), ...(trouble ? { trouble } : {}) };
  });
}

/** The quiet second line of an option: "62% left · resets 2h 5m", "Used up · resets 3h", "Signed out". */
export function optionMeta(option: AccountOption, now: number): string {
  const reset = option.resetsAt !== undefined ? shortReset(option.resetsAt, now) : undefined;
  if (option.trouble === 'signed_out') return 'Signed out';
  if (option.trouble === 'off') return 'Turned off';
  if (option.trouble === 'limit') return reset ? `Used up · resets ${reset}` : 'Used up';
  if (option.left === undefined) return 'Limit unknown';
  return reset ? `${option.left}% left · resets ${reset}` : `${option.left}% left`;
}

/** What the menu shows as chosen: an account id or 'auto', and whose choice it is. */
export function selectedAccount(chatAccounts: Readonly<Record<string, string>> | undefined, agentDefault: string | undefined, agentId: string): { value: string; source: 'chat' | 'agent' | 'auto' } {
  const choice = accountChoiceOf(chatAccounts?.[agentId], agentDefault);
  return choice ? { value: choice.accountId, source: choice.source } : { value: ACCOUNT_AUTO, source: 'auto' };
}

/**
 * The chat's accounts map after picking `value` (an account id or 'auto'). Automatic with an agent default stores
 * 'auto' (picked on purpose, it beats the default); without one the key goes.
 */
export function accountsWith(chatAccounts: Readonly<Record<string, string>> | undefined, agentId: string, value: string, agentDefault: string | undefined): Record<string, string> {
  const next = { ...(chatAccounts ?? {}) };
  if (value !== ACCOUNT_AUTO) next[agentId] = value;
  else if (agentDefault && agentDefault !== ACCOUNT_AUTO) next[agentId] = ACCOUNT_AUTO;
  else delete next[agentId];
  return next;
}

/**
 * The account the chip names: the chosen one, else the one routing takes now – only where the provider has more
 * than one account to choose from (one account needs no name).
 */
export function chipAccount(options: readonly AccountOption[], selected: string, routedAccountId: string | undefined): AccountOption | undefined {
  if (options.length < 2) return undefined;
  const id = selected !== ACCOUNT_AUTO ? selected : routedAccountId;
  return id ? options.find((option) => option.id === id) : undefined;
}
