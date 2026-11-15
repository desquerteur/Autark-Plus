// CLI accounts with homes of their own (Codex, Claude Code, Kimi Code): adding one creates <accounts>/<provider>/<id>
// (CODEX_HOME, CLAUDE_CONFIG_DIR, KIMI_CODE_HOME) and starts its sign-in; a sign-in that could not start keeps the account
// and the error, and the next add of that provider retries that account. Removing deletes a home only when it is exactly
// <accounts>/<its provider>/<its id> – never a CLI's default home, the accounts folder, a provider folder or another
// account's home. It also names each CLI's default home and the files that hold its login there (devices/sync/logins.ts
// copies those between PCs), and marks the plans the person signed out of here.
// Codex runs only in homes of its own, so nothing of the person's own Codex set-up (config.toml, AGENTS.md, skills, MCP
// servers) reaches an agent: a Codex login found in the default home (~/.codex) becomes an account whose home gets a copy
// of that login (found), and when that copy stops working while the default home holds a newer login of the same person,
// it takes that one again (retake – the CLIs rotate refresh tokens, so after one side refreshed the other copy fails).
// The default home is only ever read.
// Owns: creating and deleting these homes, the retry of an unstarted sign-in, the login copies from the default home,
// those names and the sign-out marks. Never: signs in itself (the service's login does) or writes into a CLI's default home.

import os from 'node:os';
import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { Account, ProviderId } from '../../shared/model/providers.ts';
import type { Db } from '../db/database.ts';
import { KvRepo } from '../store/kv.ts';
import { acpProvider } from '../engines/acp/providers.ts';
import type { AccountRepo } from './repo.ts';
import type { AwaySignIn } from '../../shared/api/methods-providers.ts';
import { takeLogin } from './login-file.ts';

const SIGNED_OUT = 'accounts.signed-out';

/**
 * The plans the person signed out of on this PC (accounts.logout): `mark` after the sign-out, `has` before a login
 * from another PC is written (it is not), `clear` once a login is here again or the account is gone.
 */
export const signedOut = {
  mark: (db: Db, id: string, at: number): void => new KvRepo(db).set(SIGNED_OUT, id, true, at),
  has: (db: Db, id: string): boolean => new KvRepo(db).get<boolean>(SIGNED_OUT, id) === true,
  clear: (db: Db, id: string): void => { new KvRepo(db).delete(SIGNED_OUT, id); },
};

/** Whether accounts of `provider` get homes of their own (CODEX_HOME, CLAUDE_CONFIG_DIR, KIMI_CODE_HOME); else one sign-in per PC in the default home. */
export function ownHomes(provider: ProviderId): boolean {
  return provider === 'codex' || provider === 'claude' || Boolean(acpProvider(provider)?.home);
}

/** A CLI's default home, where a login this PC finds lives; undefined: none known. */
export function defaultHome(provider: ProviderId, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | undefined {
  if (provider === 'codex') return env.CODEX_HOME || path.join(home, '.codex');
  if (provider === 'claude') return env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return provider === 'gemini-cli' ? path.join(home, '.gemini') : undefined;
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
  rmdir?: (dir: string) => Promise<void>;
}

export class CliHomes {
  private readonly deps: CliHomeDeps;
  /** Per provider: the account whose sign-in add() could not start (CLI or terminal missing). */
  private readonly unstarted = new Map<ProviderId, string>();

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

  /** A login found in the default home as its account: Codex in a home of its own with a copy of that login; others as given. */
  found(account: Account): Account {
    if (account.provider !== 'codex' || account.home) return account;
    const home = this.homeFor('codex', account.id);
    if (!this.take(home)) void this.mkdir(home).catch(() => undefined); // its sign-in runs there
    return { ...account, home, detected: true };
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

  /** Deletes the account's home when it is exactly <accounts>/<its provider>/<its id> (add, found); anything else stays. */
  async remove(account: Account): Promise<void> {
    if (!account.home) return;
    const parts = path.relative(path.resolve(this.deps.accounts), path.resolve(account.home)).split(path.sep);
    const own = parts.length === 2 && parts[0] === account.provider && parts[1] === account.id;
    if (own) await (this.deps.rmdir ?? ((dir) => fsp.rm(dir, { recursive: true, force: true })))(path.resolve(account.home)).catch(() => undefined);
  }
}
