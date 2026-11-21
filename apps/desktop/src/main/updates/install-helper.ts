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
// When the app still runs after WAIT_SECONDS (longer than update-service.ts INSTALL_WATCHDOG_MS, after which the app
// has resumed work), both helpers leave the update for the next try and install nothing; while a helper process lives,
// a further quitAndInstall only quits again (that helper installs once the app ends); its exit frees the next start.
// Owns: the two scripts, their launch values, the detached spawn, the quitAndInstall override. Never: imports electron
// (updates-wiring.ts injects quit), drains the app or decides when to restart (update-service.ts), downloads or verifies
// the update (electron-updater did both before 'update-downloaded').

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
/** The file the Windows wait loop writes tasklist's answer to, beside the script. */
export const WINDOWS_PIDS_NAME = 'update-helper-pids.txt';

/**
 * The cmd helper (LF here; windowsHelper() hands it out with CRLF, which cmd's label search needs). The wait loop writes
 * tasklist's answer to a file and lets find read that file: no pipe, so no step waits for an end of input that never
 * comes (issue #1: `tasklist | find` hung in find and the helper never ended). find's exit code: 0 the app still runs,
 * 1 it ended, 2 the file could not be read (counted as a try, never as "ended"). The three programs run by their
 * System32 path: a PATH with Git's usr/bin first finds GNU find, whose exit code 1 read as "the app ended" at once.
 * A missing installer is checked first: start would fall back to ShellExecute, whose "cannot find" dialog is visible
 * and keeps the helper alive until someone closes it.
 * The first run only starts the script again with start /b and ends: see spawnHelper for why. AUTARK_UPDATE_WAIT
 * shortens the wait for the real-run test only. The new version starts without any AUTARK_UPDATE_* value: it used to
 * inherit AUTARK_UPDATE_INNER=1, so its own next helper skipped the start /b, stayed in the job and died with the app.
 */
export const WINDOWS_HELPER_SCRIPT = `@echo off
setlocal
if defined AUTARK_UPDATE_INNER goto main
set AUTARK_UPDATE_INNER=1
start "" /b "%SystemRoot%\\System32\\cmd.exe" /d /s /c ""%~f0""
exit /b 0
:main
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
call :note "the app still runs after %AUTARK_UPDATE_WAIT% s; update left for the next try"
exit /b 3
:gone
del /q "%AUTARK_UPDATE_PIDS%" >nul 2>nul
if exist "%AUTARK_UPDATE_INSTALLER%" goto install
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
if exist "%AUTARK_UPDATE_EXE%" goto run
call :note "the app file is missing after the install; nothing to start"
exit /b 1
:run
set "run_dir=%AUTARK_UPDATE_DIR%"
set "run_exe=%AUTARK_UPDATE_EXE%"
set "run_log=%AUTARK_UPDATE_LOG%"
for /f "delims==" %%v in ('set AUTARK_UPDATE_ 2^>nul') do set "%%v="
start "" /D "%run_dir%" "%run_exe%" --updated
set "AUTARK_UPDATE_LOG=%run_log%"
call :note "new version started"
exit /b 0
:note
>>"%AUTARK_UPDATE_LOG%" echo %date% %time% %~1
exit /b 0
`;

/**
 * The sh helper, run as `sh -c LINUX_HELPER_SCRIPT autark-update pid downloaded target log`: positional arguments, so
 * no path needs quoting. A process that never ends keeps the downloaded file for a later try; a failed move starts the
 * old AppImage again.
 */
