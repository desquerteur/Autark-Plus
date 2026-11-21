// desquerteur/Autark-Plus#28 Grok Build as the fourth ACP plan (engines/acp/providers.ts; docs.x.ai/build: `grok agent stdio`,
// `grok login`, GROK_HOME): the table row and its lean environment, the launch without a --help read, the silent
// authenticate of a cached sign-in before session/new (Grok refuses session/new without one), the native binary in
// ~/.grok/bin, the login file for other PCs, the official installer with npm behind it, and an added account's own home
// with `grok login` in a terminal window.
// Owns: nothing in production. Never starts a real CLI or terminal, signs in anywhere or uses the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { ACP_PROVIDERS, AcpLaunches, GROK_LEAN_ENV, acpArgs, acpHomeEnv } from '../../../src/runtime/engines/acp/providers.ts';
import { hubToolOf, isHubPermission, promptUsage } from '../../../src/runtime/engines/acp/updates.ts';
import { createEngineRegistry, type EngineRegistry } from '../../../src/runtime/engines/registry.ts';
import { AccountServiceImpl } from '../../../src/runtime/accounts/service.ts';
import { ExecutableFinder, type FsLike } from '../../../src/runtime/accounts/executables.ts';
import { defaultHome, loginDir, loginFiles } from '../../../src/runtime/accounts/cli-homes.ts';
import { grokInstaller, installCli, INSTALL_FAILED } from '../../../src/runtime/accounts/install.ts';
import { engineCwd } from '../../../src/runtime/system/paths.ts';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate } from '../../../src/runtime/db/migrate.ts';
import { Bus } from '../../../src/runtime/bus.ts';
import { ManualClock } from '../../../src/runtime/system/clock.ts';
import type { SpawnFn } from '../../../src/runtime/system/supervisor.ts';
import { INSTALLABLE_CLIS, isAcpPlan } from '../../../src/shared/model/providers.ts';
import { cliRowView, INSTALLABLE, needsSignIn, PC_CLIS, PROVIDER_NAMES, providerGroup, SIGN_IN, SIGN_OUT, signInHint } from '../../../src/ui/settings/providers.ts';
import { account, acpAgent, fakeFinder, fakeSpawn, testSupervisor, tick } from './fakes.ts';

const DATA = path.resolve('fake-data');
const PATHS = { accounts: path.join(DATA, 'accounts'), data: DATA, temp: path.join(DATA, 'tmp') };
const NEUTRAL = engineCwd(PATHS);
const GROK = ACP_PROVIDERS['grok-cli'];

test('grok: the table row – `grok agent stdio`, `grok login` in a terminal, GROK_HOME per account, a lean environment', () => {
  assert.deepEqual([GROK.cli, GROK.name, GROK.command, GROK.signIn, GROK.home], ['grok', 'Grok Build', ['agent', 'stdio'], 'terminal', 'GROK_HOME']);
  assert.deepEqual(acpArgs(GROK, ''), ['agent', 'stdio'], 'the subcommand pair, whatever --help says');
  assert.deepEqual(acpArgs(GROK, '  --acp  something else\n'), ['agent', 'stdio']);
  assert.deepEqual(acpHomeEnv({ provider: 'grok-cli', home: '/data/accounts/grok-cli/acc_1' }), { GROK_HOME: '/data/accounts/grok-cli/acc_1' });
  assert.deepEqual(acpHomeEnv({ provider: 'grok-cli' }), {}, 'a login found in the default home (~/.grok)');
  assert.ok(GROK.silentAuth?.test('cached_token'), 'the cached sign-in is reused');
  assert.ok(!GROK.silentAuth?.test('grok.com'), 'never the browser sign-in');
  assert.ok(!GROK.silentAuth?.test('xai.api_key'), 'never an API key (plans only)');
  assert.equal(GROK_LEAN_ENV.GROK_DISABLE_AUTOUPDATER, '1');
  for (const scanner of ['SKILLS', 'RULES', 'AGENTS', 'MCPS', 'HOOKS']) {
    assert.equal(GROK_LEAN_ENV[`GROK_CLAUDE_${scanner}_ENABLED`], '0', `Claude ${scanner}`);
    assert.equal(GROK_LEAN_ENV[`GROK_CURSOR_${scanner}_ENABLED`], '0', `Cursor ${scanner}`);
  }
  assert.deepEqual([GROK_LEAN_ENV.GROK_MEMORY, GROK_LEAN_ENV.GROK_SUBAGENTS, GROK_LEAN_ENV.GROK_GOAL], ['0', '0', '0']);
});

