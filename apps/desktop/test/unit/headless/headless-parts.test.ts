// AF-025 – the headless start's parts without a process: its data folder and flags (options.ts), the banner text
// (banner.ts), what it does once it listens (announce.ts: the reach, a pairing link only while nothing is paired), the
// one-runtime-per-folder check (guard.ts), `pair` (pair-command.ts) and `autark --headless` on the app binary (main/headless.ts).
// Owns: these assertions only. Never: starts a runtime or opens a socket.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { announceStart, type AnnounceDeps } from '../../../src/runtime/headless/announce.ts';
import { pairingLines, spacedCode, startLines } from '../../../src/runtime/headless/banner.ts';
import { runningRuntime } from '../../../src/runtime/headless/guard.ts';
import { parseRuntimeNote } from '../../../src/runtime/headless/local-runtime.ts';
import { headlessDataDir, headlessOptions } from '../../../src/runtime/headless/options.ts';
import { pairCommand } from '../../../src/runtime/headless/pair-command.ts';
import { headlessCommand, isHeadlessStart } from '../../../src/main/headless.ts';

const NOW = 1_800_000_000_000;
const LINK = { url: 'http://192.168.1.5:47811/#pair=s3cret', code: '123456', expiresAt: NOW + 10 * 60_000 };

test('the headless data folder is its own – never the desktop app\'s ~/.config/Autark', () => {
  assert.equal(headlessDataDir({ platform: 'linux', env: {}, home: '/home/ann' }), '/home/ann/.local/share/autark');
  assert.equal(headlessDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/data/x' }, home: '/home/ann' }), '/data/x/autark');
  assert.equal(headlessDataDir({ platform: 'linux', env: { XDG_DATA_HOME: 'relative' }, home: '/home/ann' }), '/home/ann/.local/share/autark');
  assert.equal(headlessDataDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, home: 'C:\\Users\\a' }), 'C:\\Users\\a\\AppData\\Local\\Autark Headless');
  assert.equal(headlessDataDir({ platform: 'darwin', env: {}, home: '/Users/a' }), '/Users/a/Library/Application Support/Autark Headless');
  for (const env of [{}, { AUTARK_DATA: '/home/ann/.config/Autark' }]) {
    assert.ok(!headlessDataDir({ platform: 'linux', env, home: '/home/ann' }).includes('.config/Autark'), 'AUTARK_DATA (the app\'s folder) is not taken');
  }
});

test('headless flags: --data wins, --bind is checked, --no-pair turns the start link off', () => {
  const env = { platform: 'linux' as const, env: {}, home: '/home/ann' };
  assert.deepEqual(headlessOptions(['--headless'], env), { dataDir: '/home/ann/.local/share/autark', pair: true });
  assert.deepEqual(headlessOptions(['--headless', '--data', '/var/lib/autark', '--bind', 'lan', '--no-pair'], env), { dataDir: '/var/lib/autark', bind: 'lan', pair: false });
  assert.ok('error' in headlessOptions(['--headless', '--bind', 'everyone'], env));
  assert.ok('error' in headlessOptions(['--headless', '--bind'], env));
});

