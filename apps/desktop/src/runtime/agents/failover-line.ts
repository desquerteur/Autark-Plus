// AF-023: the chat lines of an account switch in a turn (turn.ts) – "Switched to fritz2 – fritz1 is used up until 14:00."
//   failover: an attempt failed on its account (limit, sign-out, outage) and the turn goes on elsewhere – the line names
//     the failed account, why, until when (its cooling or used-up window, accounts/candidates.ts blockedUntil) and,
//     when it changed, the model;
//   route time: the route was moved off a used-up account (RouteDecision.accountSwitch) – said once, not on every turn
//     while the account stays used up (the chat's last done run of the agent already ran on the same account).
// Owns: these lines and the once-rule. Never: routes, posts (turn.ts statusLine) or changes an account.

import type { RuntimeServices } from '../contracts.ts';
import type { Account, RouteDecision } from '../../shared/model/providers.ts';
import type { EngineTurnResult } from '../engines/types.ts';
import { switchedText, type SwitchProblem } from '../../shared/model/account-fallback.ts';
import { accountFailure } from '../accounts/failure.ts';
import { blockedUntil } from '../accounts/candidates.ts';
import { accountName, switchLine } from '../routing/account-choice.ts';

/** Most accounts a failure chain moves to in one turn (each account at most once – turn.ts keeps the tried ones). */
export const MAX_FAILOVERS = 6;
/** Runs looked at for the chat's last turn. */
const RECENT_RUNS = 50;

/** The accounts as the service lists them; [] when it cannot (a line is cosmetic, never a reason to stop a switch). */
const accountsOf = (services: Pick<RuntimeServices, 'accounts'>): Account[] => {
  try { return services.accounts.list(); } catch { return []; }
};

const timeZoneOf = (services: Pick<RuntimeServices, 'settings'>): string | undefined => {
  try { return services.settings.get().profile.timezone; } catch { return undefined; }
};

/** Why the failed attempt left its account, in the switch's words. */
function problemOf(result: EngineTurnResult): SwitchProblem {
  const failure = accountFailure(result);
  return failure === 'limit' ? 'limit' : failure === 'signed_out' ? 'signed_out' : 'failed';
}

/** The line after a failed attempt on `failed` (model `failedModel`) when the turn goes on on `next`. */
export function failoverLine(services: Pick<RuntimeServices, 'accounts' | 'clock' | 'settings'>, input: {
  failed: Account; failedModel: string; result: EngineTurnResult; next: RouteDecision; nextModelName: string; modelChanged: boolean;
}): string {
  const accounts = accountsOf(services);
  const now = services.clock.now();
  const fresh = accounts.find((entry) => entry.id === input.failed.id) ?? input.failed; // the failure was just recorded on it
  const to = accounts.find((entry) => entry.id === input.next.accountId);
  const problem = problemOf(input.result);
  const until = problem === 'limit' ? blockedUntil(fresh, now, input.failedModel) : undefined;
  return switchedText({
    to: to ? accountName(accounts, to) : 'another account', ...(input.modelChanged ? { model: input.nextModelName } : {}),
    from: accountName(accounts, fresh), problem, until, now, timeZone: timeZoneOf(services),
  });
}

/** The line of a route moved off a used-up account – undefined when there is none or the chat already knows it. */
export function routeSwitchLine(services: Pick<RuntimeServices, 'accounts' | 'clock' | 'settings' | 'runs' | 'log'>, input: {
  agentId: string; conversationId?: string; route: RouteDecision; modelName: string;
}): string | undefined {
  const marks = input.route.accountSwitch;
  if (!marks) return undefined;
  if (marks.source === 'auto' && input.conversationId) {
    try {
      const last = services.runs.list(input.agentId, RECENT_RUNS).find((run) => !run.splitId && run.conversationId === input.conversationId && run.status === 'done');
      if (last?.accountId === input.route.accountId) return undefined; // said when it switched; quiet while it stays there
    } catch (error) {
      services.log.warn('reading the last turn failed', { agentId: input.agentId, error: String(error) });
    }
  }
  const accounts = accountsOf(services);
  const from = accounts.find((entry) => entry.id === marks.from);
  const to = accounts.find((entry) => entry.id === input.route.accountId);
  const modelChanged = Boolean(marks.byOrder || (from && to && from.provider !== to.provider));
  return switchLine(accounts, input.route, timeZoneOf(services), services.clock.now(), modelChanged ? input.modelName : undefined);
}