test('grok: the launch carries the home, the lean environment and the silent auth – without starting `grok --help`', async () => {
  const help = fakeSpawn(() => { throw new Error('no --help for a fixed command'); });
  const launches = new AcpLaunches({ finder: fakeFinder({ grok: '/home/p/.grok/bin/grok' }), supervisor: testSupervisor(help.spawn), cwd: NEUTRAL, env: {} });
  const launch = await launches.resolve({ provider: 'grok-cli', home: '/data/accounts/grok-cli/acc_1' });
  assert.deepEqual([launch?.name, launch?.command, launch?.args], ['Grok Build', '/home/p/.grok/bin/grok', ['agent', 'stdio']]);
  assert.deepEqual(launch?.env, { ...GROK_LEAN_ENV, GROK_HOME: '/data/accounts/grok-cli/acc_1' });
  assert.equal(launch?.silentAuth, GROK.silentAuth);
  assert.equal(help.calls.length, 0);
});

test('grok: Settings lists the plan, installs it and signs it in in a terminal', () => {
  assert.equal(isAcpPlan('grok-cli'), true);
  assert.deepEqual([PROVIDER_NAMES['grok-cli'], providerGroup('grok-cli'), SIGN_IN['grok-cli'], SIGN_OUT.has('grok-cli')], ['Grok Build', 'plans', 'terminal', false]);
  assert.ok(PC_CLIS.includes('grok-cli'), 'On this PC lists it');
  assert.ok(INSTALLABLE.has('grok-cli') && INSTALLABLE_CLIS.includes('grok-cli'), 'Autark installs it');
  assert.deepEqual(cliRowView({ provider: 'grok-cli' }, []), { name: 'Grok Build', hint: 'Not installed', action: 'install', account: undefined });
  assert.equal(cliRowView({ provider: 'grok-cli', path: '/bin/grok', loggedIn: false }, []).action, 'sign-in');
  assert.equal(needsSignIn(account({ provider: 'grok-cli', state: 'needs_login' })), true);
  assert.match(signInHint('grok-cli'), /SuperGrok or X Premium\+/);
});

test('grok: an Autark tool behind its use_tool is known as a hub tool from the first update; its usage sits in _meta (shapes seen live, 1.0.92)', () => {
  const xai = (name: string) => ({ 'x.ai/tool': { version: 1, name, kind: name, namespace: 'grok_build', label: name, read_only: false } });
  const first = { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'use_tool', rawInput: { tool_name: 'workforce__tasks__create', tool_input: {} }, _meta: xai('use_tool') };
  assert.equal(hubToolOf(first), 'tasks.create');
  const permission = { toolCallId: 'c1', kind: 'other', title: 'workforce__tasks__create', rawInput: { variant: 'UseTool', tool_name: 'workforce__tasks__create', tool_input: {} }, _meta: xai('use_tool') };
  assert.equal(isHubPermission(permission, [{ optionId: 'allow-once', name: 'allow once', kind: 'allow_once' }]), true);
  assert.equal(hubToolOf({ ...first, rawInput: { tool_name: 'other__tool' } }), undefined, 'another MCP server is not ours');
  assert.equal(hubToolOf({ ...first, rawInput: { tool_name: 'workforce__x; rm -rf /' } }), undefined, 'strict names only');
  assert.equal(hubToolOf({ title: 'use_tool', rawInput: { tool_name: 'workforce__tasks__create' }, _meta: xai('write') }), undefined, 'only Grok\'s use_tool');
  assert.equal(hubToolOf({ ...first, kind: 'edit' }), undefined, 'never a kind with effects of its own');
  assert.deepEqual(promptUsage({ stopReason: 'end_turn', _meta: { usage: { inputTokens: 48063, outputTokens: 383, reasoningTokens: 252 } } }), { inputTokens: 48063, outputTokens: 383 });
  assert.deepEqual(promptUsage({ stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 }, _meta: { usage: { inputTokens: 9, outputTokens: 9 } } }), { inputTokens: 5, outputTokens: 2 }, 'the ACP field wins');
});

/** A fake disk (Windows paths): the files that exist. */
function disk(files: readonly string[]): FsLike {
  const lower = new Set(files.map((file) => file.toLowerCase()));
  return {
    stat: async (p) => { if (!lower.has(p.toLowerCase())) throw new Error('ENOENT'); return { isFile: () => true, isDirectory: () => false }; },
    access: async (p) => { if (!lower.has(p.toLowerCase())) throw new Error('ENOENT'); },
    readdir: async () => [],
    readFile: async () => { throw new Error('ENOENT'); },
  };
}

