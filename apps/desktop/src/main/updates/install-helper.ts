// Windows and Linux reopen after an update by their own small helper, the way a Mac does (mac-self-update.ts): the app
// writes or names a hidden script, starts it, and quits normally once it runs. The helper waits for this process to
// end, installs, and starts the new version with --updated. Before B-078 NSIS relaunched through Explorer
// (StdUtils.ExecShellAsUser) at the moment Explorer rebuilt its icons, and the Linux AppImage started its successor while
// this process still held the single-instance lock; both could leave the app closed.
//   Windows: a cmd script beside the downloaded installer (electron-updater's pending folder) runs
//     `<installer> --updated /S` with start /wait (no --force-run: the helper starts the app itself) and then
//     `<install dir>\Autark.exe --updated`; one line per step in <userData>/logs/update-helper.log.
//   Linux: /bin/sh moves the downloaded AppImage over $APPIMAGE (mv -f, chmod +x) and execs it with --updated.
// Values reach the cmd script through environment variables, so the script is plain ASCII and a path with spaces,
// umlauts or % needs no quoting. When the helper cannot start, the library's own quitAndInstall runs as before.
//   Windows start, a hand-over (08.11.2026): a detached cmd (DETACHED_PROCESS) has no console, so every console tool it
//     runs (tasklist, find, ping) gets a console of its own instead of the script's redirections; `find` then read
//     that console's keyboard forever, the installer never ran and the app stayed closed. A non-detached child dies
//     with the app (libuv kills its children through a job object when the process ends). So the app starts a hidden
//     cmd (windowsHide: a console without a window) whose only step is `start "" /b cmd /d /c .\update-helper.cmd`:
//     that grandchild shares the hidden console, is outside the job (silent breakaway) and outlives the app. The
//     first cmd's exit code 0 means the helper runs; the helper's own end cannot be watched, so `ended` follows after
//     HANDOFF_LIFETIME_MS, when a helper that found the app still running has given up.
// When the app still runs after WAIT_SECONDS (longer than update-service.ts INSTALL_WATCHDOG_MS, after which the app
// has resumed work), both helpers leave the update for the next try and install nothing; while a helper process lives,
// a further quitAndInstall only quits again (that helper installs once the app ends); its exit frees the next start.
// B-080: a build from a file (app.install / system.install) runs through the same helpers (updates-wiring.ts installFile).
// F25 (16.11.2026): every company updates itself, so the helper starts the company that pressed Update again – its
// `--company=<id>` after --updated (Windows: AUTARK_UPDATE_ARGS, empty for the first company; Linux: the 5th argument);
// that start wakes the companies the install ended (main/index.ts, companies.ts wakeCompanies).
// One install at a time (review 16.11.2026): with an updater in every company two can install at once, and NSIS runs one
// installer – a second one quits at once, and its helper would start the app in the middle of the first install.
// spawnHelper takes the lock folder in the temp folder (mkdir is atomic) when the app asks to install; the helper frees
// it once its installer ended. A company that asks while the folder is there installs nothing: its helper waits until
// the folder is gone (at most LOCK_STALE_MS) and then starts its company. The installer ends every company that still
// runs, so none asks after an install. Linux needs no lock: a second helper's mv finds nothing to move and starts the
// AppImage the first one replaced.
// Owns: the two scripts, their launch values, the install lock, the detached spawn, the quitAndInstall override. Never: imports electron
// (updates-wiring.ts injects quit), drains the app or decides when to restart (update-service.ts), downloads or verifies
// the update (electron-updater did both before 'update-downloaded').

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCompanyId } from '../../shared/model/companies.ts';
import { COMPANY_FLAG } from '../companies.ts';
import type { Updater } from './update-service.ts';

export const HELPER_LOG = 'update-helper.log';
export const WINDOWS_SCRIPT_NAME = 'update-helper.cmd';
/**
 * How long a helper waits for the app to end. The graceful quit takes up to about 15 s; the install watchdog
 * (INSTALL_WATCHDOG_MS, 20 s) resumes the app after its own wait, so a helper that waits longer never installs over
 * a resumed app: it gives up instead (install-helper.test.ts checks the order).
 */
