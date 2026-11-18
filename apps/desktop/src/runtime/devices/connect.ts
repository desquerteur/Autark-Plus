// The devices part of the composition (called once by compose/network.ts): phone/browser access and
// web push (pwa/*), connecting PCs (remote/*: nearby on this network, Remote ID or address, the code,
// CEO or employee), the meeting server (rendezvous/service.ts), the peer listener other PCs dial
// (http/peer-server.ts, with the router's port mapping – http/portmap.ts), the read-clear of phone notices
// (pwa/read-clear.ts), and the device tools with their peer handlers (computer, browser, phone, devices.connect).
// B-080: the agent's own browser also reads one page for web.fetch when a site turns the direct fetch away as a bot
// (services.browserRead, browser/read-page.ts).
// B-078: the owner's phone pairs like a PC (rendezvous/phone-pair.ts: Remote ID, the same code, Accept); phone.* tools
// drive ADB phones and the Android app's phone use (phone/drivers.ts, phone/app-driver.ts) alike; services.phones tells the
// rest of the runtime whether an app phone is attached and its phone use on (contracts/phones.ts).
// B-084: host 'online' nudges the meeting server too; a connect request's notice opens Settings › Devices (connect-signals.ts).
// F09/F13/F17 (16.11.2026): the LAN hello names this company (companyName); Accept may make the person (people.save) and an
// employee's PC that links marks its person joined; the mesh carries the requests of my other PCs (remote/mirror.ts).
// F29 stage 1: the phone bridge also takes the phone app's direct socket on the peer listener (/peer/phone), which stays
// open while a phone app is linked.
// F25 stage 2: a phone may also ask on its tunnel for a WebRTC way (rendezvous/rtc.ts) – devices.rtc, devices.stun.
// Settings read here (all in settings.json, changed by the AI – skill app-settings): devices.peer,
// devices.peerPort, devices.findable, devices.relay (the meeting server), devices.rtc and devices.stun, pwa.bind.
// Owns: this wiring. Never: business logic.

import path from 'node:path';
import type { RuntimeServices } from '../contracts.ts';
import { companyLabel } from '../../shared/model/companies.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { connectNotice, nudgesMeeting } from './connect-signals.ts';
import type { RemoteIncoming } from '../../shared/model/remote.ts';
import type { PairingHttp } from '../http/types.ts';
import { PeerServer, hasLinkedPc, rememberedPeerPort, type PeerMode } from '../http/peer-server.ts';
import { PortMap } from '../http/portmap.ts';
import { closeAccessTurnedOff } from '../pwa/access-off.ts';
import { PushService } from '../pwa/push.ts';
import { pushPeopleMessages } from '../pwa/person-push.ts';
import { startReadClear } from '../pwa/read-clear.ts';
import { PwaService } from '../pwa/service.ts';
import { VapidKeys } from '../pwa/vapid.ts';
import { qrDataUrl } from '../pwa/qr.ts';
import { REMOTE_KINDS, type RemoteService } from '../remote/service.ts';
import type { ComputerService } from '../computer/service.ts';
import type { BrowserService } from '../browser/service.ts';
import { browserReader } from '../browser/read-page.ts';
import { AdbPhone, adbOverride, type AdbDeps } from '../phone/adb.ts';
import '../contracts/phones.ts';
import { AppPhones } from '../phone/app-driver.ts';
import { mergedPhones } from '../phone/drivers.ts';
import { DiscoveryResponder, discover, loopbackOnly } from './discovery.ts';
import type { DeviceIdentity } from './identity.ts';
import type { DeviceMesh } from './mesh.ts';
import { fail } from './pair-proof.ts';
import { Meeting, RELAY_PREFIX } from './rendezvous/service.ts';
import { PhoneBridge, hasRelayPhone } from './rendezvous/phone.ts';
import { rtcStun } from './rendezvous/rtc.ts';
import { DevicesRepo } from './repo.ts';
import { RemoteWithPhones } from './rendezvous/phone-pair.ts';
import { DEFAULT_RELAY } from '../../shared/model/relay.ts';
import { canWelcome, welcomeMember } from '../org/member-welcome.ts';

/** A test profile (window tests, the demo engine) never reaches Autark's own meeting server by default; an address it sets itself still works. */
export function meetingAddress(setting: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const testProfile = Boolean(env.WORKFORCE_TEST_DATA) || env.WORKFORCE_FAKE_ENGINE === '1';
  return testProfile && setting === DEFAULT_RELAY ? '' : setting;
}
import { deviceTools, localCaps, registerDeviceHandlers } from './tools.ts';

export interface DevicesInput {
  s: RuntimeServices;
  identity: DeviceIdentity;
  mesh: DeviceMesh;
  computer: ComputerService;
  browser: BrowserService;
  /** adb lookup (core.supervisor, core.finder). */
  adb: Pick<AdbDeps, 'supervisor' | 'finder'>;
  /** The runtime HTTP server's port once it listens (phone links). */
  port(): number;
  /** Peer listener mode of this process (the headless CLI's `--peer`); default settings.devices.peer. */
  peerMode?: PeerMode;
}

