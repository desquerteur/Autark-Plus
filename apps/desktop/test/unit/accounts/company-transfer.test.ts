// Strictly synthetic auth fixtures, isolated temp companies and real Node stand-in processes.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, linkSync, symlinkSync, renameSync } from 'node:fs';
import { probeClaudeQuiescence } from '../../../src/runtime/accounts/claude-quiescence.ts';
import { fakeSpawn, testSupervisor } from '../engines/fakes.ts';
import { HomeOwners } from '../../../src/runtime/accounts/home-owner.ts';
import { moveClaudeAuth, validateClaudeCredentialFile } from '../../../src/runtime/accounts/company-transfer.ts';
import type { TransferCommand, TransferResult } from '../../../src/shared/model/account-transfer.ts';
import { Supervisor } from '../../../src/runtime/system/supervisor.ts';
import { HandlerTable, allowedScope } from '../../../src/runtime/rpc/table.ts';
import { register } from '../../../src/runtime/rpc/handlers/providers.ts';
import type { HandlerContext } from '../../../src/runtime/rpc/table.ts';
import { LoginSync } from '../../../src/runtime/devices/sync/logins.ts';
import { DevicesRepo } from '../../../src/runtime/devices/repo.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { harness, row } from './harness.ts';

const auth = (refresh = 'SYNTHETIC-NOT-A-REAL-TOKEN') => JSON.stringify({ claudeAiOauth: { accessToken: 'SYNTHETIC-ACCESS', refreshToken: refresh, expiresAt: 9999999999999, scopes: ['user:inference'], subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' } });
const pause = (ms = 20) => new Promise(r => setTimeout(r, ms));
function pair(t: TestContext, enabled = true) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'autark-handoff-test-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(root, { recursive: true, force: true }); });
  const data = [path.join(root, 'source'), path.join(root, 'target')];
  for (const d of data) mkdirSync(path.join(d, 'accounts'), { recursive: true });
  const registry = path.join(root, 'machine');
  const owners = data.map((d, i) => new HomeOwners(registry, { company: i ? 'target' : 'source', data: d, accounts: path.join(d, 'accounts') }));
  const hs = owners.map((o, i) => harness({ accounts: path.join(data[i], 'accounts'), homeOwners: o }));
  const home = path.join(data[0], 'accounts', 'claude', 'acc_source'); mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, '.credentials.json'), auth());
  writeFileSync(path.join(home, '.claude.json'), '{"MUST_NOT_IMPORT":"native-identity-project-trust"}');
  for (const dir of ['skills', 'plugins', 'projects']) { mkdirSync(path.join(home, dir)); writeFileSync(path.join(home, dir, 'old-private-instructions.txt'), 'MUST NOT IMPORT'); }
  hs[0].repo.save(row('acc_source', { provider: 'claude', auth: 'cli', home, enabled, state: 'needs_login' }));
  const tables = hs.map(() => { const table = new HandlerTable(); register(table); return table; });
  const invoke = async (i: number, command: TransferCommand): Promise<TransferResult> => {
    const entry = tables[i].get('accounts.transfer')!;
    assert.equal(allowedScope(entry.scope, { kind: 'owner' }), true);
    // Actual RPC handler reconstruction + JSON wire ordering, not service-only direct calls.
    return await entry.handler(JSON.parse(JSON.stringify(command)), { scope: { kind: 'owner' }, services: { accounts: hs[i].service }, topics: new Set(), signal: new AbortController().signal } as unknown as HandlerContext) as TransferResult;
  };
  let inject: ((company: string, command: TransferCommand, result: TransferResult) => TransferResult) | undefined;
  let quiet = true;
  let override: Record<string, unknown> = {};
  let quietWait = Promise.resolve();
  hs.forEach((h, i) => h.service.configureTransfers({
    peer: company => { const j = company === 'source' ? 0 : company === 'target' ? 1 : -1; if (j < 0) throw new Error('not local'); return { data: data[j], pid: process.pid }; },
    call: async (company, command) => { const result = await invoke(company === 'source' ? 0 : 1, command); return inject?.(company, command, result) ?? result; },
    externalQuiet: async () => { await quietWait; return { probeId: 'synthetic-process-probe', at: Date.now(), runtimeBoot: owners[i].runtime.boot, pids: quiet ? [] : [123456], ...override } as import('../../../src/runtime/accounts/claude-quiescence.ts').ProcessQuiescence; },
  }));
  const prepare = () => invoke(0, { action: 'prepare', accountId: 'acc_source', targetCompany: 'target', transferId: 'test1' });
  const advance = () => invoke(0, { action: 'advance', transferId: 'test1' });
  const rollback = () => invoke(0, { action: 'rollback', transferId: 'test1' });
  const state = () => owners[0].inspect('test1');
  const target = () => hs[1].service.get('acc_handoff_test1')!;
  return { root, data, owners, hs, home, registry, tables, invoke, prepare, advance, rollback, state, target, intercept: (f: typeof inject) => { inject = f; }, setQuiet: (q: boolean) => { quiet = q; }, setEvidence: (value: Record<string, unknown>) => { override = value; }, delayQuiet: () => { let resume!: () => void; quietWait = new Promise<void>(r => { resume = r; }); return resume; } };
}

