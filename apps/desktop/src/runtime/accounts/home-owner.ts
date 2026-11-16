// Owns: machine home identities, admission leases and handoff journal. Never: reads credentials or steals live/crash-uncertain leases.
// Single-machine Claude home ownership. No credentials. One short synchronous OS-directory lock
// serializes admissions and journal changes across runtimes. Never steal a lock/lease on timeout:
// a crashed writer or an orphan process requires investigation, not a TTL takeover.
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmdirSync, openSync, fsyncSync, closeSync, lstatSync, realpathSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Account } from '../../shared/model/providers.ts';
import { WorkforceError } from '../../shared/errors.ts';

export const HOME_PROTOCOL = 1;
export const conflict = (message: string): never => { throw new WorkforceError('conflict', message); };
const keyPath = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
/** Local, existing, canonical directory, with NO symlink/junction in its ancestry. */
export function canonicalDirectory(dir: string): string {
  if (!path.isAbsolute(dir) || /^[/\\]{2}/.test(dir)) return conflict('A local absolute directory is required.');
  let cursor = path.resolve(dir);
  for (;;) {
    const info = lstatSync(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) return conflict('Aliased or non-directory home/store path.');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const real = realpathSync.native(dir);
  if (keyPath(real) !== keyPath(dir)) return conflict('Home/store aliases are not supported.');
  return keyPath(real);
}
import type { RuntimeIdentity, Binding, Phase, Handoff } from '../../shared/model/account-transfer.ts';
export type { RuntimeIdentity, Binding, Phase, Handoff } from '../../shared/model/account-transfer.ts';
interface Home { path: string; identity: string; owner: Binding; generation: number; leases: Record<string, { pid: number; boot: string; kind: string }>; transfer?: Handoff }
interface Store { version: 1; homes: Record<string, Home>; operations?: Record<string, { token: string; pid: number; boot: string; company: string }> }
export interface HomePermit { id: string; kind: string; release(): void; fenced(): boolean; imported: boolean }
export class HomeOwners {
  readonly runtime: RuntimeIdentity;
  private readonly dir: string;
  private readonly registryIdentity: string;
  constructor(dir: string, runtime: Omit<RuntimeIdentity, 'protocol' | 'pid' | 'boot'>) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.dir = canonicalDirectory(dir);
    const registryStat = statSync(this.dir, { bigint: true });
    this.registryIdentity = `${registryStat.dev}:${registryStat.ino}`;
    this.runtime = { ...runtime, data: canonicalDirectory(runtime.data), accounts: canonicalDirectory(runtime.accounts), protocol: HOME_PROTOCOL, pid: process.pid, boot: randomUUID() };
    // Independent company-side marker detects a missing/moved/recreated machine registry at restart.
    const marker = path.join(this.runtime.data, '.claude-home-registry.json');
    const info = statSync(this.dir, { bigint: true });
    const identity = { directory: this.dir, identity: `${info.dev}:${info.ino}`, protocol: HOME_PROTOCOL };
    if (existsSync(marker)) {
      const prior = JSON.parse(readFileSync(marker, 'utf8')) as typeof identity;
      if (prior.directory !== identity.directory || prior.identity !== identity.identity || prior.protocol !== identity.protocol || !existsSync(path.join(this.dir, 'owners.json'))) return conflict('Company Claude registry identity lost or moved.');
    }
    this.transact(() => undefined);
    if (!existsSync(marker)) writeFileSync(marker, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  }
  private transact<T>(fn: (store: Store) => T, write = true): T {
    const registryStat = statSync(this.dir, { bigint: true });
    if (`${registryStat.dev}:${registryStat.ino}` !== this.registryIdentity) return conflict('Claude ownership registry directory was replaced.');
    const lock = path.join(this.dir, 'writer.lock');
    let acquired = false;
    for (let attempt = 0; attempt < 20 && !acquired; attempt++) {
      try { mkdirSync(lock, { mode: 0o700 }); acquired = true; } catch { if (attempt < 19) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); }
    }
    if (!acquired) return conflict('Claude ownership registry busy or interrupted; retry, never steal the lock.');
    try {
      const file = path.join(this.dir, 'owners.json');
      const initialized = path.join(this.dir, 'initialized');
      if (!existsSync(file) && existsSync(initialized)) return conflict('Claude ownership journal missing after initialization; fail closed.');
      const s: Store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, homes: {} };
      if (s.version !== 1 || !s.homes) return conflict('Unsupported Claude ownership journal.');
      const result = fn(s);
      if (write) {
        const temp = path.join(this.dir, 'owners.next');
        writeFileSync(temp, JSON.stringify(s), { mode: 0o600 });
        const fd = openSync(temp, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temp, file);
        if (!existsSync(initialized)) writeFileSync(initialized, 'Claude home protocol 1', { flag: 'wx', mode: 0o600 });
      }
      return result;
    } finally { rmdirSync(lock); }
  }
  private homeKey(home: string): { key: string; canonical: string; identity: string } {
    const canonical = canonicalDirectory(home);
    const stat = statSync(canonical, { bigint: true });
    const identity = `${stat.dev}:${stat.ino}`;
    return { canonical, identity, key: createHash('sha256').update(canonical).digest('hex') };
  }
  private find(s: Store, home: string): Home | undefined {
    const k = this.homeKey(home);
    const record = s.homes[k.key] ?? Object.values(s.homes).find(h => h.transfer?.targetHome === k.canonical);
    if (record?.transfer?.targetHome === k.canonical) {
      if (record.transfer.targetIdentity !== k.identity) return conflict('Target home was replaced.');
      return record;
    }
    if (record && (record.identity !== k.identity || record.path !== k.canonical)) return conflict('Claude home was replaced; ownership is uncertain.');
    // Also reject a second spelling/alias of the same filesystem directory.
    if (!record && Object.values(s.homes).some(h => h.identity === k.identity)) return conflict('Claude home identity has another path.');
    return record;
  }
  register(account: Account): void {
    if (account.provider !== 'claude' || account.auth !== 'cli' || !account.home || account.deviceId) return;
    // Only genuine isolated source homes may establish ownership. Foreign bindings already exist in the journal.
    this.transact(s => {
      if (this.find(s, account.home!)) return;
      if (keyPath(account.home!) !== keyPath(path.join(this.runtime.accounts, 'claude', account.id)) || account.detected) return;
      const k = this.homeKey(account.home!);
      s.homes[k.key] = { path: k.canonical, identity: k.identity, owner: { company: this.runtime.company, account: account.id }, generation: 0, leases: {} };
    });
  }
  allowed(account: Account): boolean;
  allowed(h: Home, account?: string): boolean;
  allowed(value: Account | Home, account?: string): boolean {
    if ('leases' in value) {
      const phase = value.transfer?.phase;
      return value.owner.company === this.runtime.company && (!account || value.owner.account === account) && (!phase || phase === 'active' || phase === 'rolledBack');
    }
    if (value.provider !== 'claude' || !value.home) return true;
    try { return this.transact(s => { const h = this.find(s, value.home!); return !h || (this.allowed(h, value.id) && (!h.transfer || canonicalDirectory(value.home!) === (h.transfer.phase === 'rolledBack' ? h.path : h.transfer.targetHome)));  }, false); } catch { return false; }
  }
  admit(home: string, kind: string, account?: string, parentId?: string): HomePermit {
    const id = randomUUID();
    let tracked = false;
    const imported = this.transact(s => {
      const h = this.find(s, home);
      if (!h) return false; // non-isolated/default CLI homes are never transferable
      const continuation = parentId && h.leases[parentId]?.boot === this.runtime.boot;
      if (!continuation && (!this.allowed(h, account) || (h.transfer && h.transfer.phase !== 'rolledBack' && canonicalDirectory(home) !== h.transfer.targetHome))) return conflict('Claude home fenced or owned by another company/account.');
      h.leases[id] = { pid: process.pid, boot: this.runtime.boot, kind }; tracked = true;
      return Boolean(h.transfer && h.owner.company === h.transfer.target.company);
    });
    let released = false;
    return { id, kind, imported,
      fenced: () => { if (!tracked) return false; try { return this.transact(s => { const h = this.find(s, home); return !h || !this.allowed(h, account) || (h.transfer && canonicalDirectory(home) !== (h.transfer.phase === 'rolledBack' ? h.path : h.transfer.targetHome)) === true; }, false); } catch { return true; } },
      release: () => { if (released || !tracked) return; this.transact(s => { for (const h of Object.values(s.homes)) if (h.leases[id]) delete h.leases[id]; }); released = true; },
    };
  }
  protected(account: Account): boolean {
    if (account.provider !== 'claude' || !account.home) return false;
    return this.transact(s => Boolean(this.find(s, account.home!)?.transfer), false);
  }
  acquireOperation(id: string): string {
    return this.transact(s => {
      const operations = s.operations ??= {};
      const old = operations[id];
      if (old) {
        let alive = true; try { process.kill(old.pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
        const home = Object.values(s.homes).find(h => h.transfer?.id === id);
        if (alive || (home && Object.keys(home.leases).length)) return conflict('Another handoff action or an uncertain crashed process still owns the operation.');
      }
      const token = randomUUID();
      operations[id] = { token, pid: process.pid, boot: this.runtime.boot, company: this.runtime.company };
      return token;
    });
  }
  verifyOperation(id: string, token: string, sourceCompany: string): void {
    this.transact(s => {
      const o = s.operations?.[id];
      if (!o || o.token !== token || o.company !== sourceCompany) return conflict('Target effects require the current exclusive source operation.');
      try { process.kill(o.pid, 0); } catch { return conflict('Source coordinator is no longer running.'); }
    }, false);
  }
  releaseOperation(id: string, token: string): void {
    this.transact(s => { if (s.operations?.[id]?.token === token) delete s.operations[id]; });
  }
  inspect(id: string): { home: string; transfer: Handoff; busy: number } {
    return this.transact(s => {
      const h = Object.values(s.homes).find(h => h.transfer?.id === id);
      if (!h?.transfer) return conflict('Unknown Claude handoff.');
      if (![h.transfer.source.company, h.transfer.target.company].includes(this.runtime.company)) return conflict('Not a handoff participant.');
      return { home: h.path, transfer: structuredClone(h.transfer), busy: Object.keys(h.leases).length };
    }, false);
  }
  hasTransfer(id: string): boolean { return this.transact(s => Object.values(s.homes).some(h => h.transfer?.id === id), false); }
  prepare(account: Account, target: Binding, targetRuntime: RuntimeIdentity, id: string): Handoff {
    if (account.provider !== 'claude' || account.auth !== 'cli' || account.detected || account.deviceId || !account.home || keyPath(account.home) !== keyPath(path.join(this.runtime.accounts, 'claude', account.id))) return conflict('Only an existing isolated local Claude CLI account can move.');
    this.register(account);
    return this.transact(s => {
      const h = this.find(s, account.home!)!;
      if (h.transfer?.id === id) {
        if (h.transfer.target.company !== target.company || h.transfer.target.account !== target.account) return conflict('Handoff id reused with another target.');
        return structuredClone(h.transfer);
      }
      if (Object.values(s.homes).some(other => other !== h && other.transfer?.id === id)) return conflict('Handoff id already belongs to another login.');
      if (Object.values(h.leases).some(lease => /(?:remove|logout|login|purge|session-delete)/.test(lease.kind))) return conflict('A destructive/auth-intent operation is already admitted; it must finish BEFORE preparing a handoff.');
      if (h.transfer || !this.allowed(h, account.id)) return conflict('Home already transferred or fenced.');
      const t: Handoff = { id, generation: ++h.generation, source: { company: this.runtime.company, account: account.id }, target, sourceRuntime: this.runtime, targetRuntime, phase: 'fenced', previousEnabled: account.enabled, snapshot: structuredClone(account) };
      h.transfer = t;
      return structuredClone(t);
    });
  }
  fenceRollback(id: string): Handoff {
    return this.transact(s => {
      const h = Object.values(s.homes).find(h => h.transfer?.id === id);
      if (!h?.transfer || h.transfer.source.company !== this.runtime.company) return conflict('Only source can fence rollback.');
      h.transfer.phase = 'rollbackDrain'; h.transfer.generation = ++h.generation;
      return structuredClone(h.transfer);
    });
  }
  targetIntent(id: string, home: string): void {
    this.transact(s => {
      const h = Object.values(s.homes).find(h => h.transfer?.id === id);
      if (!h?.transfer || h.transfer.target.company !== this.runtime.company || h.transfer.phase !== 'sourceDisabled') return conflict('Invalid target home intent.');
      h.transfer.targetHomeIntent = path.resolve(home); h.transfer.targetHomeNonce ??= randomUUID();
    });
  }
  bindTarget(id: string, home: string): void {
    this.transact(s => {
      const h = Object.values(s.homes).find(h => h.transfer?.id === id);
      if (!h?.transfer || h.transfer.target.company !== this.runtime.company || h.transfer.phase !== 'sourceDisabled') return conflict('Target binding outside registration phase.');
      const k = this.homeKey(home);
      const expected = keyPath(path.join(h.transfer.targetRuntime.accounts, 'claude', h.transfer.target.account));
      if (k.canonical !== expected || (h.transfer.targetHome && h.transfer.targetIdentity !== k.identity)) return conflict('Invalid target home binding.');
      h.transfer.targetHome = k.canonical; h.transfer.targetIdentity = k.identity;
    });
  }
  transition(id: string, from: Phase, to: Phase, owner?: Binding): Handoff {
    return this.transact(s => {
      const h = Object.values(s.homes).find(h => h.transfer?.id === id);
      if (!h?.transfer) return conflict('Unknown Claude handoff.');
      const t = h.transfer;
      if (t.source.company !== this.runtime.company) return conflict('Only source coordinates the journal.');
      if (t.phase === to) return structuredClone(t);
      if (t.phase !== from || Object.keys(h.leases).length) return conflict('Handoff needs natural process/write drain or phase recovery.');
      t.phase = to; t.generation = ++h.generation;
      if (owner) h.owner = owner;
      return structuredClone(t);
    });
  }
}
