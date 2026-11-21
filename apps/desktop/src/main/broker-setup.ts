// Owns: start nonblocking broker reconciliation at each interactive packaged Windows launch, and how it ended
// (F03, 16.11.2026: its exit code – 0 installed, 1223 the Windows prompt got no Yes, anything else failed – is logged and
// reported, so main hands it to the runtime as 'broker.setup' and the computer tools can say why the secure desktop is out of reach).
// The script verifies protected image/hash, key ACL and service state; only a mismatch requests UAC.
// Never: treats key existence as proof of installation, changes the service itself, waits for the script, or asks in background/test mode.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { EventMap } from '../shared/api/events.ts';

export type BrokerSetup = EventMap['broker.setup'];

/** install.ps1's exit code when the person answered the Windows prompt with No (ERROR_CANCELLED). */
export const DECLINED_EXIT = 1223;

/** The started script, as far as its end is concerned (a ChildProcess). */
export interface BrokerChild {
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** How the setup ended, from the script's exit code (null: it ended without one, e.g. killed). */
export function setupResult(code: number | null, script: string): BrokerSetup {
  if (code === 0) return { state: 'installed', script };
  if (code === DECLINED_EXIT) return { state: 'declined', script };
  return { state: 'failed', ...(code !== null ? { code } : {}), script };
}

const SETUP_LOG: Record<BrokerSetup['state'], string> = {
  installed: 'desktop broker setup: installed and running',
  declined: 'desktop broker setup: the Windows prompt got no Yes – the secure desktop stays out of reach until the next start or a new run of install.ps1',
  failed: 'desktop broker setup failed',
};

export interface BrokerSetupDeps {
  platform: string;
  packaged: boolean;
  testMode: boolean;
  background: boolean;
  /** The app root (…\resources\app.asar when packaged); the script lives unpacked beside it. */
  root: string;
  /** Autark.exe (its firewall rule). */
  exe: string;
  env?: NodeJS.ProcessEnv;
  exists?(file: string): boolean;
  /** Starts the script detached; the child it returns tells how it ended. */
  start?(command: string, args: string[]): BrokerChild | undefined;
  log?(line: string): void;
  /** How the setup ended (main forwards it to the runtime as 'broker.setup'). */
  report?(setup: BrokerSetup): void;
}

/** True when the broker's setup was started now. */
export function setupBroker(deps: BrokerSetupDeps): boolean {
  if (deps.platform !== 'win32' || !deps.packaged || deps.testMode || deps.background) return false;
  const exists = deps.exists ?? existsSync;
  const env = deps.env ?? process.env;
  // The script reconciles image hash, protected path and running service before deciding whether UAC is needed.
  // A key alone cannot prove migration or an executable update completed.
  const script = path.win32.join(deps.root, 'resources', 'broker', 'install.ps1').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  if (!exists(script)) return false;
  const powershell = path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-AppExe', deps.exe];
  let child: BrokerChild | undefined;
  try {
    child = (deps.start ?? startDetached)(powershell, args);
  } catch { return false; }
  deps.log?.('desktop broker reconciliation started; Windows elevation is requested if installation or repair is needed');
  let ended = false;
  const end = (setup: BrokerSetup, detail?: string) => {
    if (ended) return;
    ended = true;
    deps.log?.(`${SETUP_LOG[setup.state]}${setup.code !== undefined ? ` (exit ${setup.code})` : ''}${detail ? `: ${detail}` : ''}`);
    deps.report?.(setup);
  };
  child?.on('exit', (code) => end(setupResult(code, script)));
  child?.on('error', (error) => end({ state: 'failed', script }, error.message)); // also keeps a spawn error from throwing
  return true;
}

/** Detached and hidden; the app never waits for it, but hears its exit while it runs. */
function startDetached(command: string, args: string[]): BrokerChild {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return child;
}
