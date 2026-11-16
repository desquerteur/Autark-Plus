// B-080 – installing a build and the desktop broker on the main side: installFile drains in the update's order, starts
// the relaunch helper with the given installer and quits (a missing file, macOS or a window that keeps its drafts refuses
// before any drain and the runtime hears the cancel – it answers its install record; a helper that cannot start resumes
// the app); the updater's drain names the version it installs; the host op app.install answers
// before it acts; an open of a file waits as long as Windows takes; the broker's setup starts once where it is missing;
// the broker's installer ships with the app and the setup stops, starts, installs and removes it; the runtime starts its
// turns last.
// Owns: these assertions only. Never: a real installer, elevation, electron or the person's files.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DesktopUpdates } from '../../../src/main/updates-wiring.ts';
import type { HelperLaunch } from '../../../src/main/updates/install-helper.ts';
import { HostServices, type HostServicesDeps } from '../../../src/main/host-services.ts';
import { setupBroker, type BrokerSetupDeps } from '../../../src/main/broker-setup.ts';
import { HostBridgeClient } from '../../../src/runtime/host-electron.ts';
import { desktopDeps, fakeUpdater, settle } from './update-fakes.ts';

const INSTALLER = 'C:\\Users\\me\\Autark\\dist\\autark-windows-x64.exe';
const EXE = 'C:\\Users\\me\\AppData\\Local\\Programs\\Autark\\Autark.exe';

function installing(platform = 'win32', helper: 'starts' | 'fails' = 'starts') {
  const launches: HelperLaunch[] = [];
  const h = desktopDeps({ platform });
  h.deps.install = {
    pid: 4242, exe: EXE, logs: 'C:\\Users\\me\\AppData\\Roaming\\Autark\\logs', appImage: '/home/me/Autark.AppImage',
    quit: () => h.order.push('quit'),
    exists: (file) => file === INSTALLER || file === '/home/me/dist/autark.AppImage',
    spawn: (launch, _logs, events) => { launches.push(launch); h.order.push('spawn'); if (helper === 'starts') events.started(); else events.failed(new Error('denied')); },
  };
  return { ...h, launches, updates: new DesktopUpdates(h.deps) };
}

test('installFile: the drain in order, then the relaunch helper with this installer, then quit', async () => {
  const h = installing();
  await h.updates.installFile(INSTALLER);
  assert.deepEqual(h.order, ['drafts', 'pause', 'stop', 'spawn', 'quit']);
  assert.equal(h.launches[0].env.AUTARK_UPDATE_INSTALLER, INSTALLER);
  assert.equal(h.launches[0].env.AUTARK_UPDATE_PID, '4242');
  assert.equal(h.launches[0].env.AUTARK_UPDATE_EXE, EXE);
  assert.equal(h.updates.draining, true, 'the quit after it does not drain again');
  h.updates.dispose();
});

test('installFile: a missing file or macOS refuses before any drain; a helper that cannot start resumes the app', async () => {
  const missing = installing();
  await assert.rejects(missing.updates.installFile('C:\\nope.exe'), (error: { code?: string }) => error.code === 'not_found');
  assert.deepEqual(missing.order, ['resume'], 'nothing drained; the runtime hears the cancel');
  const mac = installing('darwin');
  await assert.rejects(mac.updates.installFile(INSTALLER), (error: { code?: string }) => error.code === 'unavailable');
  assert.deepEqual(mac.order, ['resume']);
  const kept = installing();
  kept.deps.renderer = { rendererReady: true, prepareRestart: async () => { kept.order.push('drafts'); return false; } };
  await assert.rejects(new DesktopUpdates(kept.deps).installFile(INSTALLER), /drafts/);
  assert.deepEqual(kept.order, ['drafts', 'resume'], 'the window kept its drafts: no pause, the cancel reaches the runtime');
  const linux = installing('linux');
  await linux.updates.installFile('/home/me/dist/autark.AppImage');
  assert.equal(linux.launches[0].command, '/bin/sh', 'the AppImage helper');
  const failing = installing('win32', 'fails');
  await failing.updates.installFile(INSTALLER);
  assert.deepEqual(failing.order, ['drafts', 'pause', 'stop', 'spawn', 'start'], 'the drained runtime starts again');
  assert.equal(failing.updates.draining, false);
  for (const h of [missing, mac, linux, failing, kept]) h.updates.dispose();
});

test("the updater's drain names the version it installs", async () => {
  const fake = fakeUpdater({ version: '0.3.5' });
  const h = desktopDeps({ updater: fake.updater });
  const updates = new DesktopUpdates(h.deps);
  await updates.service.check();
  assert.equal(updates.state().status, 'downloaded');
  await updates.service.install(false);
  assert.deepEqual(h.order, ['drafts', 'pause:0.3.5', 'stop']);
  updates.dispose();
});

test('host op app.install: answered first, the install runs on the next tick; a bad path or no wiring refuses', async () => {
  const timers: Array<() => void> = [];
  const installs: string[] = [];
  const deps = {
    install: async (file: string) => { installs.push(file); },
    setTimer: (fn: () => void) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  } as unknown as HostServicesDeps;
  const host = new HostServices(deps);
  assert.deepEqual(await host.handle({ id: 1, type: 'host', op: 'app.install', args: { installer: INSTALLER } }), { ok: true });
  assert.deepEqual(installs, [], 'not before the answer went out');
  timers.shift()!();
  await settle();
  assert.deepEqual(installs, [INSTALLER]);
  await assert.rejects(host.handle({ id: 2, type: 'host', op: 'app.install', args: { installer: 'dist\\setup.exe' } }), (error: { code?: string }) => error.code === 'bad_request');
  const bare = new HostServices({ ...deps, install: undefined } as unknown as HostServicesDeps);
  await assert.rejects(bare.handle({ id: 3, type: 'host', op: 'app.install', args: { installer: INSTALLER } }), (error: { code?: string }) => error.code === 'unavailable');
});