export const LINUX_HELPER_SCRIPT = `pid=$1; downloaded=$2; target=$3; log=$4
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
  /** Windows: the script text written to args' script file before the spawn. */
  script?: { file: string; text: string };
}

export interface WindowsHelperInput { pid: number; installer: string; packageFile?: string | null; exe: string; logFile: string }

/** The cmd helper beside the installer; cmd runs it as `/d /s /c ""<script>""` (the outer quotes are cmd's own). */
export function windowsHelper(input: WindowsHelperInput): HelperLaunch {
  const dir = path.win32.dirname(input.installer);
  const file = path.win32.join(dir, WINDOWS_SCRIPT_NAME);
  const env: Record<string, string> = {
    AUTARK_UPDATE_PID: String(input.pid),
    AUTARK_UPDATE_INSTALLER: input.installer,
    AUTARK_UPDATE_EXE: input.exe,
    AUTARK_UPDATE_DIR: path.win32.dirname(input.exe),
    AUTARK_UPDATE_LOG: input.logFile,
    AUTARK_UPDATE_PIDS: path.win32.join(dir, WINDOWS_PIDS_NAME),
  };
  if (input.packageFile) env.AUTARK_UPDATE_PACKAGE = input.packageFile;
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', `""${file}""`],
    env,
    cwd: dir, // never the install folder: the uninstaller removes that folder
    verbatim: true,
    script: { file, text: WINDOWS_HELPER_SCRIPT.replace(/\n/g, '\r\n') },
  };
}

export interface LinuxHelperInput { pid: number; downloaded: string; appImage: string; logFile: string }

export function linuxHelper(input: LinuxHelperInput): HelperLaunch {
  return {
    command: '/bin/sh',
    args: ['-c', LINUX_HELPER_SCRIPT, 'autark-update', String(input.pid), input.downloaded, input.appImage, input.logFile],
    env: { APPIMAGE_SILENT_INSTALL: 'true' },
    cwd: path.posix.dirname(input.appImage),
    verbatim: false,
  };
}

export interface HelperEvents { started(): void; failed(error: Error): void; ended(): void }

export interface InstallHelperDeps {
  platform: string;
  pid: number;
  /** process.execPath: <install dir>\Autark.exe on Windows. */
  exe: string;
  /** process.env.APPIMAGE on Linux; without it (not an AppImage) the library's own path stays. */
  appImage?: string;
  logFile: string;
  /** Writes the script, starts the helper detached; calls exactly one of started/failed, and ended when a started helper exits. */
  spawn(launch: HelperLaunch, events: HelperEvents): void;
  quit(): void;
  log?(line: string): void;
}

/** The downloaded file electron-updater 6.8.9 verified (BaseUpdater.installerPath, downloadedUpdateHelper.packageFile). */
function downloaded(updater: Updater): { file: string | null; packageFile: string | null; admin: boolean } {
  const base = updater as Updater & { installerPath?: string | null; downloadedUpdateHelper?: { packageFile?: string | null; downloadedFileInfo?: { isAdminRightsRequired?: boolean } | null } | null };
  const helper = base.downloadedUpdateHelper;
  return { file: base.installerPath ?? null, packageFile: helper?.packageFile ?? null, admin: helper?.downloadedFileInfo?.isAdminRightsRequired === true };
}

/** The launch for this platform, or the reason the library's own path runs. */
export function helperLaunch(updater: Updater, deps: Pick<InstallHelperDeps, 'platform' | 'pid' | 'exe' | 'appImage' | 'logFile'>): HelperLaunch | string {
  const { file, packageFile, admin } = downloaded(updater);
  if (!file) return 'no downloaded update';
  if (admin) return 'the install needs administrator rights'; // the library elevates through its elevate.exe
  if (deps.platform === 'win32') return windowsHelper({ pid: deps.pid, installer: file, packageFile, exe: deps.exe, logFile: deps.logFile });
  if (deps.platform !== 'linux') return 'not Windows or Linux';
  if (!deps.appImage || !path.posix.isAbsolute(deps.appImage)) return 'not started from an AppImage';
  return linuxHelper({ pid: deps.pid, downloaded: file, appImage: deps.appImage, logFile: deps.logFile });
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
 * Writes the script, then starts the helper hidden; 'spawn' or 'error' tells which way it went, 'exit' its end.
 * Windows (issue #1): not detached. Node's detached is DETACHED_PROCESS, which leaves cmd without any console, so every
 * console program it ran (tasklist, find, ping) opened a new, visible console window. Without it, windowsHide gives cmd
 * CREATE_NO_WINDOW: a console that is never shown, which those programs share. A child that is not detached sits in
 * libuv's job object, which ends it together with this process; the job allows silent breakaway, so the script starts
 * itself once more with start /b (same hidden console, outside the job) and this first cmd ends at once. Its end says
 * nothing about the helper's, so ended() comes once the helper has surely finished waiting (wait + a margin), or at
 * once when the first cmd failed. Linux: detached (its own session), and ended() on its exit, as before.
 */
export function spawnHelper(launch: HelperLaunch, logs: string, events: HelperEvents, platform: string = process.platform): void {
  mkdirSync(logs, { recursive: true });
  if (launch.script) writeFileSync(launch.script.file, launch.script.text, 'utf8');
  const windows = platform === 'win32';
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: helperEnv(launch, process.env),
    detached: !windows,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: launch.verbatim,
  });
  child.once('spawn', () => {
    child.unref(); // unref keeps no event loop alive; 'exit' still arrives while this process runs
    child.once('exit', code => {
      if (!windows || code !== 0) { events.ended(); return; }
      const wait = Number(launch.env.AUTARK_UPDATE_WAIT ?? WAIT_SECONDS);
      setTimeout(() => events.ended(), (wait * 3 + HELPER_MARGIN_SECONDS) * 1000).unref();
    });
    events.started();
  });
  child.once('error', error => events.failed(error));
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