test('RPC two-way key-order-independent handshake; disabled source becomes enabled target only AFTER commit; needs_login is not ok; auth MOVE only', async t => {
  const p = pair(t, false);
  await p.prepare();
  assert.equal(p.state().transfer.phase, 'fenced'); assert.equal(p.target(), undefined);
  const seen: Array<[string, boolean | undefined]> = [];
  p.hs[1].bus.on('account.upserted', a => { if (a.id === 'acc_handoff_test1') seen.push([p.state().transfer.phase, a.enabled]); });
  await p.advance();
  assert.deepEqual(seen, [['sourceDisabled', false], ['committed', true]]);
  assert.equal(p.state().transfer.phase, 'active');
  assert.equal(p.target().state, 'needs_login'); assert.equal(p.target().enabled, true);
  assert.notEqual(p.target().home, p.home);
  assert.equal(existsSync(path.join(p.home, '.credentials.json')), false);
  assert.equal(readFileSync(path.join(p.target().home!, '.credentials.json'), 'utf8'), auth());
  assert.deepEqual(readdirSync(p.target().home!).sort(), ['.autark-handoff-owner', '.credentials.json']);
  assert.equal(existsSync(path.join(p.home, '.claude.json')), true);
  assert.equal(p.owners[0].allowed(p.hs[0].service.get('acc_source')!), false);
  assert.equal(p.owners[1].allowed(p.target()), true);
  await p.rollback();
  assert.equal(p.hs[0].service.get('acc_source')!.enabled, false, 'rollback restores original disabled flag');
});

test('old/missing/protocol/PID/boot/path/nonce-mismatched runtime rejected BEFORE fence, account or credential mutation', async t => {
  for (const change of ['missing', 'protocol', 'pid', 'data', 'nonce', 'boot']) {
    const p = pair(t);
    p.intercept((company, c, result) => {
      if (company !== 'target' || (c.action !== 'hello' && !(change === 'boot' && c.action === 'confirm'))) return result;
      if (change === 'missing') return {} as TransferResult;
      const h = structuredClone(result) as any;
      if (change === 'protocol') h.runtime.protocol = 0;
      if (change === 'pid') h.runtime.pid += 1;
      if (change === 'data') h.runtime.data = p.data[0];
      if (change === 'nonce') h.echo = 'wrong';
      if (change === 'boot' && c.action === 'confirm') h.runtime.boot = 'other-boot';
      return h;
    });
    await assert.rejects(p.prepare());
    assert.throws(p.state, /Unknown/);
    assert.equal(p.hs[0].service.get('acc_source')!.enabled, true);
    assert.equal(readFileSync(path.join(p.home, '.credentials.json'), 'utf8'), auth());
  }
});

