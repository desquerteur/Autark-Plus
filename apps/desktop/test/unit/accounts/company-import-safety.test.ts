// Characterization of the current lifecycle, NOT a company-import implementation or safety guarantee.
// A bare Account.home alias would expose these gaps. When an import lifecycle is implemented, replace
// the gap assertions with its rejection/coordination guarantees. Everything below is synthetic:
// Legacy/no-ownership fixture characterization only. Production handoff guarantees are enforced by company-transfer.test.ts.
// fake children, memory-only engine files, in-memory databases and injected deletion spies.
// The mesh test writes only a made-up credential fixture under a fresh temp directory.
// No CLI binary, real credential, network or real company data is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Account } from '../../../src/shared/model/providers.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { Executable } from '../../../src/runtime/accounts/executables.ts';
import { claudeLogin } from '../../../src/runtime/accounts/cli.ts';
import { signedOut } from '../../../src/runtime/accounts/cli-homes.ts';
import { selectCandidates } from '../../../src/runtime/accounts/candidates.ts';
import { AccountMonitor } from '../../../src/runtime/accounts/monitor.ts';
import { DevicesRepo } from '../../../src/runtime/devices/repo.ts';
import { LoginSync } from '../../../src/runtime/devices/sync/logins.ts';
import { ClaudeStatus } from '../../../src/runtime/engines/claude/status.ts';
import { ClaudeEngine } from '../../../src/runtime/engines/claude/engine.ts';
import { fakeFinder, fakeSpawn, memoryFiles, testSupervisor, tick, turnInput } from '../engines/fakes.ts';
import { harness, row } from './harness.ts';
import { recordingBus, ManualClock, silentLog } from '../devices/fakes.ts';

const ROOT = path.join(os.tmpdir(), 'autark-synthetic-company-import-no-disk');
const OLD_ACCOUNTS = path.join(ROOT, 'old', 'accounts');
const NEW_ACCOUNTS = path.join(ROOT, 'new', 'accounts');
const HOME = path.join(OLD_ACCOUNTS, 'claude', 'acc_source');
const EXE: Executable = { command: 'synthetic-claude-not-executed', prefixArgs: [], path: 'synthetic-claude-not-executed' };
const plan = (id = 'acc_source'): Account => row(id, { provider: 'claude', auth: 'cli', home: HOME });

function checks() {
  const fake = fakeSpawn();
  const supervisor = testSupervisor(fake.spawn);
  const status = new ClaudeStatus({ supervisor, tempDir: ROOT, env: {}, timeoutMs: 1000, graceMs: 1000 });
  return { ...fake, supervisor, status };
}

test('company-import boundary: the existing group queues equal account ids within ONE supervisor until child exit', async () => {
  const h = checks();
  const input = { command: EXE.command, args: [], owner: 'synthetic', group: claudeLogin('acc_source'), env: { CLAUDE_CONFIG_DIR: HOME } };
  const first = await h.supervisor.spawnAlone(input);
  let acquired = false;
  const next = h.supervisor.spawnAlone(input).then((lease) => { acquired = true; return lease; });
  await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(acquired, false);
  h.calls[0].child.exit();
  const second = await next;
  assert.equal(h.calls.length, 2);
  assert.notEqual(first.id, second.id);
  h.calls[1].child.exit();
});

test('unconfigured legacy fixture (NOT production handoff): equal id AND home can overlap across two company supervisors', async () => {
  const old = checks();
  const target = checks();
  const readings = [old.status.read(EXE, plan()), target.status.read(EXE, plan())];
  await tick();
  assert.equal(old.calls.length, 1);
  assert.equal(target.calls.length, 1);
  assert.equal(old.calls[0].options.env?.CLAUDE_CONFIG_DIR, target.calls[0].options.env?.CLAUDE_CONFIG_DIR);
  assert.equal(old.calls[0].child.exitCode, null);
  assert.equal(target.calls[0].child.exitCode, null, 'the second runtime did not wait for the first');
  old.calls[0].child.exit();
  target.calls[0].child.exit();
  await Promise.all(readings);
});

test('unconfigured legacy fixture (NOT production handoff): different account ids aliasing one home also overlap inside one supervisor', async () => {
  const h = checks();
  const readings = [h.status.read(EXE, plan()), h.status.read(EXE, plan('acc_alias'))];
  await tick();
  assert.equal(h.calls.length, 2, 'the group key is account id, not canonical home identity');
  assert.ok(h.calls.every((call) => call.options.env?.CLAUDE_CONFIG_DIR === HOME && call.child.exitCode === null));
  h.calls.forEach((call) => call.child.exit());
  await Promise.all(readings);
});

