// What a failed engine attempt says about its account, and the consequence for that account – one
// source for agent turns (agents/turn.ts) and helper calls (decision/engine-runner.ts; audit 23.10.2026:
// a failed helper call recorded nothing, so a signed-out, used-up or missing account stayed 'ok' for the
// router and every later helper call first spent a failing attempt on it).
//   limit → cooling with the provider's retry hint or LIMIT_COOLDOWN_MS (a model's own used-up window,
//     e.g. weekly-opus, only keeps that model away until its reset – the account stays); AF-024: a daily quota the
//     error names (engines/quota-wait.ts – Gemini) is stored as a used-up "1d" window until its reset, the model's own
//     ("1d-<model>") when the quota is per model – then only that model waits;
//   a Codex/Claude Code plan signed out → needs_login, and once per sign-out (B-047 D10) the sign-in work
//     (accounts/relogin.ts: a task for an agent, or the person's to-do) – without that service one notification
//     when the caller can send one. The service comes from the deps or, for callers whose deps do not carry it
//     (the helper calls of decision/engine-runner.ts, which often meet a sign-out first), from the account
//     service it is attached to (attachRelogin, by Relogin.watch – keyed by that instance, so runtimes never mix);
//     B-091: the account service's own check reports a sign-out it finds the same way (reportSignedOut);
//   CLI confirmed missing ("… is not installed.") → error;
//   anything else unavailable (overload, connection, a CLI that could not start, a rejected or missing
//     API key – 401/403 may concern one model only; B-059: a provider overloaded or unreachable,
//     engines/provider-outage.ts) → a short cooling;
//   a timeout is the turn's own (B-075: a cold Codex app-server that did not open the thread in time) → nothing.
// B-080: a failure of our own engine process (the local app-server not answering in time or its connection closing while a turn
// opened or started – details.local –, a stall – details.stalled)
// changes nothing about the account: it still counts as an overload, so the turn fails over once and keeps its outage
// handling, but no account cools. Only what a provider said (a limit, signed out, overloaded or unreachable) cools one.
// B-059: whether any account that can run an agent turn is usable now (turnAccountUsable) – the outage holds wait
// for it (agents/redelivery.ts, tasks/outages.ts holdWakes); a media-only account (B-058) never counts.
// Owns: this classification and these consequences. Never: failover or routing (the callers decide),
// a second notification for the same sign-out (markUnavailable says whether the state changed).

import { MEDIA_ONLY_PROVIDERS, type Account, type AccountLimits } from '../../shared/model/providers.ts';
import { isPlanProvider } from '../../shared/model/plan-roles.ts';
import type { AccountService, Clock, NotificationService } from '../contracts.ts';
import type { ReloginService } from '../contracts/relogin.ts';
import type { EngineTurnResult } from '../engines/types.ts';
import { engineFor, isHealthy, modelOnlyLimit } from './candidates.ts';
import { quotaOf } from '../engines/quota-wait.ts';

export const LIMIT_COOLDOWN_MS = 15 * 60_000;
export const OVERLOAD_COOLDOWN_MS = 5 * 60_000;
/** Floor for provider retry hints of 0 (a reset "now"), so retries never spin on a used-up plan. */
export const MIN_COOLDOWN_MS = 60_000;
const SIGNED_OUT = /not signed in|not logged in|sign in|rejected this connection|api key/i;
/** Only the unambiguous message: "Codex is not installed or could not start." also covers a slow or crashed start. */
const NOT_INSTALLED = /\bis not installed\.?$/i;

export type AccountFailure = 'limit' | 'signed_out' | 'missing' | 'overload';

/** B-047 D10: the sign-in work of an account service instance (see the header); returns the detach function. */
const attached = new WeakMap<object, ReloginService>();
export function attachRelogin(accounts: object, relogin: ReloginService): () => void {
  attached.set(accounts, relogin);
  return () => { if (attached.get(accounts) === relogin) attached.delete(accounts); };
}

/** What a failed attempt says about its account; undefined when the model or the turn failed, not the account. */
export function accountFailure(result: EngineTurnResult): AccountFailure | undefined {
  if (result.stop === 'limit' || (result.stop === 'error' && result.error?.code === 'rate_limited')) return 'limit';
  if (result.stop !== 'error' || result.error?.code !== 'unavailable') return undefined;
  if (SIGNED_OUT.test(result.error.message)) return 'signed_out';
  return NOT_INSTALLED.test(result.error.message) ? 'missing' : 'overload';
}

