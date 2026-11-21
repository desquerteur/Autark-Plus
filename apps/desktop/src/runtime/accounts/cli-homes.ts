// CLI accounts with homes of their own (Codex, Claude Code, Kimi Code, Gemini CLI – AF-024): adding one creates
// <accounts>/<provider>/<id> (CODEX_HOME, CLAUDE_CONFIG_DIR, KIMI_CODE_HOME, GEMINI_CLI_HOME) and starts its sign-in; a sign-in that could not start keeps the account
// and the error, and the next add of that provider retries that account. 16.11.2026: <accounts> (Paths.accounts) is this
// PC's one folder of plan logins, outside every company's data folder (<Autark Companies>/logins): one home per login,
// shared by every company on this PC. sharedLogins lists them, whichever company made them (accounts/adoption.ts adopts
// one a company has no row for); removing an account drops only its row – the home is the login's, not the row's; signing
// out signs that login out for every company. Each home carries the app's own note (.autark-login.json): the login's
// e-mail and the sign-out mark. One e-mail can hold two plans (a personal and a business workspace): where the homes say
// whose login they hold (whoseLogin), two that name different ones are two logins. It also names each CLI's default home
// and the files that hold its login there (devices/sync/logins.ts copies those between PCs).
// Codex runs only in homes of its own, so nothing of the person's own Codex set-up (config.toml, AGENTS.md, skills, MCP
// servers) reaches an agent: a Codex login found in the default home (~/.codex) becomes an account whose home gets a copy
// of that login (found – the home of that person's login here when another company made it already), and when that copy
// stops working while the default home holds a newer login of the same person, it takes that one again (retake – the
// CLIs rotate refresh tokens, so after one side refreshed the other copy fails). The default home is only ever read.
// Owns: creating these homes, the retry of an unstarted sign-in, the login copies from the default home, those names, the
// homes' notes, whose login a home holds and the sign-out marks. Never: signs in itself (the service's login does), deletes a home or writes into a
// CLI's default home.
// AF-024: Gemini CLI's GEMINI_CLI_HOME is the root its `.gemini` folder is created in (loginDir); its login in the default
// home (~/.gemini, no e-mail reported) stays one per PC (onePerPc).

import os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fsp, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Account, ProviderId } from '../../shared/model/providers.ts';
import type { Db } from '../db/database.ts';
import { KvRepo } from '../store/kv.ts';
import { acpProvider } from '../engines/acp/providers.ts';
import type { AccountRepo } from './repo.ts';
import type { AwaySignIn } from '../../shared/api/methods-providers.ts';
import { identity, loginEmail, loginIn, takeLogin } from './login-file.ts';
import { replaceWithSync } from '../devices/sync/file-io.ts';

/** kv namespace of the sign-out marks of plans without a home of their own (a CLI's default home). */
export const SIGNED_OUT = 'accounts.signed-out';
const NOTE = '.autark-login.json';

/** The app's own note in a home of its own: whose login it is and when the person signed out of it. */
export interface HomeNote { email?: string; signedOut?: number }

export function readNote(home: string): HomeNote {
  try {
    const value = JSON.parse(readFileSync(path.join(home, NOTE), 'utf8')) as Record<string, unknown> | null;
    return {
      ...(typeof value?.email === 'string' && value.email ? { email: value.email } : {}),
      ...(typeof value?.signedOut === 'number' ? { signedOut: value.signedOut } : {}),
    };
  } catch { return {}; }
}

/** Changes the note of `home` (undefined removes a field), written whole; a home that is not there gets none. */
export function writeNote(home: string, patch: { [K in keyof HomeNote]?: HomeNote[K] | undefined }): void {
  const next: Record<string, unknown> = { ...readNote(home), ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  const file = path.join(home, NOTE);
  const temp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(next)); replaceWithSync(temp, file); } catch { /* no home (yet): nothing to note */ } finally { rmSync(temp, { force: true }); }
}

