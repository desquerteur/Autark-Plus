// Plan logins between the CEO's own PCs (mesh method 'sync.login': sign in on one PC, the plan works on all of his): the files that hold a CLI plan's login (accounts/cli-homes.ts loginFiles – Codex auth.json,
// Claude Code .credentials.json, Gemini CLI oauth_creds.json and google_accounts.json) are read at send time and
// travel only inside the encrypted, key-pinned mesh channel, like secret values (secrets.ts). One unit per account:
// its files and the login's own time (Codex last_refresh, Claude Code's and Gemini CLI's token expiry, else the
// file's mtime); the newer login wins, an older or equal one never replaces the one here, and a file without a token
// to refresh with (an emptied login) never travels. The receiver writes the files whole (temp beside them, mode 0600,
// file-io.ts) into the account's home here – its own <accounts>/<provider>/<id> (Paths.accounts), or a CLI's default home
// (~/.claude, ~/.gemini) for a login this PC found there, but never over a file whose identity (accounts/login-file.ts) differs – and asks for the account check when the account is not signed in yet.
// A login of another PC's account that this PC has itself (tables.ts: the same provider and e-mail) lands in that
// account. A plan the person signed out of here (accounts/cli-homes.ts signedOut) takes no login from another PC
// until one is made here again. A login whose refresh token another plan's home on the same PC already holds is one login
// in two accounts (a Claude Code login file names no account; the next refresh signed both plans out) – it is neither taken
// nor sent; neither is a refresh token a list carries for two accounts at once, also when it comes alone later, and one
// login is checked and written at a time. The CLIs refresh their tokens and rewrite these files: a watch on each home's
// folder and every account change (a cheap compare) send a changed login within a second, so a second PC acts
// like a second process on the same PC, which reads the file again before it refreshes. Claude Code on macOS keeps
// its login in the Keychain: nothing is sent or written there.
// 16.11.2026: a plan's home is this PC's one home of that login, shared by every company here (accounts/cli-homes.ts):
// each company's LoginSync reads and writes the same file (whole, the newer login wins, so two writers are harmless),
// and a refresh token is held elsewhere when any other home on this PC holds it – this company's plans' homes and every
// home in the PC's logins folder. A sign-out mark is the home's (every company's LoginSync keeps out a linked PC's login).
// Owns: reading, sending and writing these files. Never: logs, journals or returns their content, shows them to
// an agent, a tool or the UI, or sends them to a PC that is no 'ceo' link.

import { createHash, randomUUID } from 'node:crypto';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeServices } from '../../contracts.ts';
import type { Account } from '../../../shared/model/providers.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import { homeKey, loginDir, loginFiles, onePerPc, ownHomes, sharedLogins, signedOut } from '../../accounts/cli-homes.ts';
import { MAX_LOGIN_FILE, identity, loginTime, parseLogin, refreshToken, signedIn, type Json } from '../../accounts/login-file.ts';
import { DevicesRepo } from '../repo.ts';
import { replaceWith } from './file-io.ts';
import { linkOf, links } from './home.ts';

interface LoginFile { name: string; data: string }
/** One account's login as it travels (`data`: the file's bytes, base64). */
/** AF-024: `own` – the sender's account has a home of its own (absent from older PCs, which had none for Gemini CLI). */
export interface Login { account: string; provider: string; email?: string; at: number; files: LoginFile[]; own?: boolean }

export interface LoginDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** The user's home folder (the CLIs' default homes lie below it). */
  homeDir?: string;
  watch?: (dir: string, listener: (event: string, name: string | Buffer | null) => void) => FSWatcher;
}

/** How long a change gathers before the login is read (a CLI writes in steps). */
const SETTLE_MS = 500;
const SETTLED: ReadonlySet<string> = new Set(['ok', 'cooling', 'disabled']);

const code = (error: unknown) => (error instanceof WorkforceError ? error.code : String((error as NodeJS.ErrnoException)?.code ?? 'failed')); // never a message: it could quote content

const digestOf = (files: readonly LoginFile[]) => createHash('sha256').update(JSON.stringify(files)).digest('hex');