export interface Devices {
  pwa: PwaService;
  push: PushService;
  /** Connecting PCs and the owner's phone (its requests join the same list). */
  remote: RemoteService;
  meeting: Meeting;
  /** The listener other PCs dial (started by main.ts, closed on shutdown). */
  peer: PeerServer;
  /** What /peer/pair and /.well-known/workforce serve (the HTTP server and the peer listener). */
  http: PairingHttp;
  /** What this PC offers linked PCs (computer use, browser), announced once at start. */
  announceCaps(): Promise<void>;
  /** Shutdown: the meeting server connection and the LAN answers end. */
  stop(): void;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** POST JSON to `<address>/peer/pair` (a connect request step). */
async function postJson(address: string, body: unknown, options: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(new URL('/peer/pair', address), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), redirect: 'error', signal });
  return response.json();
}

/** GET <address>/.well-known/workforce (≤ 3 s): the public identity a typed address answers with. */
async function wellKnownAt(address: string): Promise<{ deviceId: string; name: string; fingerprint: string } | undefined> {
  const response = await fetch(new URL('/.well-known/workforce', address), { redirect: 'error', signal: AbortSignal.timeout(3_000) });
  if (!response.ok) return undefined;
  const value = (await response.json()) as Record<string, unknown>;
  if (value?.app !== 'workforce' || typeof value.deviceId !== 'string' || typeof value.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.fingerprint)) return undefined;
  return { deviceId: value.deviceId, name: String(value.name ?? '').slice(0, 60), fingerprint: value.fingerprint };
}

/** F09: this company's name as companies.list shows it – its folder decides which company of this PC it is. */
export function companyName(s: Pick<RuntimeServices, 'host' | 'settings'>): string {
  const app = s.host.app;
  const first = app?.companies?.first;
  const id = first && app.dataDir && path.resolve(app.dataDir) !== path.resolve(first) ? path.basename(app.dataDir) : null;
  return companyLabel(s.settings.get().profile, id);
}

/** B-078 (D15): an employee's PC accepted here – the personal manager's one wake about that person (idempotent per person). */
function welcomeEmployee(s: RuntimeServices, personId: string): void {
  const person = s.people?.get(personId);
  if (!person || person.owner || person.status === 'revoked' || !canWelcome(s)) return;
  welcomeMember(s, { id: personId, label: s.people!.label(person) });
}

