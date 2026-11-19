// AF-025: the headless start (`runtime-cli --headless`, the Linux server/desktop service): its data folder and options.
// A headless runtime never shares the desktop app's folder: the app keeps its secrets with the OS keyring (Electron
// safeStorage), the headless host with a key file (host-node.ts), so each could not read the other's secrets – and two
// runtimes on one database would both run the agents. The default is therefore a folder of its own:
// Linux $XDG_DATA_HOME/autark (~/.local/share/autark), macOS ~/Library/Application Support/Autark Headless,
// Windows %LOCALAPPDATA%\Autark Headless. `--data` always wins (the system service passes /var/lib/autark).
// Owns: parsing the headless flags and these defaults. Never: touches files or starts anything.

import path from 'node:path';

export type Bind = 'localhost' | 'lan' | 'tailscale';
export const BINDS: readonly Bind[] = ['localhost', 'lan', 'tailscale'];

export interface HeadlessEnv {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}

export interface HeadlessOptions {
  dataDir: string;
  /** Who reaches the web access (settings pwa.bind); undefined keeps the saved choice. */
  bind?: Bind;
  /** Show a pairing link and code at the start while no phone or browser is paired yet (`--no-pair` turns it off). */
  pair: boolean;
}

/** The headless runtime's own data folder for this OS user (see the file comment). */
export function headlessDataDir(input: HeadlessEnv): string {
  if (input.platform === 'win32') {
    const base = input.env.LOCALAPPDATA?.trim() || path.win32.join(input.home, 'AppData', 'Local');
    return path.win32.join(base, 'Autark Headless');
  }
  if (input.platform === 'darwin') return path.posix.join(input.home, 'Library', 'Application Support', 'Autark Headless');
  const xdg = input.env.XDG_DATA_HOME?.trim();
  return path.posix.join(xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(input.home, '.local', 'share'), 'autark');
}

/** Value of `--name <value>` in argv (undefined when absent or when the next word is another flag). */
export function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value === undefined || value.startsWith('--') ? undefined : value;
}

/** The headless options from argv; an error text for a wrong `--bind`. */
export function headlessOptions(argv: readonly string[], input: HeadlessEnv): HeadlessOptions | { error: string } {
  const bind = flagValue(argv, 'bind');
  if (argv.includes('--bind') && !BINDS.includes(bind as Bind)) return { error: `--bind takes ${BINDS.join(', ')}.` };
  const data = flagValue(argv, 'data');
  const flavor = input.platform === 'win32' ? path.win32 : path.posix;
  return {
    dataDir: data ? flavor.resolve(data) : headlessDataDir(input),
    ...(bind ? { bind: bind as Bind } : {}),
    pair: !argv.includes('--no-pair'),
  };
}