test('the banner names data, web addresses and the pairing link + spaced code – never a token', () => {
  assert.equal(spacedCode('012345'), '012 345');
  const lines = startLines({ version: '0.3.6', dataDir: '/var/lib/autark', urls: ['http://localhost:47811', 'http://192.168.1.5:47811'], devices: 0, remoteId: '482913071', pairing: LINK, pairCommand: 'autark-headless pair' }, NOW).join('\n');
  assert.match(lines, /Autark 0\.3\.6 is running headless/);
  assert.match(lines, /Data: {2}\/var\/lib\/autark/);
  assert.match(lines, /Web: {3}http:\/\/localhost:47811 {2}http:\/\/192\.168\.1\.5:47811/);
  assert.match(lines, /Remote ID: {2}482 913 071/);
  assert.match(lines, /Link: {2}http:\/\/192\.168\.1\.5:47811\/#pair=s3cret/);
  assert.match(lines, /Code: {2}123 456/);
  assert.match(lines, /for 10 minutes/);
  assert.match(lines, /autark-headless pair/);
  const paired = startLines({ version: '1', dataDir: '/d', urls: [], devices: 2, pairCommand: 'x pair' }, NOW).join('\n');
  assert.match(paired, /2 phones\/browsers already paired/);
  assert.doesNotMatch(paired, /Code:/);
  const unreachable = startLines({ version: '1', dataDir: '/d', urls: [], devices: 0, pairingError: 'Phones can\'t reach this PC yet', pairCommand: 'x pair' }, NOW).join('\n');
  assert.match(unreachable, /No pairing link yet: Phones can't reach/);
  assert.match(unreachable, /--bind lan/);
  const local = pairingLines({ ...LINK, url: 'http://localhost:47811/#pair=x' }, NOW, 'QR1\nQR2\n');
  assert.ok(local.some((line) => /Only a browser on this computer/.test(line)));
  assert.deepEqual(local.slice(-2), ['QR1', 'QR2'], 'the QR code ends the block');
});

function fakePwa(initial: { bind: 'localhost' | 'lan' | 'tailscale'; devices: number }) {
  const calls: string[] = [];
  let bind = initial.bind;
  const deps: AnnounceDeps = {
    bind: () => bind,
    now: () => NOW,
    remoteId: () => '482913071',
    pwa: {
      state: async () => ({ urls: bind === 'localhost' ? ['http://localhost:47811'] : ['http://localhost:47811', 'http://192.168.1.5:47811'], devices: Array.from({ length: initial.devices }) }),
      enable: async (input) => { calls.push(`enable:${input.bind ?? '-'}`); bind = input.bind ?? (bind === 'localhost' ? 'lan' : bind); return {}; },
      link: async (input) => { calls.push(`link:${input.loopback ? 'loopback' : '-'}`); return LINK; },
    },
  };
  return { deps, calls, bind: () => bind };
}

test('announce: a fresh runtime takes the same network and shows one link; --bind is applied; a paired one shows none', async () => {
  const options = { version: '0.3.6', dataDir: '/d', pair: true, pairCommand: 'autark-headless pair' };
  const fresh = fakePwa({ bind: 'localhost', devices: 0 });
  const lines = (await announceStart(fresh.deps, options)).join('\n');
  assert.deepEqual(fresh.calls, ['enable:-', 'link:loopback']);
  assert.equal(fresh.bind(), 'lan');
  assert.match(lines, /Code: {2}123 456/);

  const local = fakePwa({ bind: 'lan', devices: 0 });
  await announceStart(local.deps, { ...options, bind: 'localhost' });
  assert.deepEqual(local.calls, ['enable:localhost', 'link:loopback'], '--bind localhost is applied, the link may be the loopback one');

  const kept = fakePwa({ bind: 'tailscale', devices: 0 });
  await announceStart(kept.deps, options);
  assert.deepEqual(kept.calls, ['link:loopback'], 'without --bind a saved choice stays');

  const paired = fakePwa({ bind: 'localhost', devices: 1 });
  const pairedLines = (await announceStart(paired.deps, options)).join('\n');
  assert.deepEqual(paired.calls, [], 'a paired runtime keeps its reach and makes no link');
  assert.match(pairedLines, /1 phone\/browser already paired/);

  const off = fakePwa({ bind: 'lan', devices: 0 });
  await announceStart(off.deps, { ...options, pair: false });
  assert.deepEqual(off.calls, [], '--no-pair');

  const refused = fakePwa({ bind: 'lan', devices: 0 });
  refused.deps.pwa.link = async () => { throw new Error('Phones can\'t reach this PC yet'); };
  assert.match((await announceStart(refused.deps, options)).join('\n'), /No pairing link yet/);
});

test('guard: a runtime counts only while its process lives and its port answers', async () => {
  const note = JSON.stringify({ port: 47811, token: 't'.repeat(64), pid: 4242 });
  const deps = (alive: boolean, answers: boolean) => ({ readFile: () => note, alive: () => alive, answers: async () => answers });
  assert.deepEqual(await runningRuntime('/d', deps(true, true)), { pid: 4242, port: 47811 });
  assert.equal(await runningRuntime('/d', deps(false, true)), undefined, 'a crashed runtime\'s note');
  assert.equal(await runningRuntime('/d', deps(true, false)), undefined, 'the pid now belongs to another process');
  assert.equal(await runningRuntime('/d', { ...deps(true, true), readFile: () => { throw new Error('ENOENT'); } }), undefined);
  assert.equal(parseRuntimeNote('{"port":0,"token":"x"}'), undefined);
  assert.equal(parseRuntimeNote('nonsense'), undefined);
});

test('pair: prints a new link from the running runtime and never its token', async () => {
  const out: string[] = [];
  const err: string[] = [];
  const token = 'owner-token-'.padEnd(64, 'x');
  const io = { platform: 'linux' as const, env: {}, home: '/home/ann', print: (l: string) => out.push(l), error: (l: string) => err.push(l), now: () => NOW };
  let asked: unknown;
  const code = await pairCommand(['--data', '/var/lib/autark'], {
    ...io, note: (dir) => (dir === '/var/lib/autark' ? { port: 47811, token, pid: 7 } : undefined), alive: () => true,
    call: async (_note, method, params) => { asked = { method, params }; return LINK; },
  });
  assert.equal(code, 0);
  assert.deepEqual(asked, { method: 'pwa.link', params: { loopback: true } });
  assert.match(out.join('\n'), /Code: {2}123 456/);
  assert.ok(!out.join('\n').includes(token));

  const missing = await pairCommand([], { ...io, note: () => undefined });
  assert.equal(missing, 1);
  assert.match(err.join('\n'), /No running Autark found in \/home\/ann\/\.local\/share\/autark/);

  err.length = 0;
  const failed = await pairCommand([], { ...io, note: () => ({ port: 1, token }), call: async () => { throw new Error(`refused ${token}`); } });
  assert.equal(failed, 1);
  assert.ok(!err.join('\n').includes(token), 'the token never reaches the output');
});

test('`autark --headless` on the app binary runs runtime-cli.mjs in Node mode with the flags after it', () => {
  assert.ok(isHeadlessStart(['/opt/autark/autark', '--headless']));
  assert.ok(!isHeadlessStart(['/opt/autark/autark', '--background']));
  const asar = '/opt/autark/resources/app.asar';
  assert.deepEqual(headlessCommand(['/opt/autark/autark', '--headless', '--bind', 'lan'], asar, () => false),
    [path.join(asar, 'app', 'runtime-cli.mjs'), '--headless', '--bind', 'lan']);
  const unpacked = headlessCommand(['x', '--headless', 'pair'], asar, () => true);
  assert.match(unpacked[0]!, /app\.asar\.unpacked[\\/]app[\\/]runtime-cli\.mjs$/);
  assert.deepEqual(unpacked.slice(1), ['pair'], '`--headless pair` asks the running one for a code');
});
