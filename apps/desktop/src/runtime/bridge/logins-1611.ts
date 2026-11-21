// Bridge of 16.11.2026 (one plan login per PC, owner F28): the homes of plan logins (Codex, Claude Code, Kimi Code) lived
// per company in <data>/accounts/<provider>/<id>, so one login used by two companies on one PC sat there as two copies,
// and the CLIs' rotating refresh tokens signed one copy out (the old company's Claude plans were switched off for that).
// They live once per PC in its logins folder now (Paths.accounts, accounts/cli-homes.ts). At each start of this version
// (from AccountService, before anything uses a home) this company's homes still in <data>/accounts move there – the whole
// folder by one rename on the same volume, never a copy – and the row points at it. A login of the same person (provider
// and e-mail in the home's note, and the same account where both homes say whose login they hold – cli-homes.ts
// whoseLogin: one e-mail can hold a personal and a business plan) that another company moved there first is one login:
// the row points at that home, the newer of the two logins stays there (this company's login file moves in when it is the
// newer one) and this company's old folder goes (in the background: its own native sessions start anew). A home that
// cannot move (in use, another volume, the folder there holds another login, a login the CLI keeps outside a file – macOS
// Keychain, Kimi Code) stays where it is and keeps working; the next start tries again. A row whose home is gone (a start
// cut off after the rename, a row restored from before the move) points at that login's home in the logins folder again.
// One company moves at a time (<logins>/.move.lock, taken over only from a process that is gone, by one waiter). The
// sign-out marks of rows with a home move from this company's kv into the homes' notes, and the 0.3.8 handoff's marker
// file in the data folder goes. Deleted in the version after the bridge.
// Owns: that move. Never: copies a login, changes another company's rows, or deletes an old folder its row still points at.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Account } from '../../shared/model/providers.ts';
import type { Logger } from '../contracts.ts';
import type { Db } from '../db/database.ts';
import type { AccountRepo } from '../accounts/repo.ts';
import { KvRepo } from '../store/kv.ts';
import { homeKey, loginFiles, oneLogin, ownHomes, readNote, sameEmail, sharedLogins, SIGNED_OUT, whoseLogin, writeNote } from '../accounts/cli-homes.ts';
import { loginIn } from '../accounts/login-file.ts';
import { replaceWithSync } from '../devices/sync/file-io.ts';

export interface LoginMoveDeps {
  db: Db;
  repo: AccountRepo;
  /** <data>/accounts: this company's homes of before. */
  legacy: string;
  /** Paths.accounts: this PC's logins folder. */
  logins: string;
  log?: Pick<Logger, 'info' | 'warn'>;
  platform?: NodeJS.Platform;
  /** How often the lock is tried, 50 ms apart (default 100: five seconds). */
  tries?: number;
}

const LOCK = '.move.lock';
const code = (error: unknown) => String((error as NodeJS.ErrnoException)?.code ?? 'failed');

const FOLDER = /^[\w-]{1,100}$/;

/**
 * A row the move is for: a home of before of this company (<legacy>/<its provider>/<one folder>), or a home that is gone (a
 * row restored from before the move, an imported company's) – of a CLI whose login is a file here; a login the CLI may bind
 * to its folder's path (Claude Code in the macOS Keychain, Kimi Code) stays where it is and works.
 */
function toMove(legacy: string, account: Account, platform?: NodeJS.Platform): boolean {
  if (account.auth !== 'cli' || !account.home || !ownHomes(account.provider) || !loginFiles(account.provider, platform).length) return false;
  if (!existsSync(account.home)) return true;
  const parts = path.relative(path.resolve(legacy), path.resolve(account.home)).split(path.sep);
  return parts.length === 2 && parts[0] === account.provider && FOLDER.test(parts[1]);
}

/**
 * The move at a start (synchronous, before anything uses a home): never throws – what cannot move now stays where it is
 * and works. Resolves once the old folders of joined logins are gone (deleted in the background).
 */
export function moveLoginHomes(deps: LoginMoveDeps): Promise<void> {
  try { rmSync(path.join(path.dirname(deps.legacy), '.claude-home-registry.json'), { force: true }); } catch { /* the next start */ } // the 0.3.8 handoff's marker
  const rows = homeKey(deps.legacy) === homeKey(deps.logins) ? [] : deps.repo.list().filter((account) => toMove(deps.legacy, account, deps.platform));
  const removals: Array<Promise<void>> = [];
  if (rows.length) {
    const release = lock(deps.logins, deps.tries ?? 100);
    if (!release) deps.log?.warn('login homes not moved yet: the logins folder is busy or cannot be made', { count: rows.length });
    else {
      try {
        for (const account of rows) {
          try { moveOne(deps, account, removals); } catch (error) { deps.log?.warn('login home kept in place', { account: account.id, error: code(error) }); }
        }
      } finally { release(); }
    }
  }
  try { marksIntoNotes(deps); } catch (error) { deps.log?.warn('sign-out marks not moved', { error: code(error) }); }
  return Promise.all(removals).then(() => undefined);
}

