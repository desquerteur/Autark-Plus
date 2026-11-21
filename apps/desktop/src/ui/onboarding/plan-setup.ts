// The model setup's two plan buttons (plan-actions.tsx) each add an account and start its official sign-in.
// Install a missing CLI first, then accounts.add creates a separate sign-in profile. Existing accounts stay as
// they are. Wait for this account's sign-in through events and a re-check on window focus (one 5-minute timer,
// no polling), then report that it signed in. #24: the install and the sign-in start each have a deadline
// (INSTALL_WAIT_MS, START_WAIT_MS), so a runtime call that never answers ends in a clear error, never a stuck line. No model turn is sent, even when another account already works.
// A newer flow cancels the running one: it stops at its next step and shows nothing.
// Owns: this flow, its steps and texts. Never: renders, writes settings, reads or logs a token or the sign-in address.

import type { Account, DetectionReport } from '../../shared/model/providers.ts';

/** AF-024: 'gemini-cli' – a Google account through Gemini CLI, started from the Google Gemini panel (settings/gemini-add.tsx). */
export type PlanProvider = 'codex' | 'claude' | 'gemini-cli';

/** The two buttons, in this order. */
export const PLAN_PROVIDERS: readonly PlanProvider[] = ['claude', 'codex'];
export const PLAN_LABELS: Record<PlanProvider, string> = { claude: 'Claude plan', codex: 'Codex plan', 'gemini-cli': 'Sign in with Google' };
/** The program that is installed. */
const CLI: Record<PlanProvider, string> = { codex: 'Codex', claude: 'Claude Code', 'gemini-cli': 'Gemini CLI' };
/** What signed in. */
const SIGNED_IN: Record<PlanProvider, string> = { codex: 'Codex account signed in', claude: 'Claude account signed in', 'gemini-cli': 'Google account signed in' };

/** How long step 3 waits for the browser sign-in. */
export const SIGN_IN_WAIT_MS = 5 * 60_000;
export const SIGN_IN_TEXT = 'Finish signing in in your browser…';
export const SIGN_IN_GAVE_UP = 'Sign-in did not finish – try again.';
/**
 * #24: how long step 1 may take before the flow gives up – the runtime's 5-minute install timeout (install.ts) plus
 * a margin. No runtime answer (a lost reply, a hung step) never keeps the line on "Installing…".
 */
export const INSTALL_WAIT_MS = 6 * 60_000;
/** #24: how long starting the sign-in may take (accounts.add: the CLI starts and offers its sign-in). */
export const START_WAIT_MS = 2 * 60_000;
export const installTooLong = (provider: PlanProvider) => `Installing ${CLI[provider]} took too long. Check your connection and try again.`;
export const startTooLong = (provider: PlanProvider) => `${CLI[provider]} did not start its sign-in in time – try again.`;

export type PlanStep = 'install' | 'sign-in' | 'done';

/** What the card shows now: the status line (with its tone) and the link cell's address. */
export interface PlanView { provider: PlanProvider; step: PlanStep; text: string; tone?: 'ok' | 'error'; url?: string }

export type PlanResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: 'install' | 'sign-in' | 'cancelled'; message: string };

/** The runtime calls the flow makes (plan-actions.tsx wires them to rpc.call). */
export interface PlanRpc {
  install(provider: PlanProvider): Promise<unknown>;
  add(provider: PlanProvider, label?: string): Promise<Account & { signInUrl?: string }>;
  /** accounts.detect: the runtime checks the open sign-ins again (events bring the change). */
  recheck(): Promise<unknown>;
}

export interface PlanEnv {
  rpc: PlanRpc;
  /** The accounts as the runtime's events keep them (lib/store.ts accounts). */
  accounts: { peek(): readonly Account[]; subscribe(fn: (value: readonly Account[]) => void): () => void };
  /** desquerteur/Autark-Plus#24: refused sign-ins by account id (lib/store.ts signInFailures) – step 3 ends with the reason at once. */
  failures?: { peek(): Readonly<Record<string, SignInFailure>>; subscribe(fn: (value: Readonly<Record<string, SignInFailure>>) => void): () => void };
  /** The latest PC scan (null: none yet – step 1 is left to the runtime's add). */
  report: () => DetectionReport | null;
  /** One timer: calls `fire` after `ms`; returns its cancel. */
  timer: (ms: number, fire: () => void) => () => void;
  /** Calls `fire` whenever the window gets focus again; returns the stop. */
  focus: (fire: () => void) => () => void;
  /** Every step as it starts, and the end (never after a cancel). */
  show: (view: PlanView) => void;
}

export interface PlanFlow { done: Promise<PlanResult>; cancel(): void }

/** Why an account's own sign-in was refused (account.sign_in_failed) and when it arrived. */
export interface SignInFailure { message: string; at: number }

const WORKS: ReadonlySet<Account['state']> = new Set(['ok', 'cooling']);
const CANCELLED: PlanResult = { ok: false, reason: 'cancelled', message: '' };

/** Authentication finished, including Claude Free (signed in even though its plan cannot run agents). */
const settled = (account: Account) => WORKS.has(account.state) || (account.state === 'error' && account.plan?.trim().toLowerCase() === 'free');

