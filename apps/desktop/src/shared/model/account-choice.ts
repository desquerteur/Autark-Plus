// AF-021: which account runs an agent's turn when a provider has several (two Claude plans "fritz1" and "fritz2").
// The choice lives in two places – the chat's choice per agent (ConversationSettings.accounts[agentId], the composer's
// model menu) and the agent's default (ModelPolicy.account, the agent page) – and the first one set wins:
//   chat choice → agent default → automatic (the router's own pick: the plan quota that resets soonest);
//   'auto' stored for the chat is "Automatic" picked there on purpose – it beats the agent's default.
// A choice only steers models of its own provider (a Claude account never turns a GPT turn into a Claude one).
// When the chosen account cannot run (used up, signed out, off, or it just failed), settings.json
// routing.accountFallback decides: 'ask' (default) – the turn stops with a clear line in the chat and the choices
// "another account" / "automatic"; 'switch' – the turn runs on another account and the chat says so. Never silent.
// Owns: the precedence rule, the problem words and the shape of the stop. Never: checks an account's health
// (runtime/routing/account-choice.ts does) or stores anything.

import type { AccountSwitch } from './providers.ts';

/** 'auto' (or nothing) = no choice: the router picks. */
export const ACCOUNT_AUTO = 'auto';

export type AccountChoiceSource = AccountSwitch['source'];

export interface AccountChoice {
  accountId: string;
  source: AccountChoiceSource;
}

/** What to do when the chosen account cannot run: stop and ask, or switch with a notice. */
export type AccountFallback = 'ask' | 'switch';
export const ACCOUNT_FALLBACKS: readonly AccountFallback[] = ['ask', 'switch'];
export const DEFAULT_ACCOUNT_FALLBACK: AccountFallback = 'ask';

/** Why a chosen account cannot run this turn. */
export type AccountProblem = AccountSwitch['problem'];

/** The stop a turn carries (WorkforceError details.accountChoice, then the failed message's meta.accountChoice). */
export interface AccountStop {
  accountId: string;
  provider: string;
  problem: AccountProblem;
  source: AccountChoiceSource;
  /** When a used-up account can run again (epoch ms), when known. */
  until?: number;
}

const usable = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value !== ACCOUNT_AUTO;

/**
 * The precedence rule: the chat's choice, else the agent's default, else none (automatic). The chat's 'auto' is a
 * choice too – "Automatic" picked in this chat beats the agent's default; no entry at all leaves it to the agent.
 */
export function accountChoiceOf(chatChoice: unknown, agentDefault: unknown): AccountChoice | undefined {
  if (chatChoice === ACCOUNT_AUTO) return undefined;
  if (usable(chatChoice)) return { accountId: chatChoice, source: 'chat' };
  if (usable(agentDefault)) return { accountId: agentDefault, source: 'agent' };
  return undefined;
}

/** The fallback setting, read defensively (an older settings.json has none). */
export function accountFallbackOf(value: unknown): AccountFallback {
  return value === 'switch' ? 'switch' : DEFAULT_ACCOUNT_FALLBACK;
}

const PROBLEM_TEXT: Record<AccountProblem, string> = {
  limit: 'has used up its limit',
  signed_out: 'is signed out',
  off: 'is turned off',
  model: 'cannot run this model',
  failed: 'just failed',
};

/** "fritz2 has used up its limit" – one short English line part. */
export function problemText(name: string, problem: AccountProblem): string {
  return `${name} ${PROBLEM_TEXT[problem]}`;
}

/** The chat line of a stop ('ask'). */
export function stopText(name: string, problem: AccountProblem, source: AccountChoiceSource): string {
  const whose = source === 'chat' ? 'the account chosen for this chat' : "the agent's default account";
  return `${problemText(name, problem)} – ${whose}. Choose another account or Automatic.`;
}

/** The chat line of a switch ('switch'). */
export function switchText(name: string, problem: AccountProblem, other: string): string {
  return `${problemText(name, problem)} – this turn runs on ${other}.`;
}

/** Reads a stop from untrusted message meta / error details. */
export function readStop(value: unknown): AccountStop | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  if (typeof o.accountId !== 'string' || typeof o.provider !== 'string') return undefined;
  if (!Object.hasOwn(PROBLEM_TEXT, String(o.problem)) || (o.source !== 'chat' && o.source !== 'agent')) return undefined;
  return { accountId: o.accountId, provider: o.provider, problem: o.problem as AccountProblem, source: o.source, ...(typeof o.until === 'number' ? { until: o.until } : {}) };
}