export const WAIT_SECONDS = 45;
/** Windows: a helper has surely ended after three times its wait plus this (a try is ping's second plus tasklist's time). */
export const HELPER_MARGIN_SECONDS = 15;
/** Windows: how long a handed-over helper with a wait of `waitSeconds` lives at most (see spawnHelper). */
export function handoffLifetimeMs(waitSeconds: number = WAIT_SECONDS): number { return (waitSeconds * 3 + HELPER_MARGIN_SECONDS) * 1000; }
/**
 * Windows: after this long a handed-over helper counts as ended. Its wait loop runs WAIT_SECONDS rounds of about
 * 1–2 s (tasklist into a file, find, then ping as the pause), so three times WAIT_SECONDS plus a margin lies safely
 * past its give-up.
 */
export const HANDOFF_LIFETIME_MS = handoffLifetimeMs();
/**
 * The file the Windows wait loop writes tasklist's answer to, beside the script. One per app process: the pending
 * folder is shared by every company, and two companies' helpers may wait at the same time.
 */
export function windowsPidsName(pid: number): string { return `update-helper-pids-${pid}.txt`; }
/** The install lock's folder name in the temp folder: one for every company of this PC's user. */
export const LOCK_NAME = 'autark-install.lock';
/**
 * A lock this old was left by a helper that never ended (a shutdown during the install); the next install takes it over.
 * It lies far past a helper's wait for its app plus a slow install, and it is how long a waiting helper waits at most.
 */
export const LOCK_STALE_MS = 10 * 60_000;
const LOCK_WAIT_ROUNDS = LOCK_STALE_MS / 1000; // one ping pause of about 1 s per round

/**
 * The cmd helper (LF here; windowsHelper() hands it out with CRLF, which cmd's label search needs). The wait loop writes
 * tasklist's answer to a file and lets find read that file: no pipe, so no step waits for an end of input that never
 * comes (issue #1: `tasklist | find` hung in find and the helper never ended). find's exit code: 0 the app still runs,
 * 1 it ended, 2 the file could not be read (counted as a try, never as "ended"). The three programs run by their
 * System32 path: a PATH with Git's usr/bin first finds GNU find, whose exit code 1 read as "the app ended" at once.
 * A missing installer is checked before the install: start would fall back to ShellExecute, whose "cannot find" dialog
 * is visible and keeps the helper alive until someone closes it. The helper is started through a hand-over (see the
 * header and windowsHelper). AUTARK_UPDATE_WAIT shortens the wait for the real-run test only.
 * The new version starts without any AUTARK_UPDATE_* value: an app that kept a helper's values handed stale ones
 * (AUTARK_UPDATE_PACKAGE, AUTARK_UPDATE_AFTER) to its own next helper.
 */
export const WINDOWS_HELPER_SCRIPT = `@echo off
setlocal
if not defined AUTARK_UPDATE_WAIT set AUTARK_UPDATE_WAIT=${WAIT_SECONDS}
call :note "helper started; waiting for the app (pid %AUTARK_UPDATE_PID%) to end"
set /a tries=0
:wait
"%SystemRoot%\\System32\\tasklist.exe" /FI "PID eq %AUTARK_UPDATE_PID%" /NH >"%AUTARK_UPDATE_PIDS%" 2>nul
"%SystemRoot%\\System32\\find.exe" " %AUTARK_UPDATE_PID% " "%AUTARK_UPDATE_PIDS%" >nul 2>nul
if %errorlevel% equ 1 goto gone
set /a tries+=1
if %tries% geq %AUTARK_UPDATE_WAIT% goto late
"%SystemRoot%\\System32\\PING.EXE" -n 2 127.0.0.1 >nul
goto wait
:late
del /q "%AUTARK_UPDATE_PIDS%" >nul 2>nul
if not defined AUTARK_UPDATE_AFTER rmdir "%AUTARK_UPDATE_LOCK%" 2>nul
call :note "the app still runs after %AUTARK_UPDATE_WAIT% s; update left for the next try"
exit /b 3
:gone
del /q "%AUTARK_UPDATE_PIDS%" >nul 2>nul
if defined AUTARK_UPDATE_AFTER goto after
if exist "%AUTARK_UPDATE_INSTALLER%" goto install
rmdir "%AUTARK_UPDATE_LOCK%" 2>nul
call :note "the installer is missing; update left for the next try"
exit /b 4
:install
call :note "app ended; installer starts"
if defined AUTARK_UPDATE_PACKAGE goto package
start "" /wait "%AUTARK_UPDATE_INSTALLER%" --updated /S
goto installed
:package
start "" /wait "%AUTARK_UPDATE_INSTALLER%" --updated /S "--package-file=%AUTARK_UPDATE_PACKAGE%"
:installed
call :note "installer ended (exit code %errorlevel%)"
rmdir "%AUTARK_UPDATE_LOCK%" 2>nul
:launch
if exist "%AUTARK_UPDATE_EXE%" goto run
call :note "the app file is missing after the install; nothing to start"
exit /b 1
:run
set "run_dir=%AUTARK_UPDATE_DIR%"
set "run_exe=%AUTARK_UPDATE_EXE%"
set "run_args=%AUTARK_UPDATE_ARGS%"
set "run_log=%AUTARK_UPDATE_LOG%"
for /f "delims==" %%v in ('set AUTARK_UPDATE_ 2^>nul') do set "%%v="
start "" /D "%run_dir%" "%run_exe%" --updated %run_args%
set "AUTARK_UPDATE_LOG=%run_log%"
call :note "new version started"
exit /b 0
:after
call :note "app ended; another company installs this update, this one starts after it"
set /a tries=0
:other
if not exist "%AUTARK_UPDATE_LOCK%" goto launch
set /a tries+=1
if %tries% geq ${LOCK_WAIT_ROUNDS} goto overdue
"%SystemRoot%\\System32\\PING.EXE" -n 2 127.0.0.1 >nul
goto other
:overdue
call :note "the other install still runs after ${LOCK_STALE_MS / 60_000} min; this company starts anyway"
goto launch
:note
>>"%AUTARK_UPDATE_LOG%" echo %date% %time% %~1
exit /b 0
`;

