// The runtime composition root: builds all services (compose/services.ts) and the client-
// facing network (compose/network.ts), runs crash/restart reconciliation, starts the event-
// driven parts (scheduler timer, account monitor, peer listener, sync and mesh, catalog, chat bridges, the owner's default
// 1:1 with every agent – chat/direct.ts keepOwnerDirects – and, B-080, last of all the dispatcher, right before 'ready')
// and shuts everything down in order. A staged restore is applied before the database opens. Used by the Electron utility process (entry-electron.ts) and the
// headless CLI (cli.ts) alike. The restore call and the stop steps live in compose/lifecycle.ts.
// Owns: the start order, what a host power event restarts (afterPower) and when the stop runs. Never: business logic; never polls.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ClientScope } from '../shared/api/protocol.ts';
import type { PowerEvent } from '../shared/api/host-bridge.ts';
import type { RuntimeServices } from './contracts.ts';
import type { Host } from './host.ts';
import type { RpcConnection } from './rpc/connection.ts';
import { createPaths, ensurePaths } from './system/paths.ts';
import { FileLogger } from './system/log.ts';
import { systemClock } from './system/clock.ts';
import { createCore, type Core } from './compose/services.ts';
import { createNetwork, type Network } from './compose/network.ts';
import { restoreAtStart, runStopSteps, stopSteps } from './compose/lifecycle.ts';
import { keepOwnerDirects } from './chat/direct.ts';
import { recordStart } from './tasks/recover-notes.ts';
import { AgentRepo } from './store/agents.ts'; // B-059 #21
import { recoveryRuns } from './splits/reconcile.ts'; // B-057
import { reviewPromptOverrides } from './context/prompt-updates.ts';
import { startStandards } from './org/standard.ts';
import { runKontext1311 } from './bridge/kontext-1311.ts';
import { runB078Repairs } from './system/b078-repairs.ts';
import { startSync } from './devices/sync/service.ts';
import { wakeWhenBack } from './devices/back-wake.ts';
import { endCallsLeftOpen } from './calls/wiring.ts';
import { ensurePwsh } from './accounts/install.ts'; // B-080 wave 3
import { keepClaudeCodeCurrent } from './engines/claude/cli-update.ts'; // a provider's new Claude model comes with a new Claude Code

export interface RuntimeOptions {
  host: Host;
  dataDir: string;
  resourcesDir: string; // shipped resources (agents, modes, skills, prompts, model priors)
  staticDir: string; // built UI (app/ui) served to the PWA/phone
  workspaceDir?: string;
  launchToken: string;
  version: string;
  fakeEngine?: boolean;
  port?: number;
  consoleLog?: boolean;
  /** Peer listener mode for this process (CLI `--peer lan|tailscale|off`); default settings.devices.peer. */
  peer?: 'lan' | 'tailscale' | 'off';
}

export interface Runtime {
  services: RuntimeServices;
  core: Core;
  network: Network;
  port: number;
  /** Serves owner-scope (or device-scope) RPC on a connection (MessagePort, test pipe …). */
  attach(connection: RpcConnection, scope?: ClientScope): () => void;
  shutdown(reason: 'quit' | 'update' | 'signal'): Promise<void>;
}