test('unconfigured legacy fixture (NOT production handoff): a turn is not held by a check of the SAME account and home', async () => {
  const h = checks();
  const reading = h.status.read(EXE, plan());
  await tick();
  const engine = new ClaudeEngine({ supervisor: h.supervisor, finder: fakeFinder({ claude: EXE.command }), tempDir: ROOT, env: {}, files: memoryFiles().files, graceMs: 1000 });
  const running = engine.run(turnInput({ account: plan(), model: 'synthetic-model', cwd: ROOT, tools: [] }).input);
  await tick();
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1].args.includes('-p'));
  assert.ok(h.calls.every((call) => call.options.env?.CLAUDE_CONFIG_DIR === HOME && call.child.exitCode === null));
  h.calls[1].child.send({ type: 'result', subtype: 'success', is_error: false, result: 'synthetic', session_id: 'synthetic-session' });
  h.calls.forEach((call) => call.child.exit());
  await Promise.all([reading, running]);
  await engine.dispose();
});

test('unconfigured legacy fixture (NOT production handoff): logout targets a shared home without coordination or state propagation to the source company', async () => {
  const old = harness({ accounts: OLD_ACCOUNTS, env: {} });
  const target = harness({ accounts: NEW_ACCOUNTS, env: {} });
  try {
    old.repo.save(plan());
    target.repo.save(plan('acc_alias'));
    await target.service.logout('acc_alias');
    const logout = target.calls.find((call) => call.args.join(' ') === 'auth logout');
    assert.ok(logout);
    assert.equal(logout.options.env?.CLAUDE_CONFIG_DIR, HOME, 'a bare alias logs out the source home too');
    assert.equal(target.service.get('acc_alias')?.state, 'needs_login');
    assert.equal(old.service.get('acc_source')?.state, 'ok', 'source metadata is not invalidated');
    assert.equal(signedOut.has(target.db, 'acc_alias'), true);
    assert.equal(signedOut.has(old.db, 'acc_source'), false, 'sign-out intent is company-db/account-id local');
  } finally {
    await Promise.all([old.service.dispose(), target.service.dispose()]);
    old.db.close(); target.db.close();
  }
});

test('company-import boundary: deleting a foreign-home alias leaves the home, but deleting its owner ignores the foreign reference', async () => {
  const old = harness({ accounts: OLD_ACCOUNTS, env: {} });
  const target = harness({ accounts: NEW_ACCOUNTS, env: {} });
  try {
    old.repo.save(plan());
    target.repo.save(plan('acc_alias'));
    await target.service.remove('acc_alias');
    assert.deepEqual(target.removed, [], 'the current exact-owned-home deletion guard protects foreign paths');
    target.repo.save(plan('acc_alias')); // only a synthetic row: stand in for the proposed bare home alias
    await old.service.remove('acc_source');
    assert.deepEqual(old.removed, [HOME], 'injected deletion spy: owner would remove the still-referenced home');
    assert.equal(target.service.get('acc_alias')?.home, HOME);
    assert.equal(target.service.get('acc_alias')?.state, 'ok', 'no reference count or source-removal notification');
  } finally {
    await Promise.all([old.service.dispose(), target.service.dispose()]);
    old.db.close(); target.db.close();
  }
});

test('unconfigured legacy fixture (NOT production handoff): even matching account ids do not share sign-out intent across company databases', async () => {
  const old = harness({ accounts: OLD_ACCOUNTS, env: {} });
  const target = harness({ accounts: NEW_ACCOUNTS, env: {} });
  try {
    signedOut.mark(old.db, 'acc_source', 1);
    assert.equal(signedOut.has(old.db, 'acc_source'), true);
    assert.equal(signedOut.has(target.db, 'acc_source'), false);
  } finally {
    await Promise.all([old.service.dispose(), target.service.dispose()]);
    old.db.close(); target.db.close();
  }
});