/**
 * The sh helper, run as `sh -c LINUX_HELPER_SCRIPT autark-update pid downloaded target log`: positional arguments, so
 * no path needs quoting. A process that never ends keeps the downloaded file for a later try; a failed move starts the
 * old AppImage again.
 */
export const LINUX_HELPER_SCRIPT = `pid=$1; downloaded=$2; target=$3; log=$4; company=$5
note() { printf '%s %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$log" 2>/dev/null; }
note "helper started; waiting for the app (pid $pid) to end"
tries=0
while kill -0 "$pid" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt ${WAIT_SECONDS * 2} ]; then note "the app still runs after ${WAIT_SECONDS} s; update left for the next try"; exit 3; fi
  sleep 0.5
done
note "app ended; replacing the AppImage"
if mv -f "$downloaded" "$target"; then
  chmod +x "$target"
  note "replaced; new version starts"
else
  note "replacing failed; the old version starts"
fi
if [ -n "$company" ]; then exec "$target" --updated "$company"; fi
exec "$target" --updated
`;

/** What the spawn gets: one command line, its values and a working folder outside the install folder. */
export interface HelperLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /** Windows: the arguments go to cmd exactly as written (windowsVerbatimArguments). */
  verbatim: boolean;
  /** Windows: the started process only hands over to the helper (start /b) and ends; see the header. */
  handoff: boolean;
  /** Windows: the script text written to args' script file before the spawn. */
  script?: { file: string; text: string };
}

/**
 * F25 (16.11.2026): the company that pressed Update starts again – its `--company=<id>` (main/companies.ts companyArgs;
 * none for the first). Only such a flag passes: it lands unquoted in the cmd line, so nothing else may.
 */
export function companyArg(args: readonly string[] | undefined): string {
  return (args ?? []).find((arg) => arg.startsWith(COMPANY_FLAG) && isCompanyId(arg.slice(COMPANY_FLAG.length))) ?? '';
}

export interface WindowsHelperInput {
  pid: number; installer: string; packageFile?: string | null; exe: string; logFile: string; args?: readonly string[];
  /** The install lock folder; default LOCK_NAME in the temp folder (tests pass their own). */
  lock?: string;
}

/**
 * The cmd helper beside the installer, started by a hidden cmd that hands over to it in the same folder. `.\` because
 * cmd skips the current folder when NoDefaultCurrentDirectoryInExePath is set; no path in the command line, so no quoting.
 */
export function windowsHelper(input: WindowsHelperInput): HelperLaunch {
  const dir = path.win32.dirname(input.installer);
  const file = path.win32.join(dir, WINDOWS_SCRIPT_NAME);
  const env: Record<string, string> = {
    AUTARK_UPDATE_PID: String(input.pid),
    AUTARK_UPDATE_INSTALLER: input.installer,
    AUTARK_UPDATE_EXE: input.exe,
    AUTARK_UPDATE_DIR: path.win32.dirname(input.exe),
    AUTARK_UPDATE_LOG: input.logFile,
    AUTARK_UPDATE_PIDS: path.win32.join(dir, windowsPidsName(input.pid)), // issue #1: tasklist's answer, read by find
    AUTARK_UPDATE_ARGS: companyArg(input.args), // empty for the first company: the line ends with --updated
    AUTARK_UPDATE_LOCK: input.lock ?? path.win32.join(os.tmpdir(), LOCK_NAME),
  };
  if (input.packageFile) env.AUTARK_UPDATE_PACKAGE = input.packageFile;
  return {
    command: 'cmd.exe',
    args: ['/d', '/c', `start "" /b cmd.exe /d /c .\\${WINDOWS_SCRIPT_NAME}`],
    env,
    cwd: dir, // never the install folder: the uninstaller removes that folder
    verbatim: true,
    handoff: true,
    script: { file, text: WINDOWS_HELPER_SCRIPT.replace(/\n/g, '\r\n') },
  };
}

