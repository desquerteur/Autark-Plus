// Owns: exclusive source/target handoff effects and auth-only move recovery. Never: signs in, copies native configuration or edits another database.
// Supported owner-only company handoff. Both sides are live RPC services, never raw DB edits.
// An authenticated two-way nonce handshake precedes EVERY mutation, including retries/rollback.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, existsSync, lstatSync, readFileSync, renameSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import type { Account } from '../../shared/model/providers.ts';
import type { ProcessQuiescence } from './claude-quiescence.ts';
import { HomeOwners, HOME_PROTOCOL, canonicalDirectory, conflict, type RuntimeIdentity, type Handoff } from './home-owner.ts';

import type { TransferCommand, TransferResult, Hello } from '../../shared/model/account-transfer.ts';
export type { TransferCommand, TransferResult, Hello } from '../../shared/model/account-transfer.ts';
export interface TransferDeps {
  owners: HomeOwners;
  externalQuiet(): Promise<ProcessQuiescence>;
  get(id: string): Account | undefined;
  save(account: Account): Account;
  forget(id: string): void;
  /** Resolves only a company id from the trusted desktop host, never a caller path. */
  peer(company: string): { data: string; pid: number };
  call(company: string, command: TransferCommand): Promise<unknown>;
}
/** Deliberately strict: an unknown provider schema is a stop, never a best-effort config import. */
export function validateClaudeCredentialFile(file: string): void {
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1 || info.isSymbolicLink() || info.size > 64 * 1024) return conflict('Unsupported Claude credential file.');
  let obj: unknown;
  try { obj = JSON.parse(readFileSync(file, 'utf8')); } catch { return conflict('Unrecognized Claude credential schema.'); }
  const record = (o: unknown): o is Record<string, unknown> => Boolean(o) && typeof o === 'object' && !Array.isArray(o);
  if (!record(obj) || Object.keys(obj).length !== 1 || !record(obj.claudeAiOauth)) return conflict('Unrecognized Claude credential schema.');
  const oauth = obj.claudeAiOauth;
  const allowed = ['accessToken', 'refreshToken', 'expiresAt', 'scopes', 'subscriptionType', 'rateLimitTier'];
  if (Object.keys(oauth).some(k => !allowed.includes(k)) || typeof oauth.accessToken !== 'string' || !oauth.accessToken || typeof oauth.refreshToken !== 'string' || !oauth.refreshToken || typeof oauth.expiresAt !== 'number' || !Number.isFinite(oauth.expiresAt) || !Array.isArray(oauth.scopes) || !oauth.scopes.every(s => typeof s === 'string') || ['subscriptionType', 'rateLimitTier'].some(k => oauth[k] !== undefined && oauth[k] !== null && typeof oauth[k] !== 'string')) return conflict('Unrecognized Claude credential schema.');
}
/** Move exactly one auth file, no native config/history. Same-volume rename; no credential backup. */
export function moveClaudeAuth(fromHome: string, toHome: string): void {
  canonicalDirectory(fromHome); canonicalDirectory(toHome);
  const from = path.join(fromHome, '.credentials.json'), to = path.join(toHome, '.credentials.json');
  const a = existsSync(from), b = existsSync(to);
  if (a === b) return conflict('Ambiguous auth location (both or neither); investigate, do not copy or overwrite.');
  // Retry after a crash between rename and registration: the unique current file is already there.
  validateClaudeCredentialFile(a ? from : to);
  if (!a) return;
  if (statSync(fromHome).dev !== statSync(toHome).dev) return conflict('Cross-volume auth moves are not supported.');
  if (existsSync(to)) return conflict('Target credential collision.');
  // The destination is an exclusively created, journal-bound private home. External use is an explicit gate.
  renameSync(from, to);
}
export class CompanyTransfers {
  private readonly d: TransferDeps;
  private readonly challenges = new Set<string>();
  constructor(deps: TransferDeps) { this.d = deps; }
  private verify(company: string, value: unknown): Hello {
    const h = value as Hello;
    const expected = this.d.peer(company);
    if (!h?.runtime || h.runtime.protocol !== HOME_PROTOCOL || h.runtime.company !== company || h.runtime.pid !== expected.pid || typeof h.runtime.boot !== 'string' || !h.runtime.boot || h.runtime.data !== canonicalDirectory(expected.data) || h.runtime.accounts !== canonicalDirectory(path.join(expected.data, 'accounts')) || typeof h.nonce !== 'string') return conflict('Peer runtime lacks the exact live Claude handoff contract/identity. Roll out both runtimes first.');
    return h;
  }
  private async handshake(company: string): Promise<RuntimeIdentity> {
    if (company === this.d.owners.runtime.company) return conflict('Choose another local company.');
    const nonce = randomUUID();
    const h = this.verify(company, await this.d.call(company, { action: 'hello', nonce }));
    if (h.echo !== nonce) return conflict('Peer nonce mismatch.');
    const confirmation = this.verify(company, await this.d.call(company, { action: 'confirm', nonce: h.nonce, source: this.d.owners.runtime, challenge: nonce }));
    if (confirmation.echo !== nonce || confirmation.runtime.boot !== h.runtime.boot) return conflict('Peer changed during handshake.');
    return h.runtime;
  }
  async run(c: TransferCommand): Promise<TransferResult> {
    const owners = this.d.owners;
    if (c.action === 'hello') {
      const nonce = randomUUID(); this.challenges.add(nonce);
      // Bounded: probes never persist readiness and old challenges cannot authorize a mutation.
      if (this.challenges.size > 100) this.challenges.delete(this.challenges.values().next().value!);
      return { runtime: owners.runtime, echo: c.nonce, nonce } satisfies Hello;
    }
    if (c.action === 'confirm') {
      if (!this.challenges.delete(c.nonce)) return conflict('Expired or unknown handshake challenge.');
      const reply = this.verify(c.source.company, await this.d.call(c.source.company, { action: 'hello', nonce: c.challenge }));
      if (reply.echo !== c.challenge || (['protocol', 'company', 'data', 'accounts', 'pid', 'boot'] as const).some(k => reply.runtime[k] !== c.source[k])) return conflict('Source runtime identity mismatch.');
      return { runtime: owners.runtime, echo: c.challenge, nonce: c.nonce } satisfies Hello;
    }
    if (c.action === 'prepare') {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(c.transferId)) return conflict('A unique transfer id is required.');
      const peer = await this.handshake(c.targetCompany); // BEFORE fence, mkdir, account mutation or credential read
      const account = this.d.get(c.accountId);
      if (!account) return conflict('Source account missing.');
      if (!owners.hasTransfer(c.transferId)) {
        if (account.provider !== 'claude' || account.auth !== 'cli' || !account.home || account.detected || account.deviceId) return conflict('Not an isolated local Claude CLI account.');
        canonicalDirectory(account.home);
        validateClaudeCredentialFile(path.join(account.home, '.credentials.json'));
        if (statSync(account.home).dev !== statSync(peer.accounts).dev) return conflict('Cross-volume auth moves are not supported.');
      }
      const operation = owners.acquireOperation(c.transferId);
      try { return owners.prepare(account, { company: c.targetCompany, account: `acc_handoff_${c.transferId}` }, peer, c.transferId); } finally { owners.releaseOperation(c.transferId, operation); }
    }
    let { home, transfer: t, busy } = owners.inspect(c.transferId);
    if (c.action === 'status') return { transfer: t, busy }; // metadata only
    const isSource = owners.runtime.company === t.source.company;
    const peerCompany = isSource ? t.target.company : t.source.company;
    await this.handshake(peerCompany); // every supported mutation proves both CURRENT running runtimes
    ({ home, transfer: t, busy } = owners.inspect(c.transferId));
    const operation = isSource ? owners.acquireOperation(c.transferId) : ('operation' in c ? c.operation : '');
    try {
      if (!isSource) owners.verifyOperation(c.transferId, operation, t.source.company);
      return await this.effect(c, isSource, operation);
    } finally { if (isSource) owners.releaseOperation(c.transferId, operation); }
  }
  private async quiet(): Promise<void> {
    const evidence = await this.d.externalQuiet();
    if (!evidence?.probeId || evidence.runtimeBoot !== this.d.owners.runtime.boot || !Number.isFinite(evidence.at) || Date.now() - evidence.at < 0 || Date.now() - evidence.at > 2000 || evidence.pids.length) return conflict('Fresh runtime-bound external Claude process quiescence is required.');
  }
  private async effect(c: Exclude<TransferCommand, { action: 'hello' | 'confirm' | 'prepare' }>, isSource: boolean, operation: string): Promise<TransferResult> {
    const owners = this.d.owners;
    let { home, transfer: t, busy } = owners.inspect(c.transferId);
    if (['register', 'activate', 'detach'].includes(c.action)) {
      if (isSource) return conflict('Target-only handoff operation.');
      const current = this.d.get(t.target.account);
      const targetHome = path.join(owners.runtime.accounts, 'claude', t.target.account);
      if (c.action === 'register') {
        if (t.phase !== 'sourceDisabled') return conflict('Target registration outside its journal phase.');
        if (current && (current.home !== targetHome || current.provider !== 'claude' || current.auth !== 'cli' || current.enabled)) return conflict('Target account collision.');
        await this.quiet();
        owners.verifyOperation(t.id, operation, t.source.company);
        if (!t.targetHome) {
          mkdirSync(path.dirname(targetHome), { recursive: true, mode: 0o700 });
          if (!t.targetHomeIntent) {
            if (existsSync(targetHome)) return conflict('Target home collision; no existing folder can be imported.');
            owners.targetIntent(t.id, targetHome);
            t = owners.inspect(t.id).transfer;
          }
          // Publish a complete marked directory by rename. A crash while constructing a stage
          // leaves only an unused EMPTY auth-free stage, never an ambiguous final home.
          const marker = path.join(targetHome, '.autark-handoff-owner');
          if (!existsSync(targetHome)) {
            const stage = mkdtempSync(path.join(path.dirname(targetHome), '.handoff-stage-'));
            writeFileSync(path.join(stage, '.autark-handoff-owner'), t.targetHomeNonce!, { flag: 'wx', mode: 0o600 });
            if (existsSync(targetHome)) return conflict('Target home collision during exclusive creation.');
            renameSync(stage, targetHome);
          }
          if (!existsSync(marker) || readFileSync(marker, 'utf8') !== t.targetHomeNonce) return conflict('Interrupted target directory without proven ownership; manual investigation required.');
          owners.bindTarget(t.id, targetHome);
          t = owners.inspect(t.id).transfer;
        }
        if (readdirSync(targetHome).some(f => f !== '.credentials.json' && f !== '.autark-handoff-owner')) return conflict('Target home is not a clean auth-only profile.');
        moveClaudeAuth(home, targetHome);
        // No add/login/check. Only whitelisted ACCOUNT metadata, never source native .claude.json.
        if (current && (current.home !== targetHome || current.provider !== 'claude' || current.auth !== 'cli' || current.enabled)) return conflict('Target account collision.');
        const a = t.snapshot;
        this.d.save({ id: t.target.account, provider: 'claude', auth: 'cli', home: targetHome, label: a.label, priority: a.priority, enabled: false, state: a.state === 'disabled' ? 'unknown' : a.state, createdAt: a.createdAt, detected: false, ...(a.plan ? { plan: a.plan } : {}), ...(a.email ? { email: a.email } : {}) });
      } else if (c.action === 'activate') {
        if (t.phase !== 'committed' && t.phase !== 'active') return conflict('Target not committed.');
        if (!current || current.home !== t.targetHome) return conflict('Target registration missing.');
        this.d.save({ ...current, enabled: true }); // explicit target activation; needs_login remains needs_login, never claim ok
      } else {
        if (t.phase !== 'rollbackDrain' || busy) return conflict('Target needs natural drain before detach.');
        if (current) this.d.save({ ...current, enabled: false });
        await this.quiet();
        owners.verifyOperation(t.id, operation, t.source.company);
        if (t.targetHome) moveClaudeAuth(t.targetHome, home); // latest auth, never a stale snapshot
        if (current) this.d.forget(current.id); // detach only: never recursively remove either home
      }
      return { ok: true };
    }
    if (!isSource) return conflict('Only the source service coordinates handoff.');
    if (c.action === 'rollback') {
      if (t.phase === 'rolledBack') return { transfer: t, busy };
      if (t.phase !== 'rollbackDrain' && t.phase !== 'rollbackDetached') {
        // Fence first even while target is active; existing permits must end NATURALLY.
        t = owners.fenceRollback(t.id);
      }
      if (owners.inspect(t.id).busy) return { transfer: t, busy: owners.inspect(t.id).busy };
      if (t.phase === 'rollbackDrain') {
        await this.d.call(t.target.company, { action: 'detach', transferId: t.id, operation });
        t = owners.transition(t.id, 'rollbackDrain', 'rollbackDetached');
      }
      const source = this.d.get(t.source.account);
      if (!source) return conflict('Source account missing during rollback.');
      this.d.save({ ...source, enabled: t.previousEnabled, state: t.snapshot.state });
      t = owners.transition(t.id, 'rollbackDetached', 'rolledBack', t.source);
      return { transfer: t, busy: 0 };
    }
    if (c.action !== 'advance') return conflict('Unsupported handoff operation.');
    if (busy) return { transfer: t, busy }; // no kill, abort, timeout takeover or lease cleanup
    if (t.phase === 'fenced') {
      const a = this.d.get(t.source.account);
      if (!a) return conflict('Source account missing.');
      this.d.save({ ...a, enabled: false });
      if (this.d.get(a.id)?.enabled !== false) return conflict('Source disable not confirmed.');
      t = owners.transition(t.id, 'fenced', 'sourceDisabled');
    }
    if (t.phase === 'sourceDisabled') {
      await this.d.call(t.target.company, { action: 'register', transferId: t.id, operation });
      t = owners.transition(t.id, 'sourceDisabled', 'targetPending');
    }
    if (t.phase === 'targetPending') t = owners.transition(t.id, 'targetPending', 'committed', t.target);
    if (t.phase === 'committed') {
      await this.d.call(t.target.company, { action: 'activate', transferId: t.id, operation });
      t = owners.transition(t.id, 'committed', 'active');
    }
    return { transfer: t, busy: 0 };
  }
}