test("an open of a file waits past the bridge's 15 s for main's answer", async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const sent: Array<{ id: number }> = [];
    const bridge = new HostBridgeClient({ postMessage: (message) => sent.push(message as { id: number }) });
    let opened = false;
    const open = bridge.call('openPath', { path: 'C:\\x.md' }).then(() => { opened = true; });
    const idle = bridge.call('idleSeconds', {}).catch((error: { code?: string }) => error.code);
    mock.timers.tick(30_000);
    assert.equal(await idle, 'timeout', 'other ops keep their 15 s');
    await Promise.resolve();
    assert.equal(opened, false, 'still waiting for the editor');
    bridge.resolve({ id: sent[0].id, type: 'host-result', ok: true, result: { ok: true } });
    await open;
    assert.equal(opened, true);
  } finally { mock.timers.reset(); }
});

function broker(patch: Partial<BrokerSetupDeps> = {}) {
  const started: Array<{ command: string; args: string[] }> = [];
  const files = new Set(['C:\\Users\\me\\AppData\\Local\\Programs\\Autark\\resources\\app.asar.unpacked\\resources\\broker\\install.ps1']);
  const deps: BrokerSetupDeps = {
    platform: 'win32', packaged: true, testMode: false, background: false, root: 'C:\\Users\\me\\AppData\\Local\\Programs\\Autark\\resources\\app.asar', exe: EXE,
    env: { ProgramData: 'C:\\ProgramData', SystemRoot: 'C:\\Windows' }, exists: (file) => files.has(file), start: (command, args) => { started.push({ command, args }); return undefined; }, ...patch,
  };
  return { deps, started, files };
}

test('the broker setup starts once where its key is missing – hidden, not waited for – and never elsewhere', () => {
  const b = broker();
  assert.equal(setupBroker(b.deps), true);
  assert.equal(b.started.length, 1);
  assert.equal(b.started[0].command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(b.started[0].args.slice(-4), ['-File', 'C:\\Users\\me\\AppData\\Local\\Programs\\Autark\\resources\\app.asar.unpacked\\resources\\broker\\install.ps1', '-AppExe', EXE]);
  assert.ok(b.started[0].args.includes('Hidden'));
  const installed = broker();
  installed.files.add('C:\\ProgramData\\AutarkDesktopBroker\\broker.key');
  assert.equal(setupBroker(installed.deps), true, 'a key alone does not prove image integrity');
  for (const deps of [broker({ background: true }).deps, broker({ packaged: false }).deps, broker({ testMode: true }).deps, broker({ platform: 'linux' }).deps]) {
    assert.equal(setupBroker(deps), false);
  }
  assert.equal(installed.started.length, 1);
});

test("the broker's installer ships with the app, and the setup stops, starts, installs and removes the broker", () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(pkg.build.asarUnpack.includes('resources/broker/*.exe'));
  assert.ok(pkg.build.asarUnpack.includes('resources/**/*.ps1'), 'install.ps1 unpacked too');
  assert.ok(existsSync(path.join('resources', 'broker', 'install.ps1')));
  assert.equal(existsSync(path.join('scripts', 'broker-install.ps1')), false, 'moved');
  const script = readFileSync(path.join('resources', 'broker', 'install.ps1'), 'utf8');
  assert.match(script, /GetFolderPath\('ProgramFiles'\)/);
  assert.match(script, /Assert-ProtectedImage \$exe/);
  assert.match(script, /\[IO.FileMode\]::CreateNew/);
  assert.doesNotMatch(script, /Remove-Item -Recurse|sc\.exe create/);
  assert.match(script, /if \(\$oldParts\) \{ \$UserSid = \$oldParts\[1\]/);
  const nsh = readFileSync(path.join('assets', 'installer.nsh'), 'utf8');
  const macro = (name: string) => nsh.slice(nsh.indexOf(`!macro ${name}`), nsh.indexOf('!macroend', nsh.indexOf(`!macro ${name}`)));
  const check = macro('customCheckAppRunning');
  // B-084 (0.3.5): the legacy-service check reads the service's ImagePath from the registry, no script host per update.
  assert.match(check, /ReadRegStr \$R1 HKLM "\$\{BROKER_SERVICE_KEY\}" "ImagePath"/);
  assert.match(check, /\$PROGRAMFILES64\\AutarkDesktopBroker\\/);
  assert.ok(check.indexOf('SetErrorLevel 2') < check.indexOf('tasklist'));
  assert.doesNotMatch(nsh, /net\.exe" (start|stop) AutarkDesktopBroker/);
  const install = macro('customInstall');
  assert.match(install, /\$\{IfNot\} \$\{Silent\}[\s\S]*install\.ps1/);
  assert.match(macro('customUnInstall'), /install\.ps1" -Uninstall/);
});

test('the runtime starts its turns last, right before it reports ready', () => {
  const main = readFileSync(path.join('src', 'runtime', 'main.ts'), 'utf8');
  const start = main.indexOf('core.dispatcher.start();');
  assert.ok(start > main.indexOf('await network.peer.start();'), 'after the peer listener');
  assert.ok(start > main.indexOf('core.catalog.start();'));
  assert.ok(start < main.indexOf("log.info('runtime ready'"));
  assert.equal(main.indexOf('core.dispatcher.start();', start + 1), -1, 'once');
});