test('exclusive-takeover boundary: disabling excludes normal routing and monitor checks but does not fence direct checks or login', async () => {
  const h = harness({ accounts: OLD_ACCOUNTS, env: {} });
  try {
    h.repo.save(plan());
    const disabled = h.service.update('acc_source', { enabled: false });
    assert.deepEqual(selectCandidates([disabled], 'claude', 1), []);
    await h.service.checkNow('acc_source');
    assert.deepEqual(h.checks, [], 'monitor checks skip disabled rows');
    await h.service.check('acc_source');
    assert.deepEqual(h.checks, ['acc_source'], 'the engine check still runs on a direct call');
    assert.equal(h.service.get('acc_source')?.state, 'disabled', 'only the stored result is kept disabled');
    await h.service.login('acc_source');
    assert.equal(h.signIns.length, 1, 'disabled is not a credential-mutation fence');
    assert.equal(h.signIns[0].options.env?.CLAUDE_CONFIG_DIR, HOME);
    h.signIns[0].child.exit();
    await h.settle();
  } finally { await h.service.dispose(); h.db.close(); }
});

test('exclusive-takeover gap: disable does not abort or drain a turn already using the home', async () => {
  const h = harness({ accounts: OLD_ACCOUNTS, env: {} });
  const cli = fakeSpawn();
  const supervisor = testSupervisor(cli.spawn);
  const engine = new ClaudeEngine({ supervisor, finder: fakeFinder({ claude: EXE.command }), tempDir: ROOT, env: {}, files: memoryFiles().files, graceMs: 1000 });
  try {
    h.repo.save(plan());
    const running = engine.run(turnInput({ account: plan(), model: 'synthetic-model', cwd: ROOT, tools: [] }).input);
    await tick();
    assert.equal(cli.calls.length, 1);
    h.service.update('acc_source', { enabled: false });
    assert.equal(cli.calls[0].child.exitCode, null);
    assert.equal(cli.calls[0].child.killed, false);
    assert.equal(supervisor.leases().length, 1, 'enabled:false is not a process-drain acknowledgement');
    cli.calls[0].child.send({ type: 'result', subtype: 'success', is_error: false, result: 'synthetic', session_id: 'synthetic-session' });
    cli.calls[0].child.exit();
    await running;
  } finally { await engine.dispose(); await h.service.dispose(); h.db.close(); }
});

test('exclusive-takeover gap: monitor.idle can return while a check CLI still holds its grace lease', async () => {
  const h = checks();
  const { bus } = recordingBus();
  const account = plan();
  const monitor = new AccountMonitor({
    bus, clock: new ManualClock(),
    accounts: { list: () => [account], get: () => account, check: async () => { await h.status.read(EXE, account); return account; } },
  });
  const checking = monitor.checkNow(account.id);
  await tick();
  h.calls[0].child.send({ type: 'control_response', response: { subtype: 'success', request_id: 'init', response: {} } });
  h.calls[0].child.send({ type: 'control_response', response: { subtype: 'success', request_id: 'usage', response: {} } });
  await checking;
  await monitor.idle();
  assert.equal(h.calls[0].child.exitCode, null);
  assert.equal(h.supervisor.leases().length, 1, 'logical checks are idle, the CLI has not exited');
  h.calls[0].child.exit();
  monitor.stop();
});

test('exclusive-takeover gap: an enabled:false plan still accepts a mesh credential write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autark-synthetic-disabled-mesh-'));
  const h = harness({ accounts: path.join(root, 'accounts'), env: {} });
  try {
    const home = path.join(root, 'accounts', 'claude', 'acc_source');
    h.repo.save({ ...plan(), home, enabled: false, state: 'disabled' });
    new DevicesRepo(h.db).upsert({ id: 'dev_synthetic', name: 'Synthetic', kind: 'pc', role: 'home', fingerprint: 'synthetic', addresses: [], caps: {}, status: 'online', self: false, joinedAs: 'ceo' });
    const services = { db: h.db, bus: h.bus, log: silentLog, accounts: h.service, devices: { online: () => false } } as unknown as RuntimeServices;
    const sync = new LoginSync(services, { env: {}, homeDir: root, platform: 'win32' });
    const fixture = JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: 1000 } });
    const result = await sync.receive({ logins: [{ account: 'acc_source', provider: 'claude', at: 1000, files: [{ name: '.credentials.json', data: Buffer.from(fixture).toString('base64') }] }] }, 'dev_synthetic');
    assert.equal(result.applied, 1, 'mesh does not treat disable as a write fence');
    assert.equal(await readFile(path.join(home, '.credentials.json'), 'utf8'), fixture);
    assert.equal(h.service.get('acc_source')?.enabled, false);
  } finally {
    await h.service.dispose(); h.db.close();
    // Only this mkdtemp result, resolved and checked before recursive cleanup; never a supplied path.
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('autark-synthetic-disabled-mesh-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