test('grok: the native binary in ~/.grok/bin wins over the npm shim (whose target is a Node script without extension)', async () => {
  const exe = 'C:\\Users\\p\\.grok\\bin\\grok.exe';
  const shim = 'C:\\Users\\p\\AppData\\Roaming\\npm\\grok.cmd';
  const env = { PATH: 'C:\\Windows\\system32', APPDATA: 'C:\\Users\\p\\AppData\\Roaming' };
  const finder = new ExecutableFinder({ platform: 'win32', env, home: 'C:\\Users\\p', fs: disk([exe, shim]) });
  assert.deepEqual(await finder.find('grok'), { command: exe, prefixArgs: [], path: exe });
  const own = 'D:\\grok-home\\bin\\grok.exe';
  const custom = new ExecutableFinder({ platform: 'win32', env: { ...env, GROK_HOME: 'D:\\grok-home' }, home: 'C:\\Users\\p', fs: disk([own, exe]) });
  assert.equal((await custom.find('grok'))?.command, own, 'a GROK_HOME of the person comes first');
  const posix = new ExecutableFinder({ platform: 'linux', env: { PATH: '/usr/bin' }, home: '/home/p', fs: disk(['/home/p/.grok/bin/grok']) });
  assert.equal((await posix.find('grok'))?.command, '/home/p/.grok/bin/grok');
});

test('grok: its login lives in auth.json of GROK_HOME (default ~/.grok), so other PCs can take it over', () => {
  assert.deepEqual(loginFiles('grok-cli'), ['auth.json']);
  assert.equal(defaultHome('grok-cli', {}, '/home/p'), path.join('/home/p', '.grok'));
  assert.equal(defaultHome('grok-cli', { GROK_HOME: '/elsewhere' }, '/home/p'), '/elsewhere');
  assert.equal(loginDir({ provider: 'grok-cli', home: '/data/accounts/grok-cli/acc_1' }), '/data/accounts/grok-cli/acc_1');
});

test('grok: the official installer first (~/.grok/bin), `npm i -g @xai-official/grok` when it failed', async () => {
  const win = grokInstaller('win32');
  assert.equal(win.command, 'powershell.exe');
  assert.match(win.args.at(-1)!, /https:\/\/x\.ai\/cli\/install\.ps1/);
  assert.match(win.args.at(-1)!, /\.grok\/bin\/grok\.exe/);
  assert.match(grokInstaller('linux').args.at(-1)!, /curl -fsSL https:\/\/x\.ai\/cli\/install\.sh \| bash/);

  const map: Record<string, string | null> = { grok: null, npm: 'C:\\Program Files\\nodejs\\npm.cmd' };
  const finder = { find: async (id: string) => (map[id] ? { command: map[id]!, prefixArgs: [], path: map[id]! } : null), clear: () => {} } as unknown as ExecutableFinder;
  const { spawn, calls } = fakeSpawn((call) => {
    const npm = call.args.includes('@xai-official/grok');
    if (npm) map.grok = 'C:\\Users\\p\\.grok\\bin\\grok.exe';
    setImmediate(() => call.child.exit(npm ? 0 : 1)); // the script route fails, npm works
  });
  assert.equal(await installCli('grok-cli', { supervisor: testSupervisor(spawn), finder, platform: 'win32', env: {} }), true);
  assert.deepEqual(calls.map((call) => call.command), ['powershell.exe', 'cmd.exe']);
  assert.deepEqual(calls[1].args, ['/d', '/s', '/c', 'npm', 'install', '-g', '@xai-official/grok']);

  map.grok = null; map.npm = null;
  const none = fakeSpawn((call) => setImmediate(() => call.child.exit(1)));
  await assert.rejects(installCli('grok-cli', { supervisor: testSupervisor(none.spawn), finder, platform: 'win32', env: {} }), { message: INSTALL_FAILED['grok-cli'] });
});

/**
 * An account service over a scripted `grok agent stdio`: initialize offers `cached_token` only where a login exists
 * (`signedIn`), and session/new refuses until authenticate named a method – as grok 1.0.92 does.
 */