export interface LinuxHelperInput { pid: number; downloaded: string; appImage: string; logFile: string; args?: readonly string[] }

export function linuxHelper(input: LinuxHelperInput): HelperLaunch {
  return {
    command: '/bin/sh',
    args: ['-c', LINUX_HELPER_SCRIPT, 'autark-update', String(input.pid), input.downloaded, input.appImage, input.logFile, companyArg(input.args)],
    env: { APPIMAGE_SILENT_INSTALL: 'true' },
    cwd: path.posix.dirname(input.appImage),
    verbatim: false,
    handoff: false,
  };
}

export interface HelperEvents { started(): void; failed(error: Error): void; ended(): void }

export interface InstallHelperDeps {
  platform: string;
  pid: number;
  /** F25: this company's start arguments (companies.ts companyArgs) – the helper starts it again with them. */
  args?: readonly string[];
  /** process.execPath: <install dir>\Autark.exe on Windows. */
  exe: string;
  /** process.env.APPIMAGE on Linux; without it (not an AppImage) the library's own path stays. */
  appImage?: string;
  logFile: string;
  /** Writes the script, starts the helper detached; calls exactly one of started/failed, and ended when a started helper exits. */
  spawn(launch: HelperLaunch, events: HelperEvents): void;
  quit(): void;
  /** 19.11.2026: ends this process at once (app.exit) when the quit above did not end it within QUIT_MS. */
  exit?(): void;
  log?(line: string): void;
}

/** 19.11.2026: a quit for the install that has not ended the app by then (a quit step threw and the app kept waiting on
 * itself – the owner's PC could not update for hours, and no customer can run commands) ends it hard; the runtime is
 * drained already, and this is shorter than update-service.ts INSTALL_WATCHDOG_MS, which would resume work instead. */
export const QUIT_MS = 12_000;

/** The downloaded file electron-updater 6.8.9 verified (BaseUpdater.installerPath, downloadedUpdateHelper.packageFile). */
function downloaded(updater: Updater): { file: string | null; packageFile: string | null; admin: boolean } {
  const base = updater as Updater & { installerPath?: string | null; downloadedUpdateHelper?: { packageFile?: string | null; downloadedFileInfo?: { isAdminRightsRequired?: boolean } | null } | null };
  const helper = base.downloadedUpdateHelper;
  return { file: base.installerPath ?? null, packageFile: helper?.packageFile ?? null, admin: helper?.downloadedFileInfo?.isAdminRightsRequired === true };
}

/** The launch for this platform, or the reason the library's own path runs. */
export function helperLaunch(updater: Updater, deps: Pick<InstallHelperDeps, 'platform' | 'pid' | 'exe' | 'appImage' | 'logFile' | 'args'>): HelperLaunch | string {
  const { file, packageFile, admin } = downloaded(updater);
  if (!file) return 'no downloaded update';
  if (admin) return 'the install needs administrator rights'; // the library elevates through its elevate.exe
  if (deps.platform === 'win32') return windowsHelper({ pid: deps.pid, installer: file, packageFile, exe: deps.exe, logFile: deps.logFile, args: deps.args });
  if (deps.platform !== 'linux') return 'not Windows or Linux';
  if (!deps.appImage || !path.posix.isAbsolute(deps.appImage)) return 'not started from an AppImage';
  return linuxHelper({ pid: deps.pid, downloaded: file, appImage: deps.appImage, logFile: deps.logFile, args: deps.args });
}

