// The sync between linked PCs, put together once by the runtime's composition root (main.ts): the mesh methods
// sync.rows (rows.ts; from an employee's PC it takes only that person's own lines and task changes, employee.ts),
// sync.secret (secrets.ts), sync.file (files.ts with the settings and stored files' bytes), sync.login (logins.ts) and,
// B-076, the side pane: sync.tabs (tabs.ts), files.path (paths.ts: a file tab of another PC reads there) and
// tabs.position (positions.ts: where a tab is scrolled to) – none of them open methods, so an employee's PC cannot call
// them – and the listeners, attached only while a PC is linked (nothing runs without a link). <data>/side-tabs.json
// gets its owner on the data folder watcher here: every change is told to this PC's window and phones (tabs.changed),
// and goes to the linked PCs while one is. B-078: sync.roster and device.sibling (roster.ts) let my devices know each
// other and their phones. A link that comes up (device.upserted 'online') runs its link-up (linkUps): the roster
// first, then the side pane (small, so a PC that just joined shows the other's pane at once), the rows and secrets owed
// since that PC's cursor (stamps.ts) and every plan's login, then the wakes that waited for that PC (B-087: a woken
// turn finds its login and key there; another PC's link-up leaves them), and last the settings and files (the file
// rescan takes longest); a complete link-up moves the cursor to its start. B-087: one link-up per PC at a time – an
// 'online' during a run (a link swap cut its calls) ends it before its next step and runs it again at once – and a run
// whose link is gone ends before its next step (no step or page dials for it); a cut run leaves the cursor, so the
// next run still owes the rest. Removing a PC drops its cursor, so a new link begins with everything again. A link
// that comes up or goes re-places the schedules' due times (one PC fires each).
// Owns: this wiring and the link-up order. Never: decides what a link carries (home.ts) or logs content.

import type { RuntimeServices } from '../../contracts.ts';
import { ROOT_SIDE_TABS } from '../../root/layout.ts';
import { PATH_OPS } from '../../rpc/handlers/files-path.ts';
import type { PeerHandler } from '../rpc-peer.ts';
import { FileSync, type WatcherTap } from './files.ts';
import { links } from './home.ts';
import { LoginSync } from './logins.ts';
import { RemotePaths } from './paths.ts';
import { tabPositions } from './positions.ts';
import { RowSync } from './rows.ts';
import { SecretSync } from './secrets.ts';
import { Stamps } from './stamps.ts';
import { RosterSync, type RosterMesh } from './roster.ts';
import { placeSchedules } from './tables.ts';
import { EVERY_LINK, type LinkKind } from '../mesh.ts';
import { announcePane, TabSync } from './tabs.ts';

export interface SyncInput {
  s: RuntimeServices;
  /** Where peer methods are registered (the mesh); with add/revoke/selfInfo the roster runs too (roster.ts). */
  mesh: { register(method: string, handler: PeerHandler, kinds?: readonly LinkKind[]): void } & Partial<Omit<RosterMesh, 'register'>>;
  /** The data folder watcher's tap, when it has one (live file changes; else the owners' events and link-ups). */
  tap?: WatcherTap;
}

export interface Sync { stop(): void }

const errorText = (error: unknown) => String((error as Error)?.message ?? error);

/** What a link-up runs (startSync's syncs; a test stands them in). */
export interface LinkUpParts {
  roster?: Pick<RosterSync, 'linkUp'>;
  tabs: Pick<TabSync, 'catchUp'>;
  rows: Pick<RowSync, 'catchUp' | 'resume'>;
  secrets: Pick<SecretSync, 'catchUp'>;
  logins: Pick<LoginSync, 'catchUp'>;
  files: Pick<FileSync, 'catchUp'>;
}

/**
 * B-087: the link-ups, one per PC at a time. An 'online' that comes while that PC's link-up runs (a link swap cut the
 * calls in flight) ends that run before its next step and runs it once more at once – what the swap cut goes again
 * now, not after the file rescan – from the cursor a complete run moved (a cut run moves none). `linked`: whether the
 * PC's link is still up; a run whose link is gone ends before its next step.
 */
