// The Windows/Linux relaunch helper (src/main/updates/install-helper.ts): the cmd script and its launch values, the sh
// script and its positional arguments, the quitAndInstall override (helper started → quit; failed → the library's own
// call) and one real run of the sh script where a shell exists (a stand-in AppImage, no install).
// Owns: these assertions only. Never: runs an installer, starts Autark or touches the real updater cache.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HELPER_MARGIN_SECONDS, spawnHelper, LINUX_HELPER_SCRIPT, WAIT_SECONDS, WINDOWS_HELPER_SCRIPT, helperLaunch, installWithHelper, linuxHelper, windowsHelper, type HelperLaunch, type InstallHelperDeps,
} from '../../../src/main/updates/install-helper.ts';
import { INSTALL_WATCHDOG_MS } from '../../../src/main/updates/update-service.ts';
import type { Updater } from '../../../src/main/updates/update-service.ts';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'wf-helper-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const INSTALLER = 'C:\\Users\\Jürgen Ä\\AppData\\Local\\autark-updater\\pending\\autark-windows-x64.exe';
const EXE = 'C:\\Users\\Jürgen Ä\\AppData\\Local\\Programs\\Autark\\Autark.exe';
const LOG = 'C:\\Users\\Jürgen Ä\\AppData\\Roaming\\Autark\\logs\\update-helper.log';

test('Windows: a plain-ASCII cmd script beside the installer, values through the environment, CRLF lines', () => {
  const launch = windowsHelper({ pid: 4242, installer: INSTALLER, exe: EXE, logFile: LOG });
  const dir = 'C:\\Users\\Jürgen Ä\\AppData\\Local\\autark-updater\\pending';
  assert.equal(launch.command, 'cmd.exe');
  assert.deepEqual(launch.args, ['/d', '/s', '/c', `""${dir}\\update-helper.cmd""`]);
  assert.equal(launch.verbatim, true);
  assert.equal(launch.cwd, dir, 'never the install folder, which the uninstaller removes');
  assert.deepEqual(launch.env, {
    AUTARK_UPDATE_PID: '4242', AUTARK_UPDATE_INSTALLER: INSTALLER, AUTARK_UPDATE_EXE: EXE,
    AUTARK_UPDATE_DIR: 'C:\\Users\\Jürgen Ä\\AppData\\Local\\Programs\\Autark', AUTARK_UPDATE_LOG: LOG,
    AUTARK_UPDATE_PIDS: `${dir}\\update-helper-pids.txt`,
  });
  assert.equal(launch.script?.file, `${dir}\\update-helper.cmd`);
  const text = launch.script!.text;
  assert.match(text, /^@echo off\r\n/);
  assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, 'every line ends with CRLF');
  assert.equal(/^[\x00-\x7f]*$/.test(text), true, 'no path inside: the script is ASCII');
  assert.match(text, /start "" \/wait "%AUTARK_UPDATE_INSTALLER%" --updated \/S\r\n/);
  assert.match(text, /if exist "%AUTARK_UPDATE_INSTALLER%" goto install\r\n/, 'never start a missing installer: its ShellExecute dialog is visible and blocks');
  assert.doesNotMatch(text, /--force-run/, 'the helper starts the app, not NSIS through Explorer');
  assert.match(text, /start "" \/D "%AUTARK_UPDATE_DIR%" "%AUTARK_UPDATE_EXE%" --updated/);
  assert.match(text, /"%SystemRoot%\\System32\\tasklist\.exe" \/FI "PID eq %AUTARK_UPDATE_PID%" \/NH >"%AUTARK_UPDATE_PIDS%"/);
  assert.match(text, /"%SystemRoot%\\System32\\find\.exe" " %AUTARK_UPDATE_PID% " "%AUTARK_UPDATE_PIDS%"/, 'never GNU find from a PATH with Git');
  assert.match(text, /if defined AUTARK_UPDATE_INNER goto main\r\nset AUTARK_UPDATE_INNER=1\r\nstart "" \/b "%SystemRoot%\\System32\\cmd\.exe" \/d \/s \/c ""%~f0""\r\nexit \/b 0\r\n:main\r\n/, 'out of the job object, same hidden console');
  assert.doesNotMatch(text, / \| /, 'no pipe: find reads a file, so it cannot wait for an end of input (issue #1)');
  assert.match(text, /if %errorlevel% equ 1 goto gone/, 'only "not found" counts as ended; an unreadable file is a try');
  assert.match(text, />>"%AUTARK_UPDATE_LOG%" echo/);
  assert.doesNotMatch(text, /timeout /, 'timeout fails without a console input; ping waits instead');
  assert.equal(WINDOWS_HELPER_SCRIPT.includes('\r'), false);
});

