// AF-021: the chosen account of a turn (shared/model/account-choice.ts: chat choice → agent default → automatic), why an
// account cannot run a model now, the name the person knows it by and the chat line of a switch. Applying the choice to
// a route – and what runs when the account cannot (AF-023: 'ask' stop, the use's fallback order, automatic) – is
// account-fallback.ts settleAccount, the router's last step.
// Owns: these lookups and the line. Never: stores anything or picks a model.

import type { RuntimeServices } from '../contracts.ts';
import type { Account, ModelInfo, RouteDecision } from '../../shared/model/providers.ts';
import type { Agent } from '../../shared/model/org.ts';
import { accountChoiceOf, type AccountChoice, type AccountProblem } from '../../shared/model/account-choice.ts';
import { switchedText } from '../../shared/model/account-fallback.ts';
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
  const until = blockedUntil(account, now, model.model);
  if (exclude.has(account.id)) return until !== undefined ? { problem: 'limit', until } : { problem: 'failed' }; // AF-023: a failed limit says until when
  if (model.accounts.length && !model.accounts.includes(account.id)) return { problem: 'model' };
  return until !== undefined ? { problem: 'limit', until } : undefined;
}

/** The short name the person knows the account by (the quota rail's plan name, else its label). */
export function accountName(accounts: readonly Account[], account: Account): string {
  let name: string | undefined;
  if (isPlanProvider(account.provider)) name = planNames(accounts.filter((entry) => isPlanProvider(entry.provider)), PROVIDER_LABELS).get(account.id);
  name = (name || account.label).trim();
  // AF-023: chat lines name accounts – never an e-mail address's domain (a label may be one)
  const at = name.indexOf('@');
  return (at >= 0 ? name.slice(0, at).trim() : name) || account.provider;
}

/**
 * The chat line of a switched route (AF-023 wording, shared/model/account-fallback.ts): "Switched to fritz2 – fritz1 is
 * used up until 14:00." – with the model when the switch also changed it; undefined without a switch.
 */
export function switchLine(accounts: readonly Account[], route: RouteDecision, timeZone?: string, now = Date.now(), modelName?: string): string | undefined {
  const marks = route.accountSwitch;
  if (!marks) return undefined;
  const from = accounts.find((entry) => entry.id === marks.from);
  const to = accounts.find((entry) => entry.id === route.accountId);
  return switchedText({
    to: to ? accountName(accounts, to) : 'another account', ...(modelName ? { model: modelName } : {}),
    from: from ? accountName(accounts, from) : 'The chosen account', problem: marks.problem, until: marks.until, now, timeZone,
  });
}