export function linkUps(s: Pick<RuntimeServices, 'clock' | 'log'>, stamps: Pick<Stamps, 'cursor' | 'setCursor'>, parts: LinkUpParts, linked: (peer: string) => boolean): (peer: string) => void {
  const running = new Map<string, boolean>(); // peer → an 'online' came while its link-up ran
  const woke = new Set<string>(); // peers whose running link-up already released its waiting wakes (its last step)
  const linkUp = async (peer: string) => {
    const since = stamps.cursor(peer);
    const started = s.clock.now();
    let complete = true;
    const owed = (done: boolean) => { complete &&= done; };
    const steps: Array<() => Promise<unknown>> = [
      async () => parts.roster?.linkUp(peer).catch((error: unknown) => s.log.warn('roster not exchanged', { peer, error: errorText(error) })), // small, first: my devices know each other at once
      () => parts.tabs.catchUp(peer), // every space, at every link-up, first: no part of the cursor, and a PC that joined has the pane at once
      async () => owed(await parts.rows.catchUp(peer, since)),
      async () => owed(await parts.secrets.catchUp(peer, since)), // small, before the wakes: an API key travels as a secret
      () => parts.logins.catchUp(peer), // every login, at every link-up: no part of the cursor; before the wakes, which may need it
      async () => { woke.add(peer); parts.rows.resume(peer); owed(await parts.files.catchUp(peer, since)); }, // B-077/B-087: the wakes that wait for this PC go before the file rescan, not after it
    ];
    for (const step of steps) {
      if (!linked(peer)) { s.log.info('link-up ended, link gone', { peer }); return; } // no dial per step; the cursor stays
      if (running.get(peer)) { s.log.info('link-up again after a link swap', { peer }); return; } // the rerun starts at once, from the same cursor
      await step();
    }
    if (complete) stamps.setCursor(peer, started);
    s.log.info('linked PC caught up', { peer, first: since === undefined, complete });
  };
  const run = (peer: string): void => {
    if (running.has(peer)) {
      running.set(peer, true);
      // A swap during the last step (the file rescan) may have cut the wakes' hand-over: release them again on the new
      // link right after the cut call has settled, not only after the rescan and the rerun.
      if (woke.delete(peer)) setTimeout(() => { if (linked(peer)) parts.rows.resume(peer); }, 0); // once per run
      return;
    }
    running.set(peer, false);
    void linkUp(peer)
      .catch((error: unknown) => s.log.warn('linked PC not caught up', { peer, error: errorText(error) }))
      .finally(() => {
        const again = running.get(peer);
        running.delete(peer);
        woke.delete(peer);
        if (again && linked(peer)) run(peer);
      });
  };
  return run;
}

export function startSync(input: SyncInput): Sync {
  const { s, mesh } = input;
  const stamps = new Stamps(s.db, s.clock);
  const rows = new RowSync(s, stamps);
  const secrets = new SecretSync(s, stamps);
  const files = new FileSync(s, stamps);
  const logins = new LoginSync(s);
  const tabs = new TabSync(s, stamps);
  const paths = new RemotePaths(s, rows, PATH_OPS);
  const { add, revoke, selfInfo } = mesh;
  const roster = add && revoke && selfInfo ? new RosterSync(s, { register: mesh.register.bind(mesh), add: add.bind(mesh), revoke: revoke.bind(mesh), selfInfo: selfInfo.bind(mesh) }) : undefined;
  mesh.register('sync.rows', (params, from) => rows.receive(params, from), EVERY_LINK); // from an employee's PC only its person's own part (employee.ts)
  mesh.register('sync.secret', (params, from) => secrets.receive(params, from));
  mesh.register('sync.file', (params, from) => files.receive(params, from));
  mesh.register('sync.login', (params, from) => logins.receive(params, from));
  mesh.register('sync.tabs', (params, from) => tabs.receive(params, from));
  mesh.register('files.path', (params, from) => paths.serve(params, from));
  mesh.register('tabs.position', (params, from) => tabPositions(s).receive(params, from));
  const unwatch = s.rootWatcher?.register(ROOT_SIDE_TABS, () => { announcePane(s); tabs.changed(); });

  let detach: (() => void) | undefined;
  const online = new Set<string>();
  const refresh = () => {
    const linked = links(s.db).length > 0;
    if (linked && !detach) {
      const offs = [rows.attach(), secrets.attach(), files.attach(input.tap), logins.attach(), tabs.attach(), ...(roster ? [roster.attach()] : [])];
      detach = () => { for (const off of offs) off(); };
    } else if (!linked && detach) {
      detach();
      detach = undefined;
    }
  };
  const run = linkUps(s, stamps, { roster, tabs, rows, secrets, logins, files }, (peer) => online.has(peer));
  // Which PC fires a schedule follows the links (tables.ts placeSchedules).
  const place = () => { try { placeSchedules(s); } catch (error) { s.log.warn('schedules not placed', { error: errorText(error) }); } };
  const off = s.bus.on('device.upserted', (device) => {
    if (device.kind !== 'pc' || device.self) return;
    refresh();
    if (device.status !== 'online') {
      online.delete(device.id);
      if (device.status === 'revoked') { stamps.dropCursor(device.id); place(); }
      return;
    }
    if (online.has(device.id)) return;
    online.add(device.id);
    place();
    run(device.id);
  });
  refresh();
  return { stop: () => { off(); online.clear(); unwatch?.(); detach?.(); detach = undefined; } }; // a link-up still running ends at its next step
}