test('Windows: a differential package goes along as --package-file', () => {
  const launch = windowsHelper({ pid: 1, installer: INSTALLER, packageFile: 'C:\\cache\\package.7z', exe: EXE, logFile: LOG });
  assert.equal(launch.env.AUTARK_UPDATE_PACKAGE, 'C:\\cache\\package.7z');
  assert.match(launch.script!.text, /"--package-file=%AUTARK_UPDATE_PACKAGE%"/);
  assert.equal('AUTARK_UPDATE_PACKAGE' in windowsHelper({ pid: 1, installer: INSTALLER, exe: EXE, logFile: LOG }).env, false);
});

test('Linux: sh with positional arguments, mv -f and chmod, then exec with --updated', () => {
  const launch = linuxHelper({ pid: 77, downloaded: '/home/a b/.cache/autark-updater/pending/autark-linux-x64.AppImage', appImage: '/home/a b/Apps/autark-linux-x64.AppImage', logFile: '/home/a b/.config/Autark/logs/update-helper.log' });
  assert.equal(launch.command, '/bin/sh');
  assert.deepEqual(launch.args.slice(0, 3), ['-c', LINUX_HELPER_SCRIPT, 'autark-update']);
  assert.deepEqual(launch.args.slice(3), ['77', '/home/a b/.cache/autark-updater/pending/autark-linux-x64.AppImage', '/home/a b/Apps/autark-linux-x64.AppImage', '/home/a b/.config/Autark/logs/update-helper.log']);
  assert.equal(launch.cwd, '/home/a b/Apps');
  assert.equal(launch.verbatim, false);
  assert.match(LINUX_HELPER_SCRIPT, /mv -f "\$downloaded" "\$target"/);
  assert.match(LINUX_HELPER_SCRIPT, /chmod \+x "\$target"/);
  assert.match(LINUX_HELPER_SCRIPT, /exec "\$target" --updated/);
});

function fakeUpdater(file: string | null): Updater & { original: Array<[boolean, boolean]> } {
  const original: Array<[boolean, boolean]> = [];
  return {
    autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false, logger: null,
    on: () => undefined,
    checkForUpdates: () => Promise.resolve(null),
    downloadUpdate: () => Promise.resolve(null),
    quitAndInstall(silent: boolean, run: boolean) { original.push([silent, run]); },
    installerPath: file,
    downloadedUpdateHelper: { packageFile: null },
    original,
  } as Updater & { original: Array<[boolean, boolean]> };
}

function deps(patch: Partial<InstallHelperDeps> & { outcome?: 'started' | 'failed' | 'throws' | 'silent' } = {}) {
  const record = { quits: 0, launches: [] as HelperLaunch[], lines: [] as string[], ends: [] as Array<() => void> };
  const value: InstallHelperDeps = {
    platform: 'win32', pid: 9, exe: EXE, logFile: LOG,
    spawn: (launch, events) => {
      record.launches.push(launch);
      record.ends.push(() => events.ended());
      if (patch.outcome === 'throws') throw Object.assign(new Error('nope'), { code: 'EINVAL' });
      if (patch.outcome === 'failed') events.failed(Object.assign(new Error('blocked'), { code: 'EACCES' }));
      else if (patch.outcome !== 'silent') events.started();
    },
    quit: () => { record.quits += 1; },
    log: line => record.lines.push(line),
    ...patch,
  };
  return { value, record };
}

test('quitAndInstall: the started helper quits the app; the library\'s own install is not called', () => {
  const updater = fakeUpdater(INSTALLER);
  const { value, record } = deps();
  installWithHelper(updater, value);
  updater.quitAndInstall(true, true);
  assert.equal(record.quits, 1);
  assert.equal(record.launches.length, 1);
  assert.deepEqual(updater.original, []);
  updater.quitAndInstall(true, true);
  assert.equal(record.launches.length, 1, 'the helper still lives and waits: a second click only quits again');
  assert.equal(record.quits, 2);
  record.ends[0]!(); // the helper gave up (the app kept running past its wait) and exited
  updater.quitAndInstall(true, true);
  assert.equal(record.launches.length, 2, 'after the helper ended, the next click starts a new one');
  assert.equal(record.quits, 3);
});