export function createDevices(input: DevicesInput): Devices {
  const { s, mesh, identity } = input;
  let vapid: Promise<VapidKeys> | undefined;
  const push = new PushService({ db: s.db, clock: s.clock, log: s.log, vapid: () => (vapid ??= VapidKeys.load({ db: s.db, host: s.host, clock: s.clock })) });
  const pwa = new PwaService({ db: s.db, clock: s.clock, bus: s.bus, log: s.log, settings: s.settings, push, port: input.port, qr: qrDataUrl });
  // B-078 (D5): no phone switch any more – a device gets in exactly while its accepted row exists; pwa.enabled gates nothing.
  void closeAccessTurnedOff(s, pwa).catch((error) => s.log.warn('closing switched-off phone access failed', { error: String(error) }));
  s.notifications.addChannel?.((message) => { void pwa.pushNotify(message).catch((error) => s.log.warn('web push failed', { error: String(error) })); });
  const offPeoplePush = pushPeopleMessages(s, push); // employees' devices: a new message in a chat they are in
  const offReadClear = startReadClear(s); // B-078: a chat read anywhere closes its notice on every phone

  const peerMode = (): PeerMode => input.peerMode ?? s.settings.get().devices.peer;
  const findable = () => s.settings.get().devices.findable !== false && peerMode() !== 'off';
  const responder = new DiscoveryResponder();
  let meeting: Meeting | undefined;
  let peer: PeerServer | undefined;
  const post = (address: string, body: unknown, options: { timeoutMs: number; signal?: AbortSignal }) =>
    address.startsWith(RELAY_PREFIX) && meeting ? meeting.post(address, body, options) : postJson(address, body, options);
  const notify = (view: RemoteIncoming) => s.notifications.notify(connectNotice(view));
  const remote = new RemoteWithPhones({
    identity, clock: s.clock, bus: s.bus, log: s.log, mesh, findable, post, responder, notify, wellKnownAt,
    pair: (phone) => pwa.pairPhone(phone),
    linked: (note) => s.notifications.notify({ kind: 'important', ...note }),
    admitted: (personId) => welcomeEmployee(s, personId),
    company: () => companyName(s),
    createPerson: (person) => {
      if (!s.people) throw new WorkforceError('unavailable', 'People cannot be added on this PC.');
      return s.people.save(person).id;
    },
    knows: (personId) => Boolean(s.people?.get(personId)),
    joined: (personId, device) => { s.people?.joinedWith(personId, device); },
    lan: () => discover({ self: identity.deviceId }),
    meeting: (remoteId, signal) => meeting?.find(remoteId, signal) ?? Promise.resolve([]),
    holdListener: () => peer?.hold().catch(() => undefined) ?? Promise.resolve(undefined),
    peerPort: () => peer?.port(),
  });
  const http: PairingHttp = {
    wellKnown: () => remote.wellKnown(),
    handle: async (body, from) => {
      const kind = (body as { kind?: unknown } | null)?.kind;
      return typeof kind === 'string' && REMOTE_KINDS.has(kind) ? remote.handle(body as Record<string, unknown>, from) : fail('bad_request', 'Unknown request.');
    },
  };
  const devicesRepo = new DevicesRepo(s.db);
  const bridge = new PhoneBridge({
    identity, log: s.log, port: input.port, phone: (fingerprint) => devicesRepo.byFingerprint(fingerprint),
    rtc: { stun: () => rtcStun(s.settings.get().devices) }, // F25: the WebRTC way to a phone app
  });
  const listener = new PeerServer({
    pairing: http, mesh, phones: bridge, log: () => s.log, bus: s.bus, remember: rememberedPeerPort(() => s),
    wanted: findable, // other PCs must reach this PC while it accepts requests
    config: () => ({ mode: peerMode(), port: s.settings.get().devices.peerPort }),
    linked: () => hasLinkedPc(mesh.list()) || hasRelayPhone(devicesRepo.list({ kinds: ['phone'] })), // F29: my phone's direct socket
    // B-078: the home router maps the peer port while it listens (a test profile never touches the router)
    ...(process.env.WORKFORCE_TEST_DATA || process.env.WORKFORCE_FAKE_ENGINE === '1' ? {} : { portmap: new PortMap({ log: () => s.log }) }),
    ...(loopbackOnly() ? { hosts: () => ['127.0.0.1'] } : {}), // a window test's listener stays on this PC (no Windows Firewall question on a shared screen)
  });
  peer = listener;
  const meet = new Meeting({
    db: s.db, bus: s.bus, log: s.log, clock: s.clock, identity, mesh,
    remote: { handle: (body, from) => remote.handle(body, from), wellKnown: () => remote.wellKnown(), kinds: REMOTE_KINDS },
    relayUrl: () => meetingAddress(s.settings.get().devices.relay),
    findable,
    port: () => listener.port(),
    phones: bridge,
    stun: () => rtcStun(s.settings.get().devices), // 18.11.2026: PC ↔ PC over WebRTC too (rendezvous/pc-rtc.ts)
  });
  meeting = meet;
  listener.onChange((state) => { mesh.updateSelf({ addresses: state.addresses }); remote.refresh(); meet.portChanged(); });
  const offSettings = s.bus.on('settings.updated', () => remote.refresh());
  const offPower = s.host.onPower((event) => { if (nudgesMeeting(event)) meet.nudge(); });
  meet.start();
  remote.refresh();

  // Hands, eyes and the phone for agents (executed here or on a linked PC).
  const appPhones = new AppPhones({ bus: s.bus, devices: () => s.devices.list() });
  // The ADB phones attached here changed (seen whenever adb runs – no tracking of its own): my other PCs hear it.
  const adbChanged = () => { void announceCaps().catch(() => undefined); };
  const phone = mergedPhones(new AdbPhone({ ...input.adb, log: s.log, ...adbOverride(), changed: adbChanged }), appPhones);
  s.phones = { useOf: (deviceId) => appPhones.useOf(deviceId), here: () => phone.here(), adbInstalled: () => phone.adbInstalled() }; // phone use, the phones on this PC and adb here (contracts/phones.ts)
  for (const tool of deviceTools({ computer: input.computer, browser: input.browser, phone, link: { remote, meeting: meet } })) s.tools.register(tool);
  registerDeviceHandlers(mesh, { services: () => s, computer: input.computer });
  s.browserRead = browserReader(input.browser); // B-080: web.fetch's way past a bot check, in every mode

  const announceCaps = () => localCaps({ computer: input.computer, browser: input.browser, phone, version: s.host.app?.version }).then((caps) => { mesh.updateSelf({ caps }); }); // F25: with this PC's app version
  // A phone's app attaches here or leaves: my other PCs hear which PC holds it (their prompt names it, phone/linked.ts).
  const offPhones = s.bus.on('phoneUse.attached', () => { void announceCaps().catch(() => undefined); });
  // One look at start (adb only where it is installed): whether adb is here (phone.* can work then), and a phone on the
  // cable since before the start is named in the prompt.
  void phone.devices().then(() => announceCaps()).catch(() => undefined);

  return {
    pwa, push, remote, meeting: meet, peer: listener, http,
    announceCaps,
    stop: () => { offSettings(); offPower(); offPeoplePush(); offReadClear(); offPhones(); appPhones.stop(); bridge.closeAll(); meet.stop(); remote.stop(); responder.close(); },
  };
}