/** A login's refresh token as a hash (a CLI with homes of its own), to compare without keeping the token. */
function tokenKey(login: Login): string | undefined {
  if (!ownHomes(login.provider as Account['provider'])) return undefined;
  const first = parseLogin(Buffer.from(login.files[0].data, 'base64'));
  const token = first && refreshToken(login.provider, first);
  return token ? createHash('sha256').update(`${login.provider}\n${token}`).digest('hex') : undefined;
}

/** The token keys one list carries for two accounts or more. */
function twinKeys(logins: readonly Login[]): string[] {
  const owners = new Map<string, Set<string>>();
  for (const login of logins) {
    const key = tokenKey(login);
    if (key) owners.set(key, (owners.get(key) ?? new Set<string>()).add(login.account));
  }
  return [...owners].filter(([, accounts]) => accounts.size > 1).map(([key]) => key);
}

const valid = (item: unknown): item is Login => {
  const login = item as Login;
  return Boolean(login) && typeof login.account === 'string' && login.account.length <= 200 && typeof login.provider === 'string'
    && typeof login.at === 'number' && Array.isArray(login.files) && login.files.length > 0 && login.files.length <= 4
    && login.files.every((file) => typeof file?.name === 'string' && typeof file.data === 'string' && file.data.length <= MAX_LOGIN_FILE * 2)
    && new Set(login.files.map((file) => file.name)).size === login.files.length;
};

export class LoginSync {
  private readonly s: RuntimeServices;
  private readonly deps: LoginDeps;
  /** Per account: what was last sent or written here (a change notice that changes nothing sends nothing). */
  private readonly known = new Map<string, string>();
  private readonly watchers = new Map<string, { account: string; watcher: FSWatcher }>();
  private readonly pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  /** The login being checked and written (two calls at once would both find no twin here). */
  private applying: Promise<unknown> = Promise.resolve();
  /** Token keys a linked PC sent for two plans at once: that login is no plan's, also when it comes alone later. */
  private readonly twins = new Set<string>();

  constructor(s: RuntimeServices, deps: LoginDeps = {}) {
    this.s = s;
    this.deps = deps;
  }

  private get platform(): NodeJS.Platform { return this.deps.platform ?? process.platform; }

  /** The CLI plans whose login is a file this PC knows. */
  private plans(): Account[] {
    // 17.11.2026: a login the person kept on this PC (`thisPcOnly`) is neither sent nor watched for sending
    return this.s.accounts.list().filter((account) => account.auth === 'cli' && !account.thisPcOnly && loginFiles(account.provider, this.platform).length > 0);
  }

  private homeOf(account: Account): string | undefined {
    return loginDir(account, this.deps.env ?? process.env, this.deps.homeDir ?? os.homedir()); // AF-024: Gemini CLI's own homes keep it in .gemini
  }

  private ceoPeers(except?: string): string[] {
    return links(this.s.db).filter(({ record, link }) => link.kind === 'ceo' && record.id !== except).map(({ record }) => record.id);
  }

  // ---------------------------------------------------------------- sending

  /** Watches the plans' homes and hears account changes; returns the off switch. */
  attach(): () => void {
    const offs = [
      this.s.bus.on('account.upserted', (account) => { this.watchHomes(); this.soon(account.id); }),
      this.s.bus.on('account.removed', ({ id }) => { signedOut.clear(this.s.db, { id }); this.watchHomes(); }), // a home's mark stays: it is the login's
    ];
    this.watchHomes();
    return () => {
      for (const off of offs) off();
      for (const { watcher } of this.watchers.values()) watcher.close();
      this.watchers.clear();
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
    };
  }

  private watchHomes(): void {
    const want = new Map<string, Account>();
    try { for (const account of this.plans()) { const home = this.homeOf(account); if (home) want.set(home, account); } } catch { return; }
    for (const [dir, { account, watcher }] of this.watchers) if (want.get(dir)?.id !== account) { watcher.close(); this.watchers.delete(dir); }
    for (const [dir, account] of want) {
      if (this.watchers.has(dir)) continue;
      const names = loginFiles(account.provider, this.platform);
      try {
        const watcher = (this.deps.watch ?? fsWatch)(dir, (_event, name) => { if (!name || names.some((file) => String(name).startsWith(file))) this.soon(account.id); });
        watcher.on('error', () => { watcher.close(); this.watchers.delete(dir); });
        this.watchers.set(dir, { account: account.id, watcher });
      } catch { /* no folder yet: the next account change looks again */ }
    }
  }