export interface FailureDeps {
  /** AF-024: `updateLimits` (optional for simple fakes) stores a model's own used-up daily quota without cooling the account. */
  accounts: Pick<AccountService, 'get' | 'markLimited' | 'markUnavailable'> & Partial<Pick<AccountService, 'updateLimits'>>;
  clock: Clock;
  /** The "Sign in to …" to-do; without it the account's state alone shows the sign-in (Settings). */
  notifications?: Pick<NotificationService, 'notify'>;
  /** B-047 D10: the sign-in work (a task or the person's to-do) instead of the notification. */
  relogin?: ReloginService;
}

/**
 * Records what a failed attempt on `account` running `model` (the provider's model id) says about the
 * account; returns the failure (undefined: nothing to record). Errors of the account service propagate.
 */
export function recordAccountFailure(deps: FailureDeps, account: Account, model: string, result: EngineTurnResult): AccountFailure | undefined {
  const failure = accountFailure(result);
  if (!failure) return undefined;
  // Only Codex/Claude Code plans have a sign-in to repeat (Settings › Sign in), so only they get needs_login.
  const signIn = failure === 'signed_out' && account.auth === 'cli' && isPlanProvider(account.provider);
  if (signIn || failure === 'missing') {
    const changed = deps.accounts.markUnavailable(account.id, signIn ? 'needs_login' : 'error');
    if (changed && signIn) reportSignedOut(deps, account);
    return failure;
  }
  const now = deps.clock.now();
  const daily = failure === 'limit' ? dailyWindow(result, model, now) : undefined; // AF-024
  if (daily && daily.windows[0].name !== '1d' && deps.accounts.updateLimits) {
    deps.accounts.updateLimits(account.id, daily); // the model's own quota: only that model waits
    return failure;
  }
  if (failure === 'limit') {
    const fresh = deps.accounts.get(account.id);
    if (fresh && modelOnlyLimit(fresh, now, model)) return failure;
  }
  if (result.error?.details?.local === true || result.error?.details?.stalled === true) return failure; // B-080: our own engine process
  const wait = result.error?.retryAfterMs ?? (failure === 'limit' ? LIMIT_COOLDOWN_MS : OVERLOAD_COOLDOWN_MS);
  deps.accounts.markLimited(account.id, now + Math.max(MIN_COOLDOWN_MS, wait), daily);
  return failure;
}

/**
 * AF-024: a used-up daily quota the limit error names, as a reading – "1d" for the account, "1d-<model>" for the model's own
 * quota (windowApplies matches it to that model id); undefined without one or without its reset.
 */
export function dailyWindow(result: EngineTurnResult, model: string, now: number): AccountLimits | undefined {
  const quota = quotaOf(result.error?.details);
  if (!quota?.daily || quota.resetsAt === undefined || quota.resetsAt <= now) return undefined;
  const scope = quota.perModel ? model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) : '';
  return { windows: [{ name: scope ? `1d-${scope}` : '1d', windowMinutes: 1440, usedPercent: 100, resetsAt: quota.resetsAt }], readAt: now };
}

/**
 * A Codex/Claude Code plan just found signed out (once per sign-out): its sign-in work (accounts/relogin.ts), else one
 * notification when the caller can send one. Also the account service's own background check (B-091, service.ts check).
 */
export function reportSignedOut(deps: { accounts: Pick<AccountService, 'get'> } & Pick<FailureDeps, 'notifications' | 'relogin'>, account: Account): void {
  const relogin = deps.relogin ?? attached.get(deps.accounts);
  if (relogin) relogin.signedOut(deps.accounts.get(account.id) ?? { ...account, state: 'needs_login' });
  else deps.notifications?.notify({
    kind: 'todo', title: `Sign in to ${account.label}`,
    body: `Agents cannot use ${account.label} until you sign in again in Settings › Models.`,
  });
}

/** B-059: the enabled accounts that can run an agent turn (an engine, never a media-only one). */
export function turnAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => account.enabled && engineFor(account.provider) !== undefined && !MEDIA_ONLY_PROVIDERS.includes(account.provider));
}

/** B-059: one of them is usable now – not cooling, used up, signed out or failing (candidates.ts isHealthy). */
export function turnAccountUsable(accounts: readonly Account[], now: number): boolean {
  return turnAccounts(accounts).some((account) => isHealthy(account, now));
}