test('canonical source rejects API/remote/default/alias/junction; credentials reject unknown schema and hard links without token excerpts', async t => {
  for (const patch of [{ auth: 'api_key' }, { deviceId: 'remote' }, { detected: true }, { home: path.join(os.homedir(), '.claude') }]) {
    const p = pair(t); p.hs[0].repo.save({ ...p.hs[0].service.get('acc_source')!, ...patch } as any);
    await assert.rejects(p.prepare());
    assert.equal(p.hs[0].service.get('acc_source')!.enabled, true);
  }
  const p = pair(t); const file = path.join(p.home, '.credentials.json');
  writeFileSync(file, '{"secret-DO-NOT-LOG": "x"}');
  await assert.rejects(p.prepare(), error => !String(error).includes('secret-DO-NOT-LOG'));
  writeFileSync(file, auth()); linkSync(file, path.join(p.root, 'foreign-auth-hardlink'));
  assert.throws(() => validateClaudeCredentialFile(file), /Unsupported/);
  const q = pair(t); const alias = path.join(q.root, 'junction');
  symlinkSync(q.home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => q.owners[0].admit(alias, 'alias'), /Alias/);
});

test('real child processes: pending grace/idle cannot kill admitted source; two supervisors fence home, natural close unlocks transfer', async t => {
  const p = pair(t);
  let kills = 0;
  const s = new Supervisor({ killTree: async () => { kills++; } }); s.setHomeOwners(p.owners[0]);
  const other = new Supervisor(); other.setHomeOwners(p.owners[1]);
  const run = s.spawn({ command: process.execPath, args: ['-e', 'setTimeout(()=>process.exit(0),350)'], owner: 'synthetic-real-child', env: { ...process.env, CLAUDE_CONFIG_DIR: p.home }, idleMs: 100 });
  const closed = new Promise(r => run.child.once('close', r));
  const retired = run.releaseAfter(100);
  await p.prepare();
  assert.throws(() => s.spawn({ command: process.execPath, args: [], owner: 'new-source', env: { CLAUDE_CONFIG_DIR: p.home } }), /fenced/);
  assert.throws(() => other.spawn({ command: process.execPath, args: [], owner: 'foreign-target', env: { CLAUDE_CONFIG_DIR: p.home } }), /fenced/);
  await p.advance(); assert.equal(p.state().transfer.phase, 'fenced');
  await pause(180); assert.equal(run.child.exitCode, null); assert.equal(kills, 0);
  await retired; await closed;
  await p.advance(); assert.equal(p.state().transfer.phase, 'active'); assert.equal(kills, 0);
});

test('direct check/login/logout/loginCode/reenable/remove and arbitrary target actions fenced; admitted async write drains, rollback drains latest auth', async t => {
  const p = pair(t);
  let finish!: () => void;
  const pending = p.hs[0].service.withHome(p.hs[0].service.get('acc_source')!, 'async-native-writer', () => new Promise<void>(r => { finish = r; }));
  await p.prepare(); await p.advance(); assert.equal(p.state().busy, 1);
  const source = p.hs[0].service;
  await assert.rejects(source.check('acc_source')); await assert.rejects(source.login('acc_source'));
  await assert.rejects(source.logout('acc_source')); await assert.rejects(source.loginCode('acc_source', 'FAKE'));
  await assert.rejects(source.remove('acc_source')); assert.throws(() => source.update('acc_source', { enabled: true }));
  await assert.rejects(p.invoke(1, { action: 'register', transferId: 'test1', operation: 'forged' }));
  finish(); await pending; await p.advance();
  const target = p.target();
  writeFileSync(path.join(target.home!, '.credentials.json'), auth('LATEST-SYNTHETIC-ROTATION'));
  const lease = p.owners[1].admit(target.home!, 'target-turn', target.id);
  await p.rollback(); assert.equal(p.state().transfer.phase, 'rollbackDrain');
  assert.equal(p.hs[0].service.homeAllowed(p.hs[0].service.get('acc_source')!), false);
  assert.throws(() => p.owners[1].admit(target.home!, 'new-target'));
  lease.release(); await p.rollback();
  assert.equal(p.state().transfer.phase, 'rolledBack'); assert.equal(p.target(), undefined);
  assert.equal(readFileSync(path.join(p.home, '.credentials.json'), 'utf8'), auth('LATEST-SYNTHETIC-ROTATION'));
  assert.equal(existsSync(target.home!), true, 'detach preserves target history/private home');
});