  private soon(id: string): void {
    this.pending.add(id);
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, SETTLE_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async flush(): Promise<void> {
    const ids = [...this.pending];
    this.pending.clear();
    const logins: Login[] = [];
    for (const id of ids) {
      const account = this.s.accounts.get(id);
      const read = account ? await this.local(account) : undefined;
      if (!read || this.known.get(id) === read.digest) continue;
      this.known.set(id, read.digest);
      logins.push(read.login);
    }
    for (const peer of this.ceoPeers()) if (this.s.devices.online(peer)) await this.post(peer, logins);
  }

  /** The login of `account` as it would travel; undefined when there is none (no file, emptied, half written, kept in the Keychain). */
  private async read(account: Account): Promise<{ login: Login; digest: string } | undefined> {
    const home = this.homeOf(account);
    const names = account.auth === 'cli' ? loginFiles(account.provider, this.platform) : [];
    if (!home || !names.length) return undefined;
    const files: LoginFile[] = [];
    let at = 0;
    for (const [index, name] of names.entries()) {
      const file = path.join(home, name);
      const info = await lstat(file).catch(() => undefined);
      if (!info?.isFile() || info.size > MAX_LOGIN_FILE) { if (index === 0) return undefined; continue; }
      const bytes = await readFile(file);
      const json = parseLogin(bytes);
      if (!json || (index === 0 && !signedIn(account.provider, json))) return undefined;
      if (index === 0 && await this.heldElsewhere(account, json)) return undefined; // whose it is stays unclear: it stays here
      if (index === 0) at = loginTime(account.provider, json, info.mtimeMs);
      files.push({ name, data: bytes.toString('base64') });
    }
    const own = account.home ? { own: true } : {}; // AF-024
    return { login: { account: account.id, provider: account.provider, ...(account.email ? { email: account.email } : {}), at, files, ...own }, digest: digestOf(files) };
  }

  /** The login here as it would travel; one that is here ends a sign-out mark (the person signed in here again). */
  private async local(account: Account): Promise<{ login: Login; digest: string } | undefined> {
    const read = await this.read(account).catch(() => undefined);
    if (read) signedOut.clear(this.s.db, account);
    return read;
  }

  private async post(peer: string, logins: Login[]): Promise<boolean> {
    if (!logins.length) return true;
    try {
      await this.s.devices.call(peer, 'sync.login', { logins });
      return true;
    } catch (error) {
      this.s.log.info('logins not sent', { peer, count: logins.length, error: code(error) });
      return false;
    }
  }

  /** What the link-up owes a CEO PC: every plan's login (the other PC keeps what is newer there). */
  async catchUp(peer: string): Promise<boolean> {
    if (linkOf(new DevicesRepo(this.s.db).get(peer))?.kind !== 'ceo') return true;
    const logins: Login[] = [];
    for (const account of this.plans()) {
      const read = await this.local(account);
      if (!read) continue;
      this.known.set(account.id, read.digest);
      logins.push(read.login);
    }
    return this.post(peer, logins);
  }

  // ---------------------------------------------------------------- receiving

  /** 'sync.login' from a CEO PC: each newer login is written here and passed on to the other CEO PCs. */
  async receive(params: unknown, from: string): Promise<{ ok: true; applied: number }> {
    if (linkOf(new DevicesRepo(this.s.db).get(from))?.kind !== 'ceo') throw new WorkforceError('forbidden', 'Logins come only from the CEO\'s own PCs.');
    const list = (params as { logins?: unknown } | null)?.logins;
    const logins = (Array.isArray(list) ? list : []).filter(valid);
    for (const key of twinKeys(logins)) this.twins.add(key);
    const applied: Login[] = [];
    for (const login of logins) {
      const key = tokenKey(login);
      if (key && this.twins.has(key)) { this.s.log.warn('one login for two plans not taken', { account: login.account }); continue; }
      try { if (await this.inTurn(login)) applied.push(login); } catch (error) { this.s.log.warn('synced login not stored', { account: login.account, error: code(error) }); }
    }
    for (const peer of this.ceoPeers(from)) if (this.s.devices.online(peer)) await this.post(peer, applied);
    return { ok: true, applied: applied.length };
  }

  /** The plan here a login belongs to: the same account, else the same login (provider and e-mail; any, for a CLI with one sign-in per PC). */
  private targetOf(login: Login): Account | undefined {
    const plans = this.s.accounts.list().filter((account) => account.auth === 'cli' && account.provider === login.provider);
    return plans.find((account) => account.id === login.account)
      ?? plans.find((account) => (onePerPc(account) && onePerPc(login, login.own === true)) || (Boolean(login.email) && account.email === login.email));
  }

  private inTurn(login: Login): Promise<boolean> {
    const run = this.applying.then(() => this.apply(login));
    this.applying = run.catch(() => undefined);
    return run;
  }

  private async apply(login: Login): Promise<boolean> {
    const target = this.targetOf(login);
    const home = target && this.homeOf(target);
    const names = target ? loginFiles(target.provider, this.platform) : [];
    if (!target || !home || login.files[0].name !== names[0]) return false; // not here, or kept in the Keychain here
    if (signedOut.has(this.s.db, target)) {
      this.s.log.info('login of a plan signed out here not taken', { account: target.id });
      return false;
    }
    const files = login.files.filter((file) => names.includes(file.name)).map((file) => ({ name: file.name, bytes: Buffer.from(file.data, 'base64') }));
    const first = parseLogin(files[0].bytes);
    if (!first || !signedIn(target.provider, first) || files.some((file) => !parseLogin(file.bytes))) return false;
    const here = await this.loginHere(target, path.join(home, names[0]));
    if (here && here.at >= login.at) return false; // never an older login over this one
    const mine = here && identity(target.provider, here.json);
    const theirs = identity(target.provider, first);
    if (mine && theirs && mine !== theirs) {
      this.s.log.info('login of another account kept', { account: target.id });
      return false;
    }
    const twin = await this.heldElsewhere(target, first);
    if (twin) {
      this.s.log.warn('login of another plan here not taken', { account: target.id, holder: twin.id });
      return false;
    }
    await mkdir(home, { recursive: true });
    for (const file of files) await this.writeWhole(path.join(home, file.name), file.bytes);
    const read = await this.read(target).catch(() => undefined);
    if (read) this.known.set(target.id, read.digest);
    this.s.log.info('login taken from a linked PC', { account: target.id });
    if (!SETTLED.has(target.state)) void this.s.accounts.checkNow?.(target.id);
    return true;
  }

  /**
   * Another home of the provider here that holds the refresh token of `file` (never the same home): a plan's of this
   * company, or any home in this PC's logins folder (another company's); its id names it in the log.
   */
  private async heldElsewhere(account: Account, file: Json): Promise<{ id: string } | undefined> {
    const token = refreshToken(account.provider, file);
    const home = this.homeOf(account);
    if (!token || !home) return undefined;
    const homes = new Map<string, { id: string; home: string }>();
    for (const other of this.plans()) {
      const there = other.provider === account.provider ? this.homeOf(other) : undefined;
      if (there) homes.set(homeKey(there), { id: other.id, home: there });
    }
    const root = this.s.paths?.accounts;
    for (const shared of root ? sharedLogins(root, this.platform) : []) {
      if (shared.provider === account.provider && !homes.has(homeKey(shared.home))) homes.set(homeKey(shared.home), { id: shared.id, home: shared.home });
    }
    homes.delete(homeKey(home));
    for (const other of homes.values()) {
      const bytes = await readFile(path.join(other.home, loginFiles(account.provider, this.platform)[0])).catch(() => undefined);
      const json = bytes && parseLogin(bytes);
      if (json && refreshToken(account.provider, json) === token) return other;
    }
    return undefined;
  }

  /** The login file in the home here with its time (0: no login in it, e.g. emptied). */
  private async loginHere(account: Account, file: string): Promise<{ json: Json; at: number } | undefined> {
    const info = await lstat(file).catch(() => undefined);
    if (!info?.isFile()) return undefined;
    const json = parseLogin(await readFile(file)) ?? {};
    return { json, at: signedIn(account.provider, json) ? loginTime(account.provider, json, info.mtimeMs) : 0 };
  }

  private async writeWhole(file: string, bytes: Buffer): Promise<void> {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes, { mode: 0o600 });
      await chmod(temp, 0o600);
      await replaceWith(temp, file);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
}