export const sameEmail = (a: string | undefined, b: string | undefined): boolean => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/** One path spelled one way (Windows paths ignore case). */
export const homeKey = (dir: string): string => (process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir));

/**
 * The plans the person signed out of on this PC (accounts.logout): `mark` after the sign-out, `has` before a login from
 * another PC is written (it is not) and before a sign-out counts as unexpected, `clear` once a login works here again or
 * the account is gone. A home of its own carries the mark in its note, so it holds for every company using that login;
 * a plan in a CLI's default home keeps it in this company's kv.
 */
export const signedOut = {
  mark: (db: Db, account: Pick<Account, 'id' | 'home'>, at: number): void => {
    if (account.home) writeNote(account.home, { signedOut: at });
    else new KvRepo(db).set(SIGNED_OUT, account.id, true, at);
  },
  has: (db: Db, account: Pick<Account, 'id' | 'home'>): boolean =>
    account.home ? readNote(account.home).signedOut !== undefined : new KvRepo(db).get<boolean>(SIGNED_OUT, account.id) === true,
  clear: (db: Db, account: Pick<Account, 'id' | 'home'>): void => {
    if (!account.home) new KvRepo(db).delete(SIGNED_OUT, account.id);
    else if (readNote(account.home).signedOut !== undefined) writeNote(account.home, { signedOut: undefined });
  },
};

/** A plan login in this PC's logins folder, whichever company made it; `signedIn` undefined: its login is no file here (macOS Keychain). */
export interface SharedLogin { provider: 'codex' | 'claude'; id: string; home: string; email?: string; signedIn?: boolean }

