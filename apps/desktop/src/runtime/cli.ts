// Headless runtime (bundled to app/runtime-cli.mjs): worker PCs without the desktop app,
// Linux servers and background services (AF-025), development and end-to-end tests.
//   node app/runtime-cli.mjs --data <dir> [--workspace <dir>] [--resources <dir>] [--ui <dir>] [--port <n>] [--peer lan|tailscale|off] [--fake] [--log]
//   node app/runtime-cli.mjs --headless [--data <dir>] [--bind localhost|lan|tailscale] [--no-pair] [the options above]
//   node app/runtime-cli.mjs pair [--data <dir>]
// The packaged app runs it with its own binary as Node: ELECTRON_RUN_AS_NODE=1 autark <app>/app/runtime-cli.mjs … – no
// window, no display (headless/options.ts, docs/headless-linux.md).
// --workspace (or WORKFORCE_WORKSPACE): the agents' files; default ~/Workforce, but <data>/workspace with
// --fake, so tests and demos never write into the person's real workspace.
// --peer: where linked PCs may reach this PC (default settings.devices.peer, 'lan'); not saved.
// Without --headless: prints one JSON line {port, token} on stdout when ready (also written to <data>/runtime.json).
// AF-025 --headless: --data defaults to the headless folder (headless/options.ts), a second runtime on that folder stops
// with exit code 3 (headless/guard.ts), and instead of the token line a banner names the web addresses and, while
// nothing is paired, a one-time pairing link and code (headless/announce.ts). `pair` prints a new link and code.
// Owns: argument parsing, the node host and signal handling. Never: runs without a data dir, or prints the token in
// headless mode (a service's stdout ends up in its journal).

import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeHost } from './host-node.ts';
import { createRuntime } from './main.ts';
import { announceStart } from './headless/announce.ts';
import { EXIT_ALREADY_RUNNING, runningRuntime } from './headless/guard.ts';
import { headlessOptions } from './headless/options.ts';
import { pairCommand } from './headless/pair-command.ts';
import { qrTerminal } from './pwa/qr.ts';

declare const __APP_VERSION__: string | undefined;

type PeerMode = 'lan' | 'tailscale' | 'off';
const PEER_MODES: readonly string[] = ['lan', 'tailscale', 'off'];
const USAGE = [
  'usage: runtime-cli --data <dir> [--workspace <dir>] [--resources <dir>] [--ui <dir>] [--port <n>] [--peer lan|tailscale|off] [--fake] [--log]',
  '       runtime-cli --headless [--data <dir>] [--bind localhost|lan|tailscale] [--no-pair] [--port <n>] [--peer …] [--log]',
  '       runtime-cli pair [--data <dir>]',
].join('\n');
/** What the person types for a new code (the installed wrapper; AUTARK_PAIR_COMMAND lets it name itself). */
const PAIR_COMMAND = process.env.AUTARK_PAIR_COMMAND || 'autark-headless pair';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const tty = Boolean(process.stdout.isTTY);
  if (argv[0] === 'pair') {
    process.exit(await pairCommand(argv.slice(1), {
      platform: process.platform, env: process.env, home: os.homedir(),
      print: (line) => console.log(line), error: (line) => console.error(line), now: Date.now, qr: tty ? qrTerminal : undefined,
    }));
  }
  const headless = argv.includes('--headless');
  const options = headless ? headlessOptions(argv, { platform: process.platform, env: process.env, home: os.homedir() }) : undefined;
  if (options && 'error' in options) {
    console.error(options.error);
    console.error(USAGE);
    process.exit(2);
  }
  const dataDir = options?.dataDir ?? arg('data');
  const peer = arg('peer');
  if (!dataDir || (process.argv.includes('--peer') && !PEER_MODES.includes(peer ?? ''))) {
    console.error(USAGE);
    process.exit(2);
  }
  if (headless) {
    const other = await runningRuntime(path.resolve(dataDir));
    if (other) {
      console.error(`Autark already runs on ${dataDir} (pid ${other.pid ?? '?'}, port ${other.port}). Stop it first, or pass another --data folder.`);
      process.exit(EXIT_ALREADY_RUNNING);
    }
  }
  const here = path.dirname(fileURLToPath(import.meta.url)); // app/ when bundled
  const appRoot = path.resolve(here, '..');
  const resourcesDir = path.resolve(arg('resources') ?? path.join(appRoot, 'resources'));
  const staticDir = path.resolve(arg('ui') ?? path.join(appRoot, 'app', 'ui'));
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  const token = process.env.WORKFORCE_TOKEN || randomBytes(32).toString('hex');
  const fake = process.argv.includes('--fake');
  const workspace = arg('workspace') ?? process.env.WORKFORCE_WORKSPACE ?? (fake ? path.join(dataDir, 'workspace') : undefined);
  const host = createNodeHost({ dataDir: path.resolve(dataDir), resourcesDir, version, onNotify: (input) => console.error(`[notify] ${input.title}: ${input.body}`) });
  const runtime = await createRuntime({
    host, dataDir: path.resolve(dataDir), resourcesDir, staticDir, launchToken: token, version,
    workspaceDir: workspace ? path.resolve(workspace) : undefined,
    fakeEngine: fake, port: arg('port') ? Number(arg('port')) : undefined,
    peer: peer as PeerMode | undefined, consoleLog: process.argv.includes('--log'),
  });
  const stop = () => { void runtime.shutdown('signal').finally(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (!options) {
    process.stdout.write(`${JSON.stringify({ port: runtime.port, token })}\n`);
    return;
  }
  const s = runtime.services;
  try {
    const lines = await announceStart({
      pwa: runtime.network.pwa,
      bind: () => s.settings.get().pwa.bind,
      remoteId: () => runtime.network.extras.remote?.state().self.remoteId,
      qr: tty ? qrTerminal : undefined,
      now: () => s.clock.now(),
    }, { version, dataDir: path.resolve(dataDir), bind: options.bind, pair: options.pair, pairCommand: PAIR_COMMAND });
    for (const line of lines) console.log(line);
  } catch (error) { // the runtime runs on; only the banner is missing
    console.error(`Autark runs headless on port ${runtime.port}, but the pairing banner failed: ${error instanceof Error ? error.message : error}`);
  }
}

main().catch((error) => {
  console.error('runtime failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