test('crash AFTER actual MOVE BEFORE target registration: retry registers once, no double move, preactivation abort restores unique current file', async t => {
  const p = pair(t);
  const original = p.hs[1].db.run.bind(p.hs[1].db);
  let crash = true;
  p.hs[1].db.run = ((sql: string, params?: any) => { if (crash && sql.startsWith('INSERT INTO accounts')) { crash = false; throw new Error('synthetic DB crash BEFORE registration'); } return original(sql, params); }) as typeof p.hs[1]['db']['run'];
  await p.prepare(); await assert.rejects(p.advance(), /synthetic DB crash/);
  const state = p.state(); assert.equal(state.transfer.phase, 'sourceDisabled');
  assert.equal(existsSync(path.join(p.home, '.credentials.json')), false);
  assert.equal(existsSync(path.join(state.transfer.targetHome!, '.credentials.json')), true);
  assert.equal(p.target(), undefined);
  assert.throws(() => p.owners[1].admit(state.transfer.targetHome!, 'before-registration'));
  await p.advance(); await p.advance(); assert.equal(p.hs[1].service.list().length, 1);
  await p.rollback(); assert.equal(existsSync(path.join(p.home, '.credentials.json')), true);
  const q = pair(t); await q.prepare(); await q.rollback(); assert.equal(q.state().transfer.phase, 'rolledBack');
});

test('ambiguous auth, destination collisions, corrupt/lost registry and orphan reservations fail closed; no TTL steal', async t => {
  const p = pair(t); await p.prepare();
  const permit = p.owners[0];
  const before = p.state().transfer;
  // A reservation from the source runtime remains, even another boot on same company cannot steal it.
  const q = pair(t); const held = q.owners[0].admit(q.home, 'orphan'); await q.prepare();
  const restarted = new HomeOwners(q.registry, { company: 'source', data: q.data[0], accounts: path.join(q.data[0], 'accounts') });
  assert.equal(restarted.inspect('test1').busy, 1); await q.advance(); assert.equal(q.state().transfer.phase, 'fenced'); held.release();
  rmSync(path.join(p.registry, 'owners.json')); assert.throws(() => permit.admit(p.home, 'lost'), /missing/);
  assert.equal(p.hs[0].service.homeAllowed(p.hs[0].service.get('acc_source')!), false);
  const r = pair(t); const collision = path.join(r.data[1], 'accounts', 'claude', 'acc_handoff_test1'); mkdirSync(collision, { recursive: true });
  writeFileSync(path.join(collision, '.credentials.json'), auth('FOREIGN'));
  await r.prepare(); await assert.rejects(r.advance(), /collision/); assert.equal(readFileSync(path.join(r.home, '.credentials.json'), 'utf8'), auth());
  assert.throws(() => moveClaudeAuth(r.home, collision), /both or neither/);
  assert.equal(before.phase, 'fenced');
});

test('fresh runtime-bound Windows operating evidence gate rejects unknown/stale/active external CLI without moving auth; operation races serialized', async t => {
  const p = pair(t); p.setQuiet(false); await p.prepare();
  await assert.rejects(p.advance(), /quiescence/); assert.equal(existsSync(path.join(p.home, '.credentials.json')), true);
  const token = p.owners[0].acquireOperation('test1');
  await assert.rejects(p.advance(), /Another handoff action/); await assert.rejects(p.rollback(), /Another handoff action/);
  p.owners[0].releaseOperation('test1', token); p.setQuiet(true); await p.advance();
});