/** The Codex and Claude Code homes in <accounts>/<provider>/<id> with their notes and whether their login file is signed in. */
export function sharedLogins(accounts: string, platform: NodeJS.Platform = process.platform): SharedLogin[] {
  const found: SharedLogin[] = [];
  for (const provider of ['codex', 'claude'] as const) {
    let ids: string[] = [];
    try { ids = readdirSync(path.join(accounts, provider), { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^[\w-]{1,100}$/.test(entry.name)).map((entry) => entry.name); } catch { continue; }
    for (const id of ids) {
      const home = path.join(accounts, provider, id);
      const note = readNote(home);
      const file = loginFiles(provider, platform)[0];
      const signedIn = note.signedOut !== undefined ? false : file ? (loginIn(provider, home, file)?.at ?? 0) > 0 : undefined;
      found.push({ provider, id, home, ...(note.email ? { email: note.email } : {}), ...(signedIn !== undefined ? { signedIn } : {}) });
    }
  }
  return found;
}

/**
 * Whose login a home holds where it says so – its login file's account (login-file.ts identity: Codex's workspace), for
 * Claude Code the organisation its .claude.json names – so one e-mail with two plans (a personal and a business workspace)
 * stays two logins. Undefined: the home does not say.
 */
export function whoseLogin(provider: ProviderId, home: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (provider === 'claude') {
    try {
      const org = (JSON.parse(readFileSync(path.join(home, '.claude.json'), 'utf8')) as { oauthAccount?: { organizationUuid?: unknown } } | null)?.oauthAccount?.organizationUuid;
      return typeof org === 'string' && org ? org : undefined;
    } catch { return undefined; }
  }
  const file = loginFiles(provider, platform)[0];
  const login = file ? loginIn(provider, home, file) : undefined;
  return login ? identity(provider, login.json) : undefined;
}

/** Two logins of one e-mail are one login: neither says whose it is, or both name the same. */
export const oneLogin = (a: string | undefined, b: string | undefined): boolean => !a || !b || a === b;

/** The home here that holds the login of `email` (its note says so); undefined: none yet. */
export function sharedHome(accounts: string, provider: ProviderId, email: string | undefined): string | undefined {
  return email ? sharedLogins(accounts).find((login) => login.provider === provider && sameEmail(login.email, email))?.home : undefined;
}

/** Whether accounts of `provider` get homes of their own (CODEX_HOME, CLAUDE_CONFIG_DIR, KIMI_CODE_HOME, GEMINI_CLI_HOME); else one sign-in per PC in the default home. */
export function ownHomes(provider: ProviderId): boolean {
  return provider === 'codex' || provider === 'claude' || Boolean(acpProvider(provider)?.home);
}

/**
 * A login of which each PC has one, so two PCs' are the same account without an e-mail to compare: a CLI without homes of
 * its own, and – AF-024 – Gemini CLI's login in its default home (~/.gemini; Gemini CLI reports no e-mail). A Gemini account
 * with a home of its own is told apart like Codex (the same account id, or provider and e-mail). `own`: whether the account
 * has a home of its own (undefined: look at `home`).
 */
export function onePerPc(account: { provider: string; home?: string | null }, own = Boolean(account.home)): boolean {
  return !ownHomes(account.provider as ProviderId) || (account.provider === 'gemini-cli' && !own);
}

/** A CLI's default home, where a login this PC finds lives (an account without `home`); undefined: none known. */
export function defaultHome(provider: ProviderId, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | undefined {
  if (provider === 'codex') return env.CODEX_HOME || path.join(home, '.codex');
  if (provider === 'claude') return env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return provider === 'gemini-cli' ? path.join(home, '.gemini') : undefined;
}

/**
 * AF-024: the folder that holds the account's login files (loginFiles). An account with a home of its own keeps them
 * there – except Gemini CLI, whose GEMINI_CLI_HOME is the root it creates its `.gemini` folder in; one without a home:
 * the CLI's default home (defaultHome, for Gemini CLI already the `.gemini` folder).
 */
export function loginDir(account: Pick<Account, 'provider' | 'home'>, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | undefined {
  if (!account.home) return defaultHome(account.provider, env, home);
  return account.provider === 'gemini-cli' ? path.join(account.home, '.gemini') : account.home;
}

/**
 * The files that hold a CLI plan's login in its home, the deciding one first. Claude Code on macOS keeps its login
 * in the Keychain, Copilot CLI and Kimi Code keep theirs in no file known here: none.
 */
export function loginFiles(provider: ProviderId, platform: NodeJS.Platform = process.platform): readonly string[] {
  if (provider === 'codex') return ['auth.json'];
  if (provider === 'claude') return platform === 'darwin' ? [] : ['.credentials.json'];
  return provider === 'gemini-cli' ? ['oauth_creds.json', 'google_accounts.json'] : [];
}

export interface CliHomeDeps {
  accounts: string; // the accounts folder (Paths.accounts)
  /** The env and the user's home folder the CLIs' default homes are found by (CODEX_HOME, else <homeDir>/.codex). */
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  repo: AccountRepo;
  /** Stores and announces an account (AccountService). */
  save(account: Account): Account;
  /** A new account row with the service's defaults (label, priority, id). */
  blank(provider: ProviderId, patch: Partial<Account>): Account;
  /** The service's sign-in (it calls started() once the sign-in runs); `url`: the sign-in page it printed. */
  login(id: string, away: boolean): Promise<{ started: boolean; url?: string } & AwaySignIn>;
  require(id: string): Account;
  mkdir?: (dir: string) => Promise<void>;
}

export class CliHomes {
  private readonly deps: CliHomeDeps;
  /** Per provider: the account whose sign-in add() could not start (CLI or terminal missing). */
  private readonly unstarted = new Map<ProviderId, string>();
  /** Per home: the e-mail its note holds (written once per change, not at every save). */
  private readonly noted = new Map<string, string>();

  constructor(deps: CliHomeDeps) { this.deps = deps; }

  /** Its own home, then its sign-in; `chosenLabel` renames an account that is retried; `signInUrl`: the page the sign-in printed. */
  async add(provider: ProviderId, chosenLabel: string | undefined, label: string, away = false): Promise<Account & { signInUrl?: string } & AwaySignIn> {
    const retry = this.unstarted.get(provider);
    const pending = retry ? this.deps.repo.get(retry) : undefined;
    let account: Account;
    if (pending?.state === 'needs_login' && pending.home) account = this.deps.save({ ...pending, label: chosenLabel ?? pending.label });
    else {
      account = this.deps.blank(provider, { auth: 'cli', label, state: 'needs_login' });
      account.home = this.homeFor(provider, account.id);
      await this.mkdir(account.home);
      this.deps.save(account);
    }
    let started: Awaited<ReturnType<CliHomeDeps['login']>>;
    try { started = await this.deps.login(account.id, away); } catch (error) { this.unstarted.set(provider, account.id); throw error; }
    const { url, code, paste } = started;
    const added = this.deps.require(account.id);
    return url ? { ...added, signInUrl: url, ...(code ? { code } : {}), ...(paste ? { paste } : {}) } : added;
  }

  private homeFor(provider: ProviderId, id: string): string {
    return path.join(this.deps.accounts, provider, id);
  }

  private mkdir(dir: string): Promise<void> {
    return (this.deps.mkdir ?? ((folder) => fsp.mkdir(folder, { recursive: true }).then(() => undefined)))(dir);
  }

  /**
   * A login found in the default home as its account: Codex in a home of its own with a copy of that login – the home
   * of that login another company here runs already (its note's e-mail, the same workspace), else a new one; others as given.
   */
  found(account: Account): Account {
    if (account.provider !== 'codex' || account.home) return account;
    const from = defaultHome('codex', this.deps.env ?? process.env, this.deps.homeDir ?? os.homedir());
    const login = from ? loginIn('codex', from, loginFiles('codex')[0])?.json : undefined;
    const who = login && identity('codex', login);
    const used = new Set(this.deps.repo.list().flatMap((other) => (other.home ? [homeKey(other.home)] : [])));
    const mine = sharedLogins(this.deps.accounts).find((shared) => shared.provider === 'codex' && sameEmail(shared.email, login && loginEmail('codex', login))
      && !used.has(homeKey(shared.home)) && oneLogin(who, whoseLogin('codex', shared.home)));
    const home = mine?.home ?? this.homeFor('codex', account.id);
    if (!this.take(home) && !mine) void this.mkdir(home).catch(() => undefined); // its sign-in runs there
    return { ...account, home, detected: true };
  }

  /** This PC's plan logins in the logins folder (sharedLogins). */
  shared(): SharedLogin[] { return sharedLogins(this.deps.accounts); }

  /** Keeps the note of the account's home naming the login's e-mail (another company adopts by it). */
  note(account: Account): void {
    if (!account.home || !account.email || account.auth !== 'cli' || !ownHomes(account.provider) || this.noted.get(account.home) === account.email) return;
    if (readNote(account.home).email !== account.email) writeNote(account.home, { email: account.email });
    if (readNote(account.home).email === account.email) this.noted.set(account.home, account.email); // a home not made yet: the next save
  }

  /** A found Codex login whose copy failed: the default home's login again when it is newer and the same person's; true when taken. */
  retake(account: Account): boolean {
    return account.provider === 'codex' && account.detected && Boolean(account.home) && this.take(account.home!);
  }

  /** The default Codex home's login into `home` when it is newer there (login-file.ts takeLogin); false when nothing was copied. */
  private take(home: string): boolean {
    const from = defaultHome('codex', this.deps.env ?? process.env, this.deps.homeDir ?? os.homedir());
    try { return from ? takeLogin('codex', loginFiles('codex'), from, home) : false; } catch { return false; }
  }

  /** The account's sign-in runs now: the next add makes a new home. */
  started(account: Account): void {
    if (this.unstarted.get(account.provider) === account.id) this.unstarted.delete(account.provider);
  }
}