/** The scan lists this CLI and found no program: it is missing (no entry: not known – demo, an old report). */
export function cliMissing(report: DetectionReport | null, provider: PlanProvider): boolean {
  const cli = report?.clis.find((entry) => entry.provider === provider);
  return cli !== undefined && !cli.path;
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/** Starts the flow for `provider`; `cancel()` stops it at its next step (the card starts another or closes). `label`: the new account's name (AF-024). */
export function startPlanSetup(provider: PlanProvider, env: PlanEnv, label?: string): PlanFlow {
  let cancelled = false;
  let abortWait: (() => void) | undefined;
  const show = (view: Omit<PlanView, 'provider'>) => { if (!cancelled) env.show({ provider, ...view }); };
  const fail = (step: PlanStep, reason: Exclude<PlanResult, { ok: true }>['reason'], message: string, url?: string): PlanResult => {
    show({ step, text: message, tone: 'error', url });
    return { ok: false, reason, message };
  };
  /** #24: a runtime call with a deadline – rejects with `message` when it has not answered after `ms`. */
  const within = <T>(work: Promise<T>, ms: number, message: string) => new Promise<T>((resolve, reject) => {
    const stop = env.timer(ms, () => reject(new Error(message)));
    work.then((value) => { stop(); resolve(value); }, (error: unknown) => { stop(); reject(error); });
  });

  /**
   * Step 3: resolves with the account once it is settled (works, or the Free plan), 'gone' when it was removed, the
   * refusal when the agent turned the sign-in down (#24; one from before this wait does not count), else 'timeout' / 'cancelled'.
   */
  const waitSignedIn = (id: string, before: Readonly<Record<string, SignInFailure>> | undefined) => new Promise<Account | SignInFailure | 'timeout' | 'gone' | 'cancelled'>((resolve) => {
    let done = false;
    let seen = false;
    const stops: Array<() => void> = [];
    const finish = (value: Account | SignInFailure | 'timeout' | 'gone' | 'cancelled') => {
      if (done) return;
      done = true;
      abortWait = undefined;
      for (const stop of stops.splice(0)) stop();
      resolve(value);
    };
    abortWait = () => finish('cancelled');
    stops.push(env.timer(SIGN_IN_WAIT_MS, () => finish('timeout')));
    stops.push(env.focus(() => { void env.rpc.recheck().catch(() => undefined); }));
    const off = env.accounts.subscribe((list) => {
      const account = list.find((entry) => entry.id === id);
      if (!account) { if (seen) finish('gone'); return; }
      seen = true;
      if (settled(account)) finish(account);
    });
    if (done) off(); else stops.push(off);
    if (env.failures && !done) {
      const earlier = before?.[id]; // as it was before accounts.add: a refusal during add counts
      const offFailures = env.failures.subscribe((all) => { const failure = all[id]; if (failure && failure !== earlier) finish(failure); });
      if (done) offFailures(); else stops.push(offFailures);
    }
  });

  /** Add an account and wait only for its sign-in, regardless of any existing accounts. */
  const signIn = async (): Promise<Account | PlanResult> => {
    let account: Account;
    let url: string | undefined;
    show({ step: 'sign-in', text: SIGN_IN_TEXT });
    const before = env.failures?.peek();
    try {
      const { signInUrl, ...rest } = await within(env.rpc.add(provider, label), START_WAIT_MS, startTooLong(provider));
      account = rest;
      url = signInUrl;
    } catch (error) { return cancelled ? CANCELLED : fail('sign-in', 'sign-in', messageOf(error, 'Could not start the sign-in – try again.')); }
    if (cancelled) return CANCELLED;
    // the account as the signal holds it now (an event may have brought its sign-in already)
    const fresh = env.accounts.peek().find((entry) => entry.id === account.id) ?? account;
    if (settled(fresh)) return fresh;
    show({ step: 'sign-in', text: SIGN_IN_TEXT, url });
    // 3. the browser
    const waited = await waitSignedIn(fresh.id, before);
    if (waited === 'cancelled' || cancelled) return CANCELLED;
    if (waited === 'timeout') return fail('sign-in', 'sign-in', SIGN_IN_GAVE_UP);
    if (waited === 'gone') return fail('sign-in', 'sign-in', 'The sign-in was removed – try again.');
    if ('message' in waited) return fail('sign-in', 'sign-in', waited.message); // #24: e.g. Google refuses personal accounts
    return waited;
  };

  const isEnd = (value: Account | PlanResult): value is PlanResult => 'ok' in value;

  const run = async (): Promise<PlanResult> => {
    // 1. the program
    if (cliMissing(env.report(), provider)) {
      show({ step: 'install', text: `Installing ${CLI[provider]} – this takes about a minute…` });
      try { await within(env.rpc.install(provider), INSTALL_WAIT_MS, installTooLong(provider)); } catch (error) { return cancelled ? CANCELLED : fail('install', 'install', messageOf(error, `Could not install ${CLI[provider]}.`)); }
      if (cancelled) return CANCELLED;
    }
    const account = await signIn();
    if (cancelled) return CANCELLED;
    if (isEnd(account)) return account;
    show({ step: 'done', text: SIGNED_IN[provider], tone: 'ok' });
    return { ok: true, accountId: account.id };
  };

  return {
    done: run(),
    cancel() { cancelled = true; abortWait?.(); },
  };
}
