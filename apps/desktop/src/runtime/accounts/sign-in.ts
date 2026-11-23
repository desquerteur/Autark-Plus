// Sign-in and sign-out through the official CLIs, under each account's own home (homeEnv):
// Codex and Claude Code log in headless – the CLI opens the browser itself, stopped after 5 min;
// Kimi Code's `kimi login` (an OAuth device code the person reads there, B-044) runs in a visible
// terminal window (terminal-login.ts), and so does Copilot CLI itself, where the person types /login
// (no sign-out Workforce could start for either; Gemini CLI signs in through ACP, accounts/acp-plans.ts). A
// finished sign-in process triggers an account check. Terminal windows may
// stay open (and on macOS the launcher returns at once), so their accounts are also checked on
// recheck() – the account service calls it on detection, which Settings asks for when the person
// comes back to the window – until the sign-in or sign-out shows, at most 30 min after it opened.
// dispose() (shutdown) closes them all; from then on no check starts and no account is read.
// Every sign-in process starts in `cwd` (the empty engine folder, else temp), never in the process cwd
// or the workspace – except a CLI that is itself an agent (Copilot CLI): it can run commands and write
// files, so each of its windows starts in a new empty folder below `agentRoot`, and nothing it leaves
// becomes project config for the processes that start in `cwd`.
// B-051 L4: the headless sign-ins (Codex, Claude Code) pipe stdout and stderr (stdin stays closed, except B-091's away Claude Code); the
// sign-in page URL they print (sign-in-url.ts: the first https URL on a known sign-in host) is kept in
// memory with the running process – gone when it exits – and login() waits up to URL_WAIT_MS for it, so
// the person can open the page when the CLI could not open a browser. Every other byte is dropped unread.
// B-091: an "away" sign-in (the person is on their phone, not at this PC) of Codex or Claude Code finishes on the
// phone: Codex runs `login --device-auth` and hands back the page and its one-time code; Claude Code runs as usual
// with stdin piped and BROWSER set to a harmless no-op (nothing opens on the PC) and hands back the page with
// `paste` – the code the page shows the person comes back through code(), written to the CLI's stdin. Away
// sign-ins live up to AWAY_MS (device codes expire after 15 min), the others LOGIN_MS.
// Owns: running sign-in processes, their sign-in page while they run, and the open terminal sign-ins.
// Never: reads tokens, files in the account home or what the person types in the terminal; never logs or
// stores the sign-in URL, the one-time code or a pasted code (they only go back to the caller / into the CLI).

import os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import type { Account, ProviderId } from '../../shared/model/providers.ts';
import type { Lease, Supervisor } from '../system/supervisor.ts';
import type { CliId, Executable, ExecutableFinder } from './executables.ts';
import { openTerminal, type TerminalDeps } from './terminal-login.ts';
import { watchSignInUrl } from './sign-in-url.ts';
import { childEnv } from '../engines/codex/server.ts';
import { acpHomeEnv, acpProvider } from '../engines/acp/providers.ts';
import { WorkforceError } from '../../shared/errors.ts';

/**
 * `agent`: the CLI is itself an agent, so each window starts in a new empty folder (SignIns.agentFolder).
 * `away` (B-091): the sign-in finished on another device – its args, and `paste` when the page's code comes back by code().
 */
interface Flow { login: string[]; logout?: string[]; terminal?: true; agent?: true; away?: { args: string[]; paste?: true } }
type Action = 'login' | 'logout';

const FLOWS: Partial<Record<ProviderId, Flow>> = {
  codex: { login: ['login'], logout: ['logout'], away: { args: ['login', '--device-auth'] } },
  claude: { login: ['auth', 'login', '--claudeai'], logout: ['auth', 'logout'], away: { args: ['auth', 'login', '--claudeai'], paste: true } },
  copilot: { login: [], terminal: true, agent: true },
  'kimi-cli': { login: ['login'], terminal: true },
  'grok-cli': { login: ['login'], terminal: true }, // #28: `grok login` – the browser sign-in (or a device code) of a SuperGrok / X Premium+ account
};
/** The executable of a provider's CLI (Kimi Code's is `kimi`). */
const cliOf = (provider: ProviderId): CliId => acpProvider(provider)?.cli ?? provider as CliId;
const LOGIN_MS = 5 * 60_000;
export const AWAY_MS = 15 * 60_000;
/** How long code() waits for the CLI to take the pasted code and end. */
export const CODE_WAIT_MS = 60_000;
const LOGOUT_MS = 15_000;
export const RECHECK_MS = 30 * 60_000;
/** How long login() waits for the sign-in page URL a headless sign-in prints (B-051 L4). */
export const URL_WAIT_MS = 4_000;
/** BROWSER for an away sign-in: a program that opens nothing (where.exe without arguments only prints an error). */
const noBrowser = (env: NodeJS.ProcessEnv): string => process.platform === 'win32' ? path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe') : '/usr/bin/true';

/**
 * A running sign-in or sign-out process; `url`/`printed`: a headless sign-in's page and when it printed it (or ended);
 * `away`/`code`/`paste` (B-091): a sign-in finished on another device, its one-time code, its page's code goes to stdin;
 * `ended`: the process ended and its account check is done.
 */