function service(signedIn: { default: boolean; own: boolean }) {
  const db = new Db(':memory:');
  migrate(db);
  let current: Record<string, string | undefined> | undefined; // the environment of the last `grok agent stdio`
  const authed = new WeakSet<object>();
  const agent = acpAgent({ handle: (msg, reply, child) => {
    const own = Boolean(current?.GROK_HOME);
    const login = own ? signedIn.own : signedIn.default;
    if (msg.method === 'initialize') {
      reply.result({ protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true }, sessionCapabilities: { close: {} } },
        authMethods: [{ id: 'grok.com', name: 'Grok' }, ...(login ? [{ id: 'cached_token', name: 'Cached token' }] : [])] });
      return true;
    }
    if (msg.method === 'authenticate') {
      if (msg.params?.methodId !== 'cached_token') { reply.error(-32000, 'not in this test'); return true; }
      authed.add(child);
      reply.result({});
      return true;
    }
    if (msg.method === 'session/new' && !authed.has(child)) {
      reply.error(-32000, 'Authentication required');
      return true;
    }
    return false;
  } });
  const other = fakeSpawn((call) => {
    const out = call.args.includes('--version') ? 'grok 1.0.92 (b06756fd6256)\n' : undefined;
    if (out !== undefined) setImmediate(() => { call.child.stdout.write(out); setImmediate(() => call.child.exit(0)); });
  });
  const spawn: SpawnFn = (command, args, options) => {
    if (args.at(-1) !== 'stdio') return other.spawn(command, args, options);
    current = options.env as Record<string, string | undefined>;
    return agent.spawn(command, args, options);
  };
  const supervisor = testSupervisor(spawn);
  const finder = fakeFinder({ grok: '/home/p/.grok/bin/grok' });
  let registry: EngineRegistry | undefined;
  const folders: string[] = [];
  const accounts = new AccountServiceImpl({
    db, bus: new Bus((error) => { throw error; }), clock: new ManualClock(), paths: PATHS, env: { PATH: '/usr/bin', SystemRoot: 'C:\\Windows', XAI_API_KEY: 'xai-secret' }, finder, supervisor,
    version: '1.0.0', engines: () => registry!, terminal: { platform: 'win32' }, mkdir: async (dir) => { folders.push(dir); },
    secrets: { save: async () => ({ id: 'none' }), read: async () => undefined, remove: () => {} },
    detectDeps: { fetch: async () => { throw new Error('offline'); }, probeTimeoutMs: 1 },
  });
  registry = createEngineRegistry({ supervisor, finder, paths: PATHS, version: '1.0.0', apiKey: async () => undefined, acp: accounts.acpLaunch });
  const settle = async () => { for (let i = 0; i < 20; i++) await tick(); await accounts.monitor.idle(); };
  return { accounts, agent, other, settle, folders, registry: () => registry! };
}

test('grok: a login in ~/.grok is reused silently (cached_token, headless) and adopted; an added account gets its own home and `grok login`', async () => {
  const h = service({ default: true, own: false });
  const report = await h.accounts.detect();
  await h.settle();
  const found = report.clis.find((cli) => cli.provider === 'grok-cli');
  assert.deepEqual([found?.path, found?.loggedIn], ['/home/p/.grok/bin/grok', true]);
  const probe = h.agent.calls[0];
  assert.equal(probe.options.env?.GROK_HOME, undefined, 'the probe asks the default home');
  assert.equal(probe.options.env?.XAI_API_KEY, undefined, 'never an API key: the plan bills, not the key');
  assert.equal(probe.options.env?.GROK_CLAUDE_MCPS_ENABLED, '0');
  const auth = h.agent.state.requests.find((msg) => msg.method === 'authenticate');
  assert.deepEqual(auth?.params, { methodId: 'cached_token', _meta: { headless: true } });
  assert.deepEqual(h.accounts.list().map((a) => [a.provider, a.label, a.home, a.detected]), [['grok-cli', 'Grok Build', undefined, true]]);

  const added = await h.accounts.add({ provider: 'grok-cli', label: 'Work' });
  const home = path.join(PATHS.accounts, 'grok-cli', added.id);
  assert.deepEqual([added.home, added.auth, added.state, h.folders], [home, 'cli', 'needs_login', [home]]);
  const window = h.other.calls.find((call) => call.options.env?.WORKFORCE_TERMINAL_EXE === '/home/p/.grok/bin/grok');
  assert.ok(window, 'the sign-in runs in a visible terminal window');
  assert.equal(window.options.env?.WORKFORCE_TERMINAL_ARGS, JSON.stringify(['login']));
  assert.equal(window.options.env?.GROK_HOME, home);

  const checked = await h.accounts.check(added.id);
  assert.equal(checked.state, 'needs_login', 'its own home has no login yet');
  const own = h.agent.calls.find((call) => call.options.env?.GROK_HOME === home);
  assert.ok(own, 'the account check starts `grok agent stdio` in its own home');
  assert.deepEqual([own.args, own.options.cwd], [['agent', 'stdio'], NEUTRAL]);
  await h.accounts.dispose();
  await h.registry().dispose();
});

test('grok: a sign-in made after the agent started shows on the next check (a new process reuses it)', async () => {
  const signedIn = { default: false, own: false };
  const h = service(signedIn);
  const added = await h.accounts.add({ provider: 'grok-cli', label: 'Grok' });
  assert.equal(added.state, 'needs_login');
  signedIn.own = true; // `grok login` finished in the terminal window
  await h.settle();
  const checked = await h.accounts.check(added.id);
  assert.equal(checked.state, 'ok');
  assert.ok(!h.agent.state.requests.some((msg) => msg.method === 'authenticate' && msg.params?.methodId !== 'cached_token'), 'the browser sign-in never starts by itself');
  await h.accounts.dispose();
  await h.registry().dispose();
});
