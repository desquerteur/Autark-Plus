// AF-025: `autark --headless …` on the app's own binary (e.g. the downloaded AppImage): no window, no tray, no
// single-instance lock and no updater – the binary runs itself once more as plain Node (ELECTRON_RUN_AS_NODE) with the
// headless runtime app/runtime-cli.mjs and every argument after the flag, passes Ctrl+C / SIGTERM on and ends with its
// exit code. Chromium in this parent is told to use no display (ozone headless, no GPU), so a server without X/Wayland
// starts it too; the systemd services skip this parent and call the Node mode directly (scripts/install-headless.sh).
// Owns: recognising the flag and that hand-over. Never: starts the desktop, opens a window, or touches the user's data
// folder (the runtime picks its own: runtime/headless/options.ts).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const HEADLESS_FLAG = '--headless';

export function isHeadlessStart(argv: readonly string[]): boolean {
  return argv.includes(HEADLESS_FLAG);
}

/** runtime-cli.mjs of this app (outside app.asar when it is unpacked there) and the arguments for it. */
export function headlessCommand(argv: readonly string[], appPath: string, exists: (file: string) => boolean = existsSync): string[] {
  const packed = path.join(appPath, 'app', 'runtime-cli.mjs');
  const unpacked = packed.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const entry = unpacked !== packed && exists(unpacked) ? unpacked : packed;
  const rest = argv.slice(argv.indexOf(HEADLESS_FLAG) + 1);
  // `autark --headless pair` asks the running one for a new code; anything else starts a headless runtime.
  return rest[0] === 'pair' ? [entry, ...rest] : [entry, HEADLESS_FLAG, ...rest];
}

export interface HeadlessApp {
  getAppPath(): string;
  exit(code: number): void;
  disableHardwareAcceleration(): void;
  commandLine: { appendSwitch(name: string, value?: string): void };
}

/** Starts the Node-mode child and ties this process's end to it. Call before `ready`. */
export function runHeadless(app: HeadlessApp, argv: readonly string[]): void {
  if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'headless');
  app.disableHardwareAcceleration();
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const child = spawn(process.execPath, headlessCommand(argv, app.getAppPath()), { stdio: 'inherit', env, windowsHide: true });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { child.kill(signal); });
  child.once('error', (error) => { console.error('Could not start the headless runtime:', error.message); app.exit(1); });
  child.once('exit', (code, signal) => app.exit(code ?? (signal ? 1 : 0)));
}