interface Running { lease: Lease; action: Action; url?: string; printed?: Promise<void>; away?: boolean; code?: string; paste?: true; ended?: Promise<void> }
export type SignInStart = { started: boolean; url?: string; code?: string; paste?: true };

/** The variables that point a CLI at the account's own home (none for the default CLI home; Kimi Code's KIMI_CODE_HOME from the ACP table). */
export function homeEnv(account: Pick<Account, 'provider' | 'home'>): Record<string, string> {
  if (!account.home) return {};
  if (account.provider === 'codex') return { CODEX_HOME: account.home };
  return account.provider === 'claude' ? { CLAUDE_CONFIG_DIR: account.home } : acpHomeEnv(account);
}

export interface SignInDeps {
  finder: ExecutableFinder;
  supervisor: Supervisor;
  env?: NodeJS.ProcessEnv;
  now: () => number;
  label(provider: ProviderId): string;
  /** The account check after a sign-in (resolves when it is done). */
  check(id: string): Promise<void>;
  state(id: string): Account['state'] | undefined;
  /** Platform and PATH lookup for the terminal window (tests). */
  terminal?: Partial<Omit<TerminalDeps, 'supervisor'>>;
  /**
   * Folder the sign-in CLIs start in (default the OS temp folder), never the process cwd: Claude Code's
   * `auth` commands take no --setting-sources, so a `.claude/settings.json` there would hand them its env.
   */
  cwd?: string;
  /** Below this folder (default the OS temp folder) each agent sign-in gets a new empty one; never `cwd`. */
  agentRoot?: string;
  mkdir?: (dir: string) => Promise<void>;
  /** How long login() waits for a headless sign-in's page URL (default URL_WAIT_MS; tests 0). */
  urlWaitMs?: number;
}

export class SignIns {
  private readonly deps: SignInDeps;
  private readonly running = new Map<string, Running>();
  /** Terminal sign-ins/-outs still to confirm: account id → when the window opened and what it should end in. */
  private readonly open = new Map<string, { since: number; action: Action }>();
  /** Set by dispose(): the monitor is stopped and the database closes next, so nothing is checked or read. */
  private disposed = false;

  constructor(deps: SignInDeps) { this.deps = deps; }

  /**
   * `url` (with `page`): the sign-in page a headless sign-in printed within URL_WAIT_MS (also for one that already runs).
   * `away` (B-091, Codex and Claude Code): the person finishes it on another device – with `code` or `paste` (see the header);
   * a running sign-in of the other kind is replaced – only by the person's own call (`page`): an agent's never ends theirs.
   */
  async login(account: Account, page = true, away = false): Promise<SignInStart> {
    const flow = FLOWS[account.provider];
    if (!flow) return { started: false };
    const far = away && flow.away !== undefined;
    const running = this.running.get(account.id);
    if (running?.action === 'login' && (Boolean(running.away) === far || !page)) return page ? this.started(account.id) : { started: true };
    const exe = await this.deps.finder.find(cliOf(account.provider));
    if (!exe) throw new WorkforceError('unavailable', `${this.deps.label(account.provider)} is not installed.`);
    const lease = await this.start(account, flow, 'login', exe, far);
    if (!flow.terminal) {
      const timer = setTimeout(() => { void lease.release(); }, far ? AWAY_MS : LOGIN_MS);
      timer.unref?.();
      void lease.exited.then(() => clearTimeout(timer));
    }
    return page ? this.started(account.id) : { started: true };
  }