/** Replaces the updater's quitAndInstall on Windows and Linux; the original stays the fallback. */
export function installWithHelper(updater: Updater, deps: InstallHelperDeps): void {
  const original = updater.quitAndInstall.bind(updater);
  let waiting = false; // a helper process lives and waits for this process to end
  const fallback = (isSilent: boolean, isForceRunAfter: boolean, why: string) => {
    deps.log?.(`update helper not used (${why}); the installer relaunches the app`);
    original(isSilent, isForceRunAfter);
  };
  updater.quitAndInstall = (isSilent, isForceRunAfter) => {
    if (waiting) { deps.quit(); return; }
    const launch = helperLaunch(updater, deps);
    if (typeof launch === 'string') { fallback(isSilent, isForceRunAfter, launch); return; }
    let settled = false;
    waiting = true;
    try {
      deps.spawn(launch, {
        started: () => {
          if (settled) return;
          settled = true;
          deps.log?.('update helper started; quitting for the install');
          deps.quit();
          if (deps.exit) setTimeout(() => { deps.log?.('the quit did not end the app; ending it for the install'); deps.exit?.(); }, QUIT_MS).unref?.();
        },
        failed: error => {
          if (settled) return;
          settled = true;
          waiting = false;
          fallback(isSilent, isForceRunAfter, errorCode(error));
        },
        ended: () => {
          waiting = false; // it gave up (the app kept running) or did its work; the next click starts a new one
          deps.log?.('update helper ended');
        },
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      waiting = false;
      fallback(isSilent, isForceRunAfter, errorCode(error));
    }
  };
}

/**
 * Takes the install lock folder (mkdir is atomic); false while another company's helper holds it. A folder older than
 * LOCK_STALE_MS is taken over. Where no folder can be made at all, this helper installs as before.
 */
export function takeInstallLock(lock: string, now = Date.now()): boolean {
  try { mkdirSync(lock); return true; } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== 'EEXIST') return true;
  }
  try {
    if (now - statSync(lock).mtimeMs < LOCK_STALE_MS) return false;
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
    return true;
  } catch { return false; }
}

/**
 * Writes the script, takes the install lock (Windows: held – this helper installs and frees it; not held – it waits for
 * the other install, AUTARK_UPDATE_AFTER), then starts the helper hidden. A helper that does not start frees a held lock.
 * Linux: detached; 'spawn' or 'error' tells which way it went, 'exit' its end. Windows hand-over: not detached (a
 * console without a window); the first cmd's exit 0 means the helper runs.
 */
export function spawnHelper(launch: HelperLaunch, logs: string, events: HelperEvents): void {
  mkdirSync(logs, { recursive: true });
  if (launch.script) writeFileSync(launch.script.file, launch.script.text, 'utf8');
  const lock = launch.env.AUTARK_UPDATE_LOCK;
  let held = lock ? takeInstallLock(lock) : false;
  const release = () => {
    if (!held || !lock) return;
    held = false;
    try { rmSync(lock, { recursive: true, force: true }); } catch { /* taken over after LOCK_STALE_MS */ }
  };
  const failed = (error: Error) => { release(); events.failed(error); };
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: helperEnv({ env: { ...launch.env, ...(lock && !held ? { AUTARK_UPDATE_AFTER: '1' } : {}) } }, process.env),
      detached: !launch.handoff,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: launch.verbatim,
    });
  } catch (error) {
    release();
    throw error;
  }
  if (launch.handoff) {
    child.once('exit', code => {
      if (code !== 0) { failed(Object.assign(new Error('hand-over failed'), { code: `HANDOFF_EXIT_${code ?? 'SIGNAL'}` })); return; }
      // issue #1: a shortened wait (AUTARK_UPDATE_WAIT, the real-run test) ends sooner
      const wait = launch.env.AUTARK_UPDATE_WAIT;
      setTimeout(() => events.ended(), wait ? handoffLifetimeMs(Number(wait)) : HANDOFF_LIFETIME_MS).unref();
      events.started();
    });
    child.once('error', failed);
    return;
  }
  child.once('spawn', () => {
    child.unref(); // unref keeps no event loop alive; 'exit' still arrives while this process runs
    child.once('exit', () => events.ended());
    events.started();
  });
  child.once('error', failed);
}

/**
 * The helper's environment: this process's without any AUTARK_UPDATE_* it inherited, plus the launch's own values. An
 * app that an older helper started carries that helper's values (AUTARK_UPDATE_INNER=1 made the new helper skip its way
 * out of the job; AUTARK_UPDATE_PACKAGE named a package that is gone), so only this launch's values reach the script.
 */
export function helperEnv(launch: Pick<HelperLaunch, 'env'>, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) if (!/^AUTARK_UPDATE_/i.test(key)) env[key] = value;
  return { ...env, ...launch.env };
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'spawn failed';
}