test('a helper never installs over a resumed app: it waits longer than the install watchdog, then gives up', () => {
  assert.ok(WAIT_SECONDS * 1000 > INSTALL_WATCHDOG_MS + 15_000, 'longer than the watchdog plus a slow graceful quit');
  const text = WINDOWS_HELPER_SCRIPT;
  const late = text.slice(text.indexOf(':late'), text.indexOf(':gone'));
  assert.match(late, /update left for the next try"\nexit \/b 3\n$/, 'Windows: no installer (and no taskkill) after the wait');
  assert.match(LINUX_HELPER_SCRIPT, new RegExp(`-gt ${WAIT_SECONDS * 2} \\]; then note "the app still runs after ${WAIT_SECONDS} s; update left for the next try"; exit 3; fi`));
});

test('quitAndInstall: a helper that cannot start falls back to the library, which relaunches as before', () => {
  for (const outcome of ['failed', 'throws'] as const) {
    const updater = fakeUpdater(INSTALLER);
    const { value, record } = deps({ outcome });
    installWithHelper(updater, value);
    updater.quitAndInstall(true, true);
    assert.equal(record.quits, 0, outcome);
    assert.deepEqual(updater.original, [[true, true]], outcome);
    assert.match(record.lines.at(-1) ?? '', outcome === 'failed' ? /\(EACCES\)/ : /\(EINVAL\)/);
    updater.quitAndInstall(true, true);
    assert.equal(record.launches.length, 2, `${outcome}: the next click tries the helper again`);
  }
});

test('the library\'s own path where the helper has nothing to work with', () => {
  assert.equal(helperLaunch(fakeUpdater(null), { platform: 'win32', pid: 1, exe: EXE, logFile: LOG }), 'no downloaded update');
  assert.equal(helperLaunch(fakeUpdater('/tmp/x.AppImage'), { platform: 'linux', pid: 1, exe: '/opt/autark', logFile: '/l' }), 'not started from an AppImage');
  assert.equal(helperLaunch(fakeUpdater('/tmp/x.zip'), { platform: 'darwin', pid: 1, exe: '/a', logFile: '/l' }), 'not Windows or Linux');
  const machineWide = Object.assign(fakeUpdater(INSTALLER), { downloadedUpdateHelper: { packageFile: null, downloadedFileInfo: { isAdminRightsRequired: true } } });
  assert.equal(helperLaunch(machineWide, { platform: 'win32', pid: 1, exe: EXE, logFile: LOG }), 'the install needs administrator rights');
  const updater = fakeUpdater(null);
  const { value, record } = deps();
  installWithHelper(updater, value);
  updater.quitAndInstall(true, true);
  assert.deepEqual(updater.original, [[true, true]]);
  assert.equal(record.launches.length, 0);
});

const shell = spawnSync('sh', ['-c', 'exit 0']).status === 0;

test('Linux script, really run: waits for a gone process, replaces the AppImage, starts it with --updated', { skip: !shell && 'no sh on this PC' }, () => {
  const dir = path.join(tmp, 'linux run').replace(/\\/g, '/'); // Git's sh on Windows takes C:/… paths
  mkdirSync(dir);
  const target = `${dir}/autark-linux-x64.AppImage`;
  const downloaded = `${dir}/pending.AppImage`;
  const out = `${dir}/started.txt`;
  const log = `${dir}/update-helper.log`;
  writeFileSync(target, `#!/bin/sh\necho old > "${out}"\n`);
  writeFileSync(downloaded, `#!/bin/sh\necho "new $*" > "${out}"\n`);
  const gone = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim(); // a process that already ended
  const launch = linuxHelper({ pid: Number(gone), downloaded, appImage: target, logFile: log });
  const run = spawnSync('sh', launch.args, { cwd: dir, timeout: 20_000 });
  assert.equal(run.status, 0, run.stderr.toString());
  assert.equal(existsSync(downloaded), false);
  assert.equal(readFileSync(out, 'utf8').trim(), 'new --updated');
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[2], /replaced; new version starts$/);
});

// Issue #1: the real cmd script, started by a stand-in app the way Autark starts it (spawnHelper), with the app quitting
// right after. The helper must outlive the app (libuv's job object ended a plain child with its parent), run hidden,
// and end on its own both ways. Visible windows cannot be seen from a test; the spawn flags are described in spawnHelper.
const windows = process.platform === 'win32';
const MODULE = pathToFileURL(path.resolve('src/main/updates/install-helper.ts')).href;

