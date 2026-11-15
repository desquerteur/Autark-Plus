// Owns: start nonblocking broker reconciliation at each interactive packaged Windows launch.
// The script verifies protected image/hash, key ACL and service state; only a mismatch requests UAC.
// Never: treats key existence as proof of installation, changes the service itself, or asks in background/test mode.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

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
  start?(command: string, args: string[]): void;
  log?(line: string): void;
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
  try {
    (deps.start ?? ((command, list) => spawn(command, list, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()))(powershell, args);
  } catch { return false; }
  deps.log?.('desktop broker reconciliation started; Windows elevation is requested if installation or repair is needed');
  return true;
}