test('mesh before fence writes synthetic auth; queued writes/send/watch/reconnect blocked after fence and target activation; in-flight mesh admission drains', async t => {
  const p = pair(t);
  const repo = new DevicesRepo(p.hs[0].db);
  repo.upsert({ id: 'peer', name: 'peer', kind: 'pc', role: 'home', fingerprint: 'fake-fingerprint', addresses: [], caps: {}, status: 'online', self: false, joinedAs: 'ceo' });
  let sent = 0;
  const s = { db: p.hs[0].db, bus: p.hs[0].bus, log: { info() {}, warn() {} }, accounts: p.hs[0].service, devices: { online: () => true, call: async () => { sent++; } } } as unknown as RuntimeServices;
  const sync = new LoginSync(s, { platform: 'win32', env: {}, homeDir: path.join(p.root, 'no-default') });
  const login = { account: 'acc_source', provider: 'claude', at: 99999999999999, files: [{ name: '.credentials.json', data: Buffer.from(auth('NEW-SYNTHETIC-MESH')).toString('base64') }] };
  assert.equal((await sync.receive({ logins: [login] }, 'peer')).applied, 1);
  await p.prepare(); assert.equal((await sync.receive({ logins: [{ ...login, at: login.at + 1 }] }, 'peer')).applied, 0);
  await sync.catchUp('peer'); assert.equal(sent, 0);
  await p.advance(); assert.equal((await sync.receive({ logins: [login] }, 'peer')).applied, 0);
  assert.equal(p.hs[1].service.homeSyncAllowed(p.target()), false, 'single owner never reexports a transferred refresh identity');
  assert.equal(p.hs[0].service.homeSyncAllowed(p.hs[0].service.get('acc_source')!), false);
  assert.equal(allowedScope(p.tables[0].get('accounts.transfer')!.scope, { kind: 'device', deviceId: 'phone', capabilities: ['settings'], secure: true } as any), false);
});