/** A stand-in app: starts the helper for its own pid, then lives `stay` ms (like a quit) and ends. */
function standInApp(launchJson: string, logs: string, stay: number) {
  const code = `import { spawnHelper } from ${JSON.stringify(MODULE)};
const launch = JSON.parse(process.env.LAUNCH.replace('"PID_SELF"', JSON.stringify(String(process.pid))));
spawnHelper(launch, ${JSON.stringify(logs)}, { started() { setTimeout(() => process.exit(0), ${stay}); }, failed() { process.exit(2); }, ended() {} });`;
  return spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, LAUNCH: launchJson }, stdio: 'ignore' });
}

async function lastLine(log: string, pattern: RegExp, ms: number): Promise<string[]> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const lines = existsSync(log) ? readFileSync(log, 'utf8').trim().split(/\r?\n/) : [];
    if (pattern.test(lines.at(-1) ?? '')) return lines;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`no final line ${pattern} in ${ms} ms: ${existsSync(log) ? readFileSync(log, 'utf8') : 'no log'}`);
}

test('Windows script, really run: the app quits, the helper outlives it, runs the installer and ends', { skip: !windows && 'Windows only' }, async () => {
  const dir = path.join(tmp, 'win gone Ä');
  mkdirSync(dir);
  const log = path.join(dir, 'update-helper.log');
  // the stand-in installer is a copy of whoami, which rejects --updated and ends at once; the app file is missing on purpose
  const installer = path.join(dir, 'autark-windows-x64.exe');
  copyFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), installer);
  const launch = windowsHelper({ pid: 1, installer, exe: path.join(dir, 'missing', 'Autark.exe'), logFile: log });
  const json = JSON.stringify({ ...launch, env: { ...launch.env, AUTARK_UPDATE_PID: 'PID_SELF', AUTARK_UPDATE_WAIT: '20' } });
  const begun = Date.now();
  standInApp(json, dir, 1500);
  const lines = await lastLine(log, /the app file is missing after the install; nothing to start$/, 25_000);
  assert.ok(Date.now() - begun < 20_000, 'the helper noticed the end of the app and went on');
  assert.match(lines[0]!, /helper started; waiting for the app \(pid \d+\) to end$/);
  assert.match(lines[1]!, /app ended; installer starts$/);
  assert.match(lines[2]!, /installer ended \(exit code \d+\)$/);
  assert.equal(existsSync(path.join(dir, 'update-helper-pids.txt')), false, 'the tasklist file is cleaned up');
});

test('Windows script, really run: an app that keeps running is left alone after the wait, and the helper ends', { skip: !windows && 'Windows only' }, async () => {
  const dir = path.join(tmp, 'win late');
  mkdirSync(dir);
  const log = path.join(dir, 'update-helper.log');
  const launch = windowsHelper({ pid: 1, installer: path.join(dir, 'never-run.exe'), exe: path.join(dir, 'Autark.exe'), logFile: log });
  const json = JSON.stringify({ ...launch, env: { ...launch.env, AUTARK_UPDATE_PID: 'PID_SELF', AUTARK_UPDATE_WAIT: '3' } });
  const app = standInApp(json, dir, 20_000);
  try {
    const lines = await lastLine(log, /the app still runs after 3 s; update left for the next try$/, 15_000);
    assert.equal(lines.length, 2, 'no installer after the wait');
  } finally { app.kill(); }
});

test('Windows: spawnHelper reports the helper ended only after it surely finished waiting', { skip: !windows && 'Windows only' }, async () => {
  const dir = path.join(tmp, 'win ended');
  mkdirSync(dir);
  const log = path.join(dir, 'h.log');
  const launch = windowsHelper({ pid: 1, installer: path.join(dir, 'missing installer.exe'), exe: path.join(dir, 'A.exe'), logFile: log });
  // pid 1 never matches a running process the helper could wait for, so it goes on to the missing installer at once.
  // It must note that and end: start fell back to ShellExecute, whose visible "cannot find" dialog kept cmd alive.
  const timing = await new Promise<number>((resolve, reject) => {
    const begun = Date.now();
    spawnHelper({ ...launch, env: { ...launch.env, AUTARK_UPDATE_WAIT: '0' } }, dir, {
      started: () => undefined, failed: reject, ended: () => resolve(Date.now() - begun),
    });
  });
  assert.ok(timing >= HELPER_MARGIN_SECONDS * 1000 - 500, `ended after ${timing} ms`);
  const lines = await lastLine(log, /the installer is missing; update left for the next try$/, 5_000);
  assert.equal(lines.some(line => /installer starts/.test(line)), false, 'a missing installer is never started');
});
