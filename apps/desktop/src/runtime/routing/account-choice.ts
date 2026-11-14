// AF-021: the chosen account of a turn (shared/model/account-choice.ts: chat choice → agent default → automatic),
// applied to the route the router picked (router.ts, after every other rule). The choice steers only models of its
// own provider. A chosen account that can run the model replaces the router's pick – also a plan login outside
// rotation or a pay-per-use key: the person chose it. One that cannot (used up, signed out, off, without that model,
// or it just failed) stops the turn ('ask', a WorkforceError whose details.accountChoice the failed message keeps) or
// lets the route's own account run, marked accountSwitch so the turn says so in the chat ('switch').
// Owns: that check. Never: stores anything or picks a model.

import type { RuntimeServices } from '../contracts.ts';
import type { Account, ModelInfo, RouteDecision } from '../../shared/model/providers.ts';
import type { Agent } from '../../shared/model/org.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { accountChoiceOf, accountFallbackOf, stopText, switchText, type AccountChoice, type AccountProblem, type AccountStop } from '../../shared/model/account-choice.ts';
import { planNames } from '../../shared/model/plan-names.ts';
import { isPlanProvider } from '../../shared/model/plan-roles.ts';
import { blockedUntil } from '../accounts/candidates.ts';
import { PROVIDER_LABELS } from '../accounts/service-shape.ts';

/** The choice for this agent in this chat (precedence in shared/model/account-choice.ts). */
export function chosenAccount(s: Pick<RuntimeServices, 'chats'>, agent: Pick<Agent, 'id' | 'modelPolicy'>, conversationId: string | undefined): AccountChoice | undefined {
  const chat = conversationId ? s.chats.get(conversationId)?.settings.accounts?.[agent.id] : undefined;
  return accountChoiceOf(chat, agent.modelPolicy?.account);
}

/** Why `account` cannot run `model` now; undefined = it can. */
export function accountProblem(account: Account, model: ModelInfo, now: number, exclude: ReadonlySet<string>): { problem: AccountProblem; until?: number } | undefined {
  if (!account.enabled || account.state === 'disabled') return { problem: 'off' };
  if (account.state === 'needs_login' || account.state === 'error') return { problem: 'signed_out' };
  if (exclude.has(account.id)) return { problem: 'failed' };
  if (model.accounts.length && !model.accounts.includes(account.id)) return { problem: 'model' };
  const until = blockedUntil(account, now, model.model);
  return until !== undefined ? { problem: 'limit', until } : undefined;
}

/** The short name the person knows the account by (the quota rail's plan name, else its label). */
export function accountName(accounts: readonly Account[], account: Account): string {
  if (isPlanProvider(account.provider)) {
    const name = planNames(accounts.filter((entry) => isPlanProvider(entry.provider)), PROVIDER_LABELS).get(account.id);
    if (name) return name;
  }
  return account.label.trim() || account.provider;
}

export interface ChoiceInput {
  decision: RouteDecision;
  choice: AccountChoice | undefined;
  model: ModelInfo | undefined;
  accounts: readonly Account[];
  now: number;
  exclude: ReadonlySet<string>;
  fallback: unknown;
}

/** The chat line of a 'switch' route ("fritz2 has used up its limit – this turn runs on fritz1."); undefined without one. */
export function switchLine(accounts: readonly Account[], route: RouteDecision): string | undefined {
  if (!route.accountSwitch) return undefined;
  const from = accounts.find((entry) => entry.id === route.accountSwitch!.from);
  const to = accounts.find((entry) => entry.id === route.accountId);
  return switchText(from ? accountName(accounts, from) : 'The chosen account', route.accountSwitch.problem, to ? accountName(accounts, to) : 'another account');
}

/** The route with the chosen account applied (see the header); throws the stop in 'ask'. */
export function applyAccountChoice(input: ChoiceInput): RouteDecision {
  const { decision, choice, model } = input;
  if (!choice || !model || decision.accountId === choice.accountId) return decision;
  const account = input.accounts.find((entry) => entry.id === choice.accountId);
  if (!account || account.provider !== model.provider) return decision; // removed, or another provider's account: not this turn's
  const trouble = accountProblem(account, model, input.now, input.exclude);
  const whose = choice.source === 'chat' ? 'account chosen in this chat' : "the agent's account";
  if (!trouble) return { ...decision, accountId: account.id, reason: `${decision.reason} · ${whose}` };
  if (accountFallbackOf(input.fallback) === 'switch') {
    return { ...decision, accountSwitch: { from: account.id, problem: trouble.problem, source: choice.source } };
  }
  const stop: AccountStop = { accountId: account.id, provider: account.provider, problem: trouble.problem, source: choice.source, ...(trouble.until ? { until: trouble.until } : {}) };
  throw new WorkforceError('unavailable', stopText(accountName(input.accounts, account), trouble.problem, choice.source), {
    details: { setup: true, accountChoice: stop }, // setup: the person decides – no quiet retry (agents/redelivery.ts)
  });
}