test('TWO real company runtime processes over authenticated HTTP handlers perform nonce handshake, MOVE/register/activate and rollback; wrong owner token rejected', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'autark-handoff-http-'));
  for (const company of ['source', 'target']) mkdirSync(path.join(root, company, 'accounts'), { recursive: true });
  const home = path.join(root, 'source', 'accounts', 'claude', 'acc_source'); mkdirSync(home, { recursive: true }); writeFileSync(path.join(home, '.credentials.json'), auth());
  const children: ReturnType<typeof fork>[] = [];
  const peers: Record<string, { port: number; pid: number }> = {};
  const message = (child: ReturnType<typeof fork>) => new Promise<any>((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('fixture runtime exited before reply'))); });
  t.after(async () => {
    await Promise.all(children.map(child => new Promise<void>(r => { if (child.exitCode !== null) { r(); return; } child.once('exit', () => r()); child.send({ stop: true }); })));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(root, { recursive: true, force: true });
  });
  for (const company of ['source', 'target']) {
    const child = fork(fileURLToPath(new URL('./company-transfer-worker.ts', import.meta.url)), [root, company], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }); children.push(child); peers[company] = await message(child);
  }
  for (const child of children) { const ready = message(child); child.send({ peers }); await ready; }
  const rpc = (company: string, command: TransferCommand, token = `synthetic-${company}`) => new Promise<any>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: peers[company].port, path: '/rpc', method: 'POST', headers: { Authorization: `Bearer ${token}` } }, res => {
      let text = ''; res.on('data', c => { text += String(c); }); res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`)); const reply = JSON.parse(text); reply.error ? reject(new Error(reply.error)) : resolve(reply.result); });
    }); req.on('error', reject); req.end(JSON.stringify({ method: 'accounts.transfer', params: command }));
  });
  await assert.rejects(rpc('source', { action: 'status', transferId: 'http1' }, 'wrong-owner-token'), /401/);
  await rpc('source', { action: 'prepare', transferId: 'http1', accountId: 'acc_source', targetCompany: 'target' });
  assert.notEqual(peers.source.pid, peers.target.pid);
  assert.equal((await rpc('source', { action: 'advance', transferId: 'http1' })).transfer.phase, 'active');
  assert.equal(existsSync(path.join(home, '.credentials.json')), false);
  assert.equal((await rpc('source', { action: 'rollback', transferId: 'http1' })).transfer.phase, 'rolledBack');
  assert.equal(readFileSync(path.join(home, '.credentials.json'), 'utf8'), auth());
});

test('actual pending mesh apply/send lease blocks drain; queued second write and watch/reconnect after fence do not write or export', async t => {
  const p = pair(t);
  new DevicesRepo(p.hs[0].db).upsert({ id: 'peer', name: 'peer', kind: 'pc', role: 'home', fingerprint: 'fake', addresses: [], caps: {}, status: 'online', self: false, joinedAs: 'ceo' });
  let sent = 0;
  const s = { db: p.hs[0].db, bus: p.hs[0].bus, log: { info() {}, warn() {} }, accounts: p.hs[0].service, devices: { online: () => true, call: async () => { sent++; } } } as unknown as RuntimeServices;
  const sync = new LoginSync(s, { platform: 'win32', env: {}, homeDir: path.join(p.root, 'no-default') });
  const off = sync.attach(); t.after(off);
  const impl = sync as unknown as { writeWhole(file: string, bytes: Buffer): Promise<void> };
  const original = impl.writeWhole.bind(impl);
  let finish!: () => void, started!: () => void;
  const entered = new Promise<void>(r => { started = r; });
  const pending = new Promise<void>(r => { finish = r; });
  let writes = 0;
  impl.writeWhole = async (file, bytes) => { writes++; started(); await pending; await original(file, bytes); };
  const login = (at: number) => ({ account: 'acc_source', provider: 'claude', at, files: [{ name: '.credentials.json', data: Buffer.from(auth('PENDING-SYNTHETIC-MESH')).toString('base64') }] });
  const first = sync.receive({ logins: [login(99999999999999)] }, 'peer'); await entered;
  const queued = sync.receive({ logins: [login(999999999999999)] }, 'peer');
  await p.prepare(); await p.advance(); assert.equal(p.state().transfer.phase, 'fenced'); assert.ok(p.state().busy > 0);
  finish(); await first; await queued; await pause(650);
  assert.equal(writes, 1); assert.equal(sent, 0); assert.equal(p.state().busy, 0);
  await sync.catchUp('peer'); assert.equal(sent, 0);
  await p.advance(); assert.equal(p.state().transfer.phase, 'active');
});


test('phase crash/retry matrix and marked-directory crash BEFORE bind recover idempotently; rollback after each partial forward phase', async t => {
  for (const phase of ['sourceDisabled', 'targetPending', 'committed', 'active'] as const) {
    const p = pair(t); await p.prepare();
    const original = p.owners[0].transition.bind(p.owners[0]); let crash = true;
    p.owners[0].transition = (...args: Parameters<typeof original>) => { const result = original(...args); if (crash && args[2] === phase) { crash = false; throw new Error('synthetic journal phase crash'); } return result; };
    await assert.rejects(p.advance(), /synthetic journal phase crash/);
    assert.equal(p.state().transfer.phase, phase);
    await p.advance(); assert.equal(p.state().transfer.phase, 'active');
    await p.rollback(); assert.equal(p.state().transfer.phase, 'rolledBack');
    assert.equal(readFileSync(path.join(p.home, '.credentials.json'), 'utf8'), auth());
  }
  const p = pair(t); await p.prepare();
  const bind = p.owners[1].bindTarget.bind(p.owners[1]); let crash = true;
  p.owners[1].bindTarget = (...args: Parameters<typeof bind>) => { if (crash) { crash = false; throw new Error('synthetic crash after complete mkdir BEFORE binding'); } return bind(...args); };
  await assert.rejects(p.advance(), /BEFORE binding/); assert.equal(p.state().transfer.targetHome, undefined);
  await p.advance(); assert.equal(p.state().transfer.phase, 'active');
  const q = pair(t); await q.prepare();
  const transition = q.owners[0].transition.bind(q.owners[0]); let fail = true;
  q.owners[0].transition = (...args: Parameters<typeof transition>) => { const result = transition(...args); if (fail && args[2] === 'rollbackDetached') { fail = false; throw new Error('synthetic rollback crash'); } return result; };
  await assert.rejects(q.rollback(), /synthetic rollback crash/); await q.rollback();
  assert.equal(q.state().transfer.phase, 'rolledBack');
});

test('actual concurrent advance/rollback while target awaits OS evidence cannot overlap a MOVE; moved registry detected independently on restart', async t => {
  const p = pair(t); await p.prepare(); const resume = p.delayQuiet();
  const advancing = p.advance();
  for (let i = 0; i < 100 && p.state().transfer.phase !== 'sourceDisabled'; i++) await pause();
  await assert.rejects(p.rollback(), /Another handoff action/);
  assert.equal(existsSync(path.join(p.home, '.credentials.json')), true);
  resume(); await advancing; assert.equal(p.state().transfer.phase, 'active');
  const moved = path.join(p.root, 'moved-machine'); renameSync(p.registry, moved);
  assert.throws(() => new HomeOwners(p.registry, { company: 'source', data: p.data[0], accounts: path.join(p.data[0], 'accounts') }), /lost or moved/);
});


test('destructive remove linearization: paused cancel AND paused recursive delete reject prepare BEFORE fence; accepted delete completes without killing/losing a handoff home', async t => {
  for (const pauseAt of ['cancel', 'rmdir']) {
    const p = pair(t);
    const impl = p.hs[0].service as unknown as { signIns: { cancel(id: string): Promise<void> }; homes: { deps: { rmdir(dir: string): Promise<void> } } };
    let resume!: () => void, entered!: () => void;
    const paused = new Promise<void>(r => { resume = r; }); const began = new Promise<void>(r => { entered = r; });
    impl.signIns.cancel = async () => { if (pauseAt === 'cancel') { entered(); await paused; } };
    impl.homes.deps.rmdir = async dir => { if (pauseAt === 'rmdir') { entered(); await paused; } assert.ok(path.resolve(dir).startsWith(path.resolve(p.root) + path.sep)); rmSync(dir, { recursive: true, force: true }); };
    const removing = p.hs[0].service.remove('acc_source'); await began;
    await assert.rejects(p.prepare(), /destructive/);
    assert.throws(p.state, /Unknown/); assert.equal(existsSync(path.join(p.home, '.credentials.json')), true);
    resume(); await removing;
    assert.equal(p.hs[0].service.get('acc_source'), undefined); assert.equal(existsSync(p.home), false);
  }
  for (const kind of ['logout', 'login', 'login-code', 'purge', 'session-delete', 'process:claude-purge:acc_source']) {
    const p = pair(t); const lease = p.owners[0].admit(p.home, kind, 'acc_source');
    await assert.rejects(p.prepare(), /destructive/); lease.release(); await p.prepare();
  }
});


test('freshness gate rejects stale/wrong-boot/unknown evidence; Windows probe metadata parser rejects unknown/nonzero/malformed/timeout and never quotes raw output', async t => {
  for (const evidence of [{ at: Date.now() - 60_000 }, { runtimeBoot: 'wrong-boot' }, { probeId: '' }, { at: NaN }]) {
    const p = pair(t); p.setEvidence(evidence); await p.prepare(); await assert.rejects(p.advance(), /quiescence/);
    assert.equal(existsSync(path.join(p.home, '.credentials.json')), true);
  }
  for (const [output, code] of [['{"known":false,"pids":[]}', 0], ['{"known":true,"pids":[42]}', 0], ['SYNTHETIC-SECRET-NOT-FOR-ERROR{', 0], ['{"known":true,"pids":[]}', 1]] as const) {
    const fake = fakeSpawn(call => { setImmediate(() => { call.child.stdout.write(output); call.child.exit(code); }); });
    await assert.rejects(probeClaudeQuiescence(testSupervisor(fake.spawn), 'test-boot', { platform: 'win32' }), error => !String(error).includes('SYNTHETIC-SECRET'));
  }
  const fake = fakeSpawn();
  await assert.rejects(probeClaudeQuiescence(testSupervisor(fake.spawn), 'test-boot', { platform: 'win32', timeoutMs: 30 }), /did not answer/);
  fake.calls[0].child.exit();
  const valid = fakeSpawn(call => { setImmediate(() => { call.child.stdout.write('{"known":true,"pids":[]}'); call.child.exit(); }); });
  assert.equal((await probeClaudeQuiescence(testSupervisor(valid.spawn), 'test-boot', { platform: 'win32' })).runtimeBoot, 'test-boot');
  await assert.rejects(probeClaudeQuiescence(testSupervisor(valid.spawn), 'test-boot', { platform: 'linux' }), /only on Windows/);
});