function moveOne(deps: LoginMoveDeps, account: Account, removals: Array<Promise<void>>): void {
  const home = account.home!;
  const folder = path.basename(home);
  const target = FOLDER.test(folder) ? path.join(deps.logins, account.provider, folder) : undefined;
  const used = new Set(deps.repo.list().filter((other) => other.id !== account.id && other.home).map((other) => homeKey(other.home!)));
  const who = existsSync(home) ? whoseLogin(account.provider, home, deps.platform) : undefined;
  /** A home there holds this login: no other row here uses it, and neither its note's e-mail nor its login names another. */
  const fits = (dir: string) => {
    const theirs = readNote(dir).email;
    return !used.has(homeKey(dir)) && !(account.email && theirs && !sameEmail(account.email, theirs)) && oneLogin(who, whoseLogin(account.provider, dir, deps.platform));
  };
  const same = account.email
    ? sharedLogins(deps.logins, deps.platform).filter((login) => login.provider === account.provider && sameEmail(login.email, account.email)).map((login) => login.home)
    : [];
  if (!existsSync(home)) { // a start that ended between the rename and the row's save, or a row back on a home of before that is gone (a restore)
    const found = [...(target ? [target] : []), ...same].find((dir) => existsSync(dir) && fits(dir));
    if (found) { deps.repo.save({ ...account, home: found }); deps.log?.info('login home found again in the logins folder', { account: account.id }); }
    return;
  }
  const into = same.find(fits) ?? (target && existsSync(target) ? target : undefined);
  if (!into) {
    if (!target) return;
    mkdirSync(path.dirname(target), { recursive: true });
    renameSync(home, target); // the whole folder, same volume; refused (in use, another volume): it stays where it is
    deps.repo.save({ ...account, home: target });
    if (account.email) writeNote(target, { email: account.email });
    deps.log?.info('login home moved into the logins folder', { account: account.id });
    return;
  }
  if (!fits(into)) {
    deps.log?.warn('login home kept in place: that folder holds another login', { account: account.id });
    return;
  }
  join(deps, account, into, removals);
}

/** One login in two companies: the newer login file stays in the shared home, the row points there, the old folder goes. */
function join(deps: LoginMoveDeps, account: Account, into: string, removals: Array<Promise<void>>): void {
  const home = account.home!;
  const names = loginFiles(account.provider, deps.platform);
  const mine = names[0] ? loginIn(account.provider, home, names[0]) : undefined;
  const there = names[0] ? loginIn(account.provider, into, names[0]) : undefined;
  if (mine && mine.at > (there?.at ?? 0)) { // the newest login wins: this company's moves in (rename; a copy only where Windows refuses it)
    for (const name of names) {
      const from = path.join(home, name);
      if (existsSync(from)) replaceWithSync(from, path.join(into, name));
    }
  }
  deps.repo.save({ ...account, home: into });
  if (account.email) writeNote(into, { email: account.email });
  // the old folder (its own sessions, a stale login copy) goes in the background: no row uses it any more
  removals.push(rm(home, { recursive: true, force: true }).catch((error: unknown) => deps.log?.warn('old login folder not removed', { account: account.id, error: code(error) })));
  deps.log?.info('login home joined the same login in the logins folder', { account: account.id, home: path.basename(into), newer: mine && mine.at > (there?.at ?? 0) ? 'this company' : 'shared' });
}

/** The move lock in the logins folder; its release, or undefined while another living process holds it after all tries. */
function lock(dir: string, tries: number): (() => void) | undefined {
  try { mkdirSync(dir, { recursive: true }); } catch { return undefined; }
  const file = path.join(dir, LOCK);
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => { try { rmSync(file, { force: true }); } catch { /* a gone holder's lock is taken over */ } };
    } catch (error) { if (code(error) !== 'EEXIST') return undefined; }
    const seen = gone(file);
    if (seen !== undefined) { takeOver(file, seen); continue; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return undefined;
}

/** The lock's content when its holder runs no more (or never wrote its pid within 10 s); undefined while it lives. */
function gone(file: string): string | undefined {
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return undefined; }
  try {
    const pid = Number(text);
    if (!Number.isInteger(pid) || pid <= 0) return Date.now() - statSync(file).mtimeMs > 10_000 ? text : undefined;
    process.kill(pid, 0);
    return undefined;
  } catch (error) { return code(error) === 'ESRCH' ? text : undefined; }
}

/**
 * A gone holder's lock (`seen`) moves aside and goes: one waiter's rename takes it. A lock another waiter made meanwhile
 * (it took the gone one over first) is a living one: it goes back.
 */
function takeOver(file: string, seen: string): void {
  const aside = `${file}.${process.pid}.gone`;
  try { renameSync(file, aside); } catch { return; } // another waiter moved it first
  try {
    if (readFileSync(aside, 'utf8') === seen) rmSync(aside, { force: true });
    else renameSync(aside, file);
  } catch { /* the next try looks again */ }
}

/** A sign-out mark of a row with a home of its own lives in that home's note now (cli-homes.ts signedOut). */
function marksIntoNotes(deps: LoginMoveDeps): void {
  const kv = new KvRepo(deps.db);
  for (const account of deps.repo.list()) {
    if (!account.home || kv.get<boolean>(SIGNED_OUT, account.id) !== true) continue;
    writeNote(account.home, { signedOut: Date.now() });
    if (readNote(account.home).signedOut !== undefined) kv.delete(SIGNED_OUT, account.id);
  }
}