  /**
   * B-091: the code the sign-in page showed the person, written to the running away Claude Code sign-in; resolves once
   * it ended and its account was checked (at most CODE_WAIT_MS) – ok: the account works now. The code is never kept.
   */
  async code(id: string, code: string): Promise<{ ok: boolean }> {
    const entry = this.running.get(id);
    const stdin = entry?.paste ? entry.lease.child.stdin : null;
    if (!entry?.ended || !stdin) throw new WorkforceError('not_found', 'The sign-in ended – start it again.');
    stdin.write(`${code.trim()}\n`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([entry.ended, new Promise<void>((resolve) => { timer = setTimeout(resolve, CODE_WAIT_MS); timer.unref?.(); })]);
    clearTimeout(timer);
    const state = this.deps.state(id);
    return { ok: state === 'ok' || state === 'cooling' };
  }

  /** The running sign-in's page, waiting at most urlWaitMs for it to be printed (none once the process ended). */
  private async started(id: string): Promise<SignInStart> {
    const entry = this.running.get(id);
    const wait = this.deps.urlWaitMs ?? URL_WAIT_MS;
    const missing = () => entry?.url === undefined || (entry.away === true && !entry.paste && entry.code === undefined);
    if (entry?.printed && missing() && wait > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([entry.printed, new Promise<void>((resolve) => { timer = setTimeout(resolve, wait); timer.unref?.(); })]);
      clearTimeout(timer);
    }
    const url = this.running.get(id) === entry ? entry?.url : undefined;
    if (!url) return { started: true };
    return { started: true, url, ...(entry?.code ? { code: entry.code } : {}), ...(entry?.paste ? { paste: true as const } : {}) };
  }

  /** 'window': a sign-out that continues in a terminal (checked like a sign-in); 'done': signed out or no CLI. */
  async logout(account: Account): Promise<'window' | 'done'> {
    const flow = FLOWS[account.provider];
    const exe = flow?.logout ? await this.deps.finder.find(cliOf(account.provider)) : null;
    if (!flow?.logout || !exe) return 'done';
    const lease = await this.start(account, flow, 'logout', exe);
    if (flow.terminal) return 'window';
    await Promise.race([lease.exited, new Promise((resolve) => setTimeout(resolve, LOGOUT_MS).unref?.())]);
    await lease.release();
    return 'done';
  }

  /** The person came back: checks every terminal sign-in opened in the last 30 min; resolves when the checks are done. */
  async recheck(): Promise<void> {
    const now = this.deps.now();
    for (const [id, entry] of [...this.open]) if (now - entry.since >= RECHECK_MS) this.open.delete(id);
    await Promise.all([...this.open.keys()].map((id) => this.settle(id)));
  }

  /** The account is being removed: closes its sign-in window or process. */
  async cancel(id: string): Promise<void> {
    this.open.delete(id);
    const running = this.running.get(id);
    this.running.delete(id);
    await running?.lease.release();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const leases = [...this.running.values()].map((entry) => entry.lease);
    this.running.clear();
    this.open.clear();
    await Promise.all(leases.map((lease) => lease.release()));
  }

  private async start(account: Account, flow: Flow, action: Action, exe: Executable, away = false): Promise<Lease> {
    await this.running.get(account.id)?.lease.release(); // a sign-in replaces an open sign-out window and vice versa
    const extra = homeEnv(account);
    const paste = away ? flow.away?.paste : undefined;
    const base = this.deps.env ?? process.env;
    const env = childEnv(base, paste ? { ...extra, BROWSER: noBrowser(base) } : extra);
    const owner = `${action}:${account.id}`;
    const title = `${this.deps.label(account.provider)} ${action === 'login' ? 'sign-in' : 'sign-out'}`;
    const cwd = flow.agent ? await this.agentFolder() : this.deps.cwd ?? os.tmpdir();
    const args = (away ? flow.away?.args : undefined) ?? flow[action] ?? [];
    const page = action === 'login' && !flow.terminal; // B-051 L4: a headless sign-in prints its page
    const lease = flow.terminal
      ? await openTerminal({ supervisor: this.deps.supervisor, ...this.deps.terminal }, { exe, args, env, extra, title, cwd }, owner)
      : this.deps.supervisor.spawn({ command: exe.command, args: [...exe.prefixArgs, ...args], owner, kind: 'light', cwd, env, stdio: page ? [paste ? 'pipe' : 'ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore'] });
    if (paste) lease.child.stdin?.on('error', () => undefined); // a code written after the CLI closed its stdin (EPIPE)
    const entry: Running = { lease, action, ...(away ? { away } : {}), ...(paste ? { paste } : {}) };
    if (page) {
      let printed: () => void = () => {};
      entry.printed = new Promise<void>((resolve) => { printed = resolve; });
      const wantCode = away && !paste; // Codex device sign-in: the page and its one-time code
      const shown = () => { if (entry.url && (!wantCode || entry.code)) printed(); };
      watchSignInUrl([lease.child.stdout, lease.child.stderr], (url) => { entry.url = url; shown(); }, wantCode ? (code) => { entry.code = code; shown(); } : undefined);
      void lease.exited.then(() => { entry.url = undefined; entry.code = undefined; printed(); }); // gone with the process
    }
    this.running.set(account.id, entry);
    if (flow.terminal) this.open.set(account.id, { since: this.deps.now(), action });
    entry.ended = lease.exited.then(async () => {
      if (this.running.get(account.id)?.lease === lease) this.running.delete(account.id);
      if (!this.disposed && (action === 'login' || flow.terminal)) await this.settle(account.id);
    });
    return lease;
  }

  /** A new empty folder for one agent sign-in (<agentRoot>/agent-sign-in/<random>): what the agent writes or trusts there is never reused. */
  private async agentFolder(): Promise<string> {
    const dir = path.join(this.deps.agentRoot ?? os.tmpdir(), 'agent-sign-in', randomUUID());
    await (this.deps.mkdir ?? ((folder: string) => fsp.mkdir(folder, { recursive: true, mode: 0o700 }).then(() => undefined)))(dir);
    return dir;
  }

  /** Checks the account; an open terminal sign-in is confirmed once it shows (or the account is gone or off). */
  private async settle(id: string): Promise<void> {
    const entry = this.open.get(id);
    await this.deps.check(id).catch(() => undefined);
    if (this.disposed) return; // shut down meanwhile
    const state = this.deps.state(id);
    const reached = entry?.action === 'logout' ? state === 'needs_login' : state === 'ok' || state === 'cooling';
    if (entry && this.open.get(id) === entry && (reached || state === undefined || state === 'disabled')) this.open.delete(id);
  }
}