export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const startedAt = Date.now();
  const paths = ensurePaths(createPaths({ data: options.dataDir, resources: options.resourcesDir, workspace: options.workspaceDir }));
  const log = new FileLogger({ dir: paths.logs, clock: systemClock, console: options.consoleLog ?? false });
  log.info('runtime starting', { version: options.version, host: options.host.kind });
  // A restore staged by system.restore replaces the data now – before createCore opens the
  // database; a v2 backup's skills go back into the workspace (MM8).
  await restoreAtStart(paths, log, options.host);

  let port = 0;
  const core = await createCore({ host: options.host, paths, log, version: options.version, fakeEngine: options.fakeEngine, baseUrl: () => `http://127.0.0.1:${port}` });
  const s = core.services;
  const network = createNetwork({ core, staticDir: options.staticDir, launchToken: options.launchToken, startedAt, port: options.port, peer: options.peer });

  // Linked PCs share chats, tasks, agents, settings, files and secrets (devices/sync) – idle while no PC is linked. Its
  // listeners come first, so what the reconciliation changes (a run's row stopped or removed) travels like any change;
  // the link-ups follow the mesh below.
  const watcher = s.rootWatcher;
  const sync = startSync({ s, mesh: core.mesh, tap: watcher ? (listener) => watcher.tap(listener) : undefined });
  const offBackWake = wakeWhenBack(s); // B-080: an agent that could not reach a linked PC is woken once when it is back

  // ---- reconciliation after a crash, update or power loss (before anything runs)
  const stopped = s.chats.reconcileStreaming();
  const calls = endCallsLeftOpen(s); // B-075: a call left open at a stop or crash ends at its last line, and that travels
  const runs = s.runs.reconcile();
  const wakes = s.wakes.reconcile();
  // B-059 #21: no turn runs yet – a 'working'/'waiting' status and step note left from before are stale.
  let idled = 0;
  try { idled = new AgentRepo(s.db).resetBusy(s.clock.now()); } catch (error) { log.warn('agent statuses not reset', { error: String(error) }); }
  log.info('reconciled', { streaming: stopped, calls, interruptedRuns: runs.interrupted, unknownEffects: runs.unknownEffects, wakes, idled });
  // C3: human/external messages a crash left without a wake (e.g. during the responder decision) are delivered once more.
  try { log.info('redelivered unanswered messages', { messages: s.delivery.recover?.() ?? 0 }); } catch (error) { log.warn('message redelivery failed', { error: String(error) }); }
  try {
    const legacy = await network.extras.importLegacy();
    if (legacy.chats || legacy.agents) log.info('imported legacy data', legacy);
  } catch (error) { log.warn('legacy import failed', { error: String(error) }); }
  // First run: the Manager. B-050 K1 (Nachtrag Runde 4): the owner's default 1:1 with every active agent – the Manager's
  // is the first chat (untitled: named after the agent), so the person can start talking right away – is made now for
  // those without one (one transaction; empty, unread nothing, wakes nobody), and for a hire as the org announces it.
  s.org.ensureSeed();
  const offDirects = keepOwnerDirects(s);
  runB078Repairs(s); // data from before B-078 brought to its rules once (system/b078-repairs.ts)
  runKontext1311(s); // the one-time conversions of the 13.11.2026 context rebuild (deleted in the version after the bridge)
  reviewPromptOverrides(s); // an own prompt file follows the release while untouched; an edited one gets one review
  s.prompts?.invalidate();
  const offStandards = startStandards(s); // every SYSTEM.md keeps the team's standard as its last comment (owner 14.11.2026)
  // Demo/test mode: one account served by the deterministic fake engine, so the app works offline.
  if (options.fakeEngine && !s.accounts.list().some((account) => account.provider === 'compatible')) {
    await s.accounts.add({ provider: 'compatible', label: 'Demo engine', baseUrl: 'http://127.0.0.1:9/v1', demoEngine: true });
  }
  // B-057: a split's cut run is its part's (put back by splits/reconcile.ts) – no recovery note wakes its main self.
  const continued = s.ownership.recover({ interruptedRuns: recoveryRuns(s.runs, runs.runIds) });
  // RC1: one notice after an update or a crash ("Updated to X · N tasks continued"), read by system.info.
  try { recordStart(s, { version: options.version, interrupted: runs.interrupted, continued }); } catch (error) { log.warn('start notice not stored', { error: String(error) }); }

  // ---- serve
  const listening = await network.http.listen();
  port = listening.port;
  writeRuntimeInfo(paths.data, port, options.launchToken);

  // ---- start the event-driven parts
  core.scheduler.start();
  core.accountMonitor.start(); // initial read, provider pushes and bounded automatic refreshes
  // The peer listener opens when a PC is linked or this PC accepts connect requests (a bind error shows in Settings › Devices).
  await network.peer.start();
  core.mesh.start(); // dials every linked PC; a newly connected PC is stored and dialled by the mesh itself
  // The peer listener (re)opened: linked PCs may reach this PC again – dial them now.
  const offPeerOpened = network.peer.onOpened(() => core.mesh.reconnect());
  core.catalog.start();
  network.bridges.start(); // chat bridges resume once the HTTP server listens
  void network.announceCaps().catch((error: unknown) => log.warn('device caps not announced', { error: String(error) }));
  // Detection runs CLI status commands – in the background, then the model catalog follows.
  // Adopted logins are checked by the monitor; after detection the monitor reads any plan that is due.
  void core.refreshDetection().then(() => { core.accountMonitor.activity(); return core.catalog.refresh(); }).catch((error) => log.warn('initial catalog refresh failed', { error: String(error) }));

  // Claude Code learns new models with new versions: it updates itself shortly after start and every 6 h, then the catalog lists again.
  const offClaudeUpdate = keepClaudeCodeCurrent({
    supervisor: core.supervisor, finder: core.finder, log, demo: options.fakeEngine, cwd: paths.temp,
    onUpdated: () => void core.catalog.refresh({ force: true }).catch(() => undefined),
  });

  const powerOff = options.host.onPower((event) => afterPower(event, {
    scheduler: s.scheduler, mesh: core.mesh, monitor: core.accountMonitor, refreshPeer: () => void network.peer.refresh(),
  }));

  let closing: Promise<void> | undefined;
  const runtime: Runtime = {
    services: s,
    core,
    network,
    port,
    attach: (connection, scope = { kind: 'owner' }) => network.rpc.attach(connection, scope),
    shutdown: (reason) => (closing ??= (async () => {
      log.info('runtime stopping', { reason });
      powerOff();
      offClaudeUpdate();
      offDirects();
      offStandards();
      offPeerOpened();
      sync.stop();
      offBackWake();
      await runStopSteps(stopSteps(core, network), log);
      log.info('runtime stopped', { reason });
    })()),
  };
  // B-080: turns start only now, right before 'ready' – the host's boot watchdog (main/runtime-host.ts) never cuts one it
  // started during the slower start steps above (the peer listener took up to 11 s); start() pumps every due agent.
  core.dispatcher.start();
  log.info('runtime ready', { port, ms: Date.now() - startedAt });
  // B-080 wave 3: PowerShell 7 for the engines' shells where none is found (accounts/install.ts ensurePwsh) – in the
  // background, nothing waits for it; the engines started from now on find it on their PATH (engines/wf-shim.ts).
  if (process.platform === 'win32') {
    void ensurePwsh({ supervisor: core.supervisor, demo: options.fakeEngine })
      .then((installed) => { if (installed) log.info('PowerShell 7 installed for the engines\' shells'); })
      .catch((error: unknown) => log.warn('PowerShell 7 not installed', { error: String(error) }));
  }
  return runtime;
}

/**
 * What a host power event restarts: resume/unlock (the person is back) – the scheduler's timer, the links to
 * linked PCs, the peer listener and the plan readings; B-044 'online' (the app window's network came back) –
 * the links and the plan readings. Suspend and lock change nothing here.
 */
export function afterPower(event: PowerEvent, parts: {
  scheduler: Pick<RuntimeServices['scheduler'], 'arm'>; mesh: Pick<Core['mesh'], 'reconnect'>; monitor: Pick<Core['accountMonitor'], 'resume'>; refreshPeer(): void;
}): void {
  if (event === 'resume' || event === 'unlock') { parts.scheduler.arm(); parts.mesh.reconnect(); parts.refreshPeer(); parts.monitor.resume(); }
  if (event === 'online') { parts.mesh.reconnect(); parts.monitor.resume(); }
}

/** Local discovery for the CLI/tests (owner token, loopback port). 0600, inside the data dir. */
function writeRuntimeInfo(dataDir: string, port: number, token: string): void {
  try {
    writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify({ port, token, pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });
  } catch { /* discovery is optional */ }
}
