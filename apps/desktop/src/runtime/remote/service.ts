// Connecting PCs (Settings › Devices): this PC as other PCs find it – its Remote ID (remote/id.ts),
// name and fingerprint, and whether it accepts connection requests (settings.devices.findable) –,
// the requests other PCs make here (remote/requests.ts, decided by the person) and this PC's own
// request (remote/join.ts). While findable, LAN hello probes are answered (devices/discovery.ts),
// /.well-known/workforce reports `remoteId` and `findable`, and the peer listener stays open.
// `nearby()` lists the PCs on this network that accept requests (remote/nearby.ts).
// Turning requests off ends every open request. stop() ends the LAN answers for good (shutdown).
// B-084 (person code, remote/code.ts): the Remote ID shown, put into the phone's QR and answered for is my person code
// (my own ID while no code is open); a PC accepted here as my own gets my signature, and the LAN hello carries my chain.
// Once a PC is linked – on either side – the person gets one notice (linkedNote): which PC, as what, what it receives
// and where to remove it, so no link made from an agent's devices.connect sits unnoticed. An employee's PC accepted
// here (a personId) also calls `admitted` (B-078 D15: the personal manager's one wake about that person).
// F17: the requests waiting on my other PCs join the list (remote/mirror.ts, while the mesh offers peer methods); Accept on
// one of them is decided on the PC that holds it. F13: Accept may make the person (`newPerson`) – made when the device
// links (`createPerson`), so the person and their PC arrive in one step; an employee's PC that links makes its person
// active (`joined`). F09: the LAN hello names this company (`company`), so a PC with several companies lists them under it.
// Owns: wiring of these parts, the state Settings › Devices shows, `remote.updated` and the linked notice.
// Never: links a PC without the person's answer, or answers probes while not findable.

import { WorkforceError } from '../../shared/errors.ts';
import type { NearbyPc, NewPerson, RemoteIncoming, RemoteOutgoing, RemoteState } from '../../shared/model/remote.ts';
import type { Device } from '../../shared/model/devices.ts';
import type { Bus } from '../bus.ts';
import type { Clock, Logger } from '../contracts.ts';
import type { Candidate, HelloAnswer } from '../devices/discovery.ts';
import type { DeviceIdentity } from '../devices/identity.ts';
import type { PeerInfo, Reply } from '../devices/pair-proof.ts';
import { codeFor, watchCode } from './code.ts';
import { formatRemoteId, remoteIdOf } from './id.ts';
import { findTarget, type FindDeps, type Found } from './find.ts';
import { RemoteJoiner, type ConnectInput } from './join.ts';
import { RequestMirror, type Decision, type MirrorMesh } from './mirror.ts';
import { NearbyPcs } from './nearby.ts';
import { TargetRequests, type Timers } from './requests.ts';

export interface RemoteDeps {
  identity: Pick<DeviceIdentity, 'deviceId' | 'fingerprint' | 'sign'>;
  clock: Clock;
  bus: Bus;
  log: Logger;
  /**
   * The linked PCs: this PC's identity, storing a proven PC (and dialing it), the device list; with peer methods
   * (register, call – the mesh) the requests of my other PCs show here too (remote/mirror.ts).
   */
  mesh: { selfInfo(): PeerInfo; add(info: PeerInfo, options: { side: 'joiner' | 'inviter'; personId?: string; joinedAs?: 'ceo' | 'employee' }): Device; list(): Device[] }
    & Partial<Pick<MirrorMesh, 'register' | 'call'>>;
  /** F09: this company's name (companyLabel), told in the LAN hello. */
  company?(): string;
  /** F13: makes the person Accept named (people.save) and returns their id; throws to refuse. */
  createPerson?(input: NewPerson): string;
  /** Is this a person of the organisation here (a decide from another of my PCs names one). */
  knows?(personId: string): boolean;
  /** An employee's PC is linked for this person: the person is in now (people/service.ts joinedWith). */
  joined?(personId: string, device: { id: string; name: string }): void;
  /** settings.devices.findable (and a peer listener that may open at all). */
  findable(): boolean;
  /** POST JSON to `<address>/peer/pair` (or the meeting server's `relay:<fp>` route) with a timeout. */
  post(address: string, body: unknown, options: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown>;
  /** LAN: answers hello probes while findable. */
  responder?: { answer(answer: HelloAnswer | undefined): void };
  /** LAN: one hello probe. */
  lan?(): Promise<Candidate[]>;
  /** The meeting server: PCs that accept requests under a Remote ID. */
  meeting?(remoteId: string, signal: AbortSignal): Promise<Found[]>;
  wellKnownAt?: FindDeps['wellKnown'];
  /** Holds the peer listener open while this PC's request runs. */
  holdListener?(): Promise<(() => void) | undefined>;
  /** The peer listener's port while it listens (well-known). */
  peerPort?(): number | undefined;
  /** A request is shown here: one notification for the person. */
  notify?(view: RemoteIncoming): void;
  /** A PC is now linked here (either side): one important notification for the person (linkedNote). */
  linked?(note: { title: string; body: string }): void;
  /** B-078 (D15): an employee's PC was accepted here for this person (org/member-welcome.ts, once per person). */
  admitted?(personId: string): void;
  timers?: Timers;
}

/** As what a linked PC is here: one of the CEO's own PCs, the PC of a person here, or the employer's PC this PC joined as an employee's. */
type LinkedAs = 'own' | 'employee' | 'employer';

const LINKED: Readonly<Record<LinkedAs, readonly [as: string, gets: string]>> = {
  own: ['your own PC', 'this company\'s chats, secrets and settings and can run commands on this PC'],
  employee: ['an employee\'s PC', 'its person\'s chats and tasks'],
  employer: ['your employer\'s PC', 'your lines and task changes in its chats and can run commands on this PC'],
};

/** The notice once a PC is linked: which PC, as what, what it receives and where to remove it. */
export function linkedNote(device: Pick<Device, 'name' | 'fingerprint'>, as: LinkedAs): { title: string; body: string } {
  const [what, gets] = LINKED[as];
  return {
    title: `${device.name} is now linked`,
    body: `${device.name} (Remote ID ${formatRemoteId(remoteIdOf(device.fingerprint))}) is linked as ${what}: it receives ${gets}. Remove it in Settings › Devices.`,
  };
}

const realTimers: Timers = {
  set: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; },
  clear: (handle) => { if (handle) clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

/** Request kinds of POST /peer/pair. */
export const REMOTE_KINDS: ReadonlySet<string> = new Set(['remote1', 'remote2', 'remote3', 'remoteCancel']);

const errorText = (error: unknown) => String((error as Error)?.message ?? error);

export class RemoteService {
  private readonly deps: RemoteDeps;
  private readonly target: TargetRequests;
  private readonly joiner: RemoteJoiner;
  private readonly near: NearbyPcs;
  /** F17: the requests waiting on my other PCs (absent without peer methods). */
  private readonly mirror?: RequestMirror;
  private lastFindable?: boolean;
  private stopped = false;
  private readonly offCode: () => void;

  constructor(deps: RemoteDeps) {
    this.deps = deps;
    const timers = deps.timers ?? realTimers;
    const now = () => deps.clock.now();
    this.target = new TargetRequests({
      now, timers, log: deps.log, signer: deps.identity,
      findable: () => this.findable(),
      self: () => deps.mesh.selfInfo(),
      link: (info, picked, newPerson) => {
        const personId = this.personFor(picked, newPerson);
        this.store(info, { side: 'inviter', personId }, personId ? 'employee' : 'own');
        if (!personId) codeFor(deps.identity.fingerprint)?.sign(info.pub); // my own PC answers for my code from now on
        if (personId) {
          try { deps.joined?.(personId, { id: info.id, name: info.name }); } catch (error) { deps.log.warn('person not marked joined', { personId, error: errorText(error) }); }
          this.admitted(personId);
        }
      },
      shown: (view) => deps.notify?.(view),
      changed: () => this.changed(),
    });
    this.joiner = new RemoteJoiner({
      now, timers, log: deps.log, signer: deps.identity,
      self: () => deps.mesh.selfInfo(),
      holdListener: () => deps.holdListener?.() ?? Promise.resolve(undefined),
      post: deps.post,
      find: (target) => findTarget({ self: deps.identity.deviceId, lan: deps.lan, meeting: deps.meeting, wellKnown: deps.wellKnownAt }, target),
      // The role this PC asked for stays with the link (the open request's view while it is accepted).
      link: (info) => {
        const joinedAs = this.joiner.outgoing()?.role === 'employee' ? 'employee' : 'ceo';
        this.store(info, { side: 'joiner', joinedAs }, joinedAs === 'employee' ? 'employer' : 'own');
      },
      changed: () => this.changed(),
    });
    this.near = new NearbyPcs({
      self: { deviceId: deps.identity.deviceId, fingerprint: deps.identity.fingerprint },
      lan: () => deps.lan?.() ?? Promise.resolve([]),
      linked: () => deps.mesh.list().filter((device) => device.kind === 'pc'),
      outgoing: () => this.joiner.outgoing(),
      now,
    });
    const { register, call } = deps.mesh;
    if (register && call) {
      this.mirror = new RequestMirror({
        mesh: { register: register.bind(deps.mesh), call: call.bind(deps.mesh), list: () => deps.mesh.list() },
        bus: deps.bus, now, timers, log: deps.log,
        own: () => this.ownIncoming(),
        decide: (decision) => this.decideHere(decision),
        knows: (personId) => deps.knows?.(personId) ?? false,
        changed: () => this.emitState(),
      });
    }
    this.offCode = watchCode(deps.identity.fingerprint, () => this.changed()); // a new code shows at once
  }

  /** The Remote ID people type for me: my person code, else this PC's own (derived from its key). */
  remoteId(): string { return codeFor(this.deps.identity.fingerprint)?.code() ?? remoteIdOf(this.deps.identity.fingerprint); }

  /** My chain to the person code's root, when I am not the root myself. */
  private chain(): { chain: unknown } | Record<string, never> {
    const chain = codeFor(this.deps.identity.fingerprint)?.chain();
    return chain?.links.length ? { chain } : {};
  }

  state(): RemoteState {
    const self = this.deps.mesh.selfInfo();
    const outgoing = this.joiner.outgoing();
    return {
      self: { deviceId: self.id, name: self.name, remoteId: this.remoteId(), fingerprint: this.deps.identity.fingerprint, findable: this.findable() },
      incoming: [...this.ownIncoming(), ...(this.mirror?.rows() ?? [])],
      ...(outgoing ? { outgoing } : {}),
    };
  }

  /** The requests waiting on this PC itself (RemoteWithPhones adds the phones'). */
  protected ownIncoming(): RemoteIncoming[] { return this.target.incoming(); }

  /** Starts answering LAN probes when findable, ends open requests when not; call again when settings or the listener change. */
  refresh(): void {
    if (this.stopped) return;
    const findable = this.findable();
    this.deps.responder?.answer(findable ? () => this.hello() : undefined);
    if (!findable) this.target.closeAll();
    if (this.lastFindable !== undefined && this.lastFindable !== findable) this.changed();
    this.lastFindable = findable;
  }

  /** Shutdown: no more LAN answers (refresh() stays quiet), no more mirrored requests. */
  stop(): void {
    this.stopped = true;
    this.offCode();
    this.mirror?.stop();
    this.deps.responder?.answer(undefined);
  }

  /** "Connect" by Remote ID or address, as the CEO or an employee. */
  connect(input: ConnectInput): Promise<RemoteOutgoing> { return this.joiner.connect(input); }

  /** PCs on this network that accept requests, this PC left out; `refresh` asks the network again. */
  nearby(refresh = false): Promise<NearbyPc[]> { return this.near.list(refresh); }

  /** Cancels this PC's open request, or closes its last outcome. */
  cancel(): void { this.joiner.cancel(); }

  /**
   * The person's answer to a request (`personId`: the person an employee's PC or a phone belongs to; `newPerson`: the
   * person to make for it, F13). One waiting here is decided at once (throws); one waiting on another of my PCs (F17) is
   * decided there – the returned promise settles with that PC's answer.
   */
  decide(id: string, accept: boolean, personId?: string, newPerson?: NewPerson): void | Promise<void> {
    const decision: Decision = { id, accept, ...(personId ? { personId } : {}), ...(newPerson ? { newPerson } : {}) };
    if (!this.holdsHere(id) && this.mirror?.holderOf(id)) return this.mirror.decide(decision);
    this.decideHere(decision);
  }

  /** Does this PC itself hold the request `id` (RemoteWithPhones: the phones' too). */
  protected holdsHere(id: string): boolean { return this.target.holds(id); }

  /** The answer to a request this PC holds (also what another of my PCs' decide runs here). */
  protected decideHere(decision: Decision): void { this.target.decide(decision.id, decision.accept, decision.personId, decision.newPerson); }

  /** The person a device links as: the one picked, or (F13) the one Accept named, made now. */
  protected personFor(personId: string | undefined, newPerson: NewPerson | undefined): string | undefined {
    if (personId || !newPerson) return personId;
    if (!this.deps.createPerson) throw new WorkforceError('unavailable', 'People cannot be added on this PC.');
    return this.deps.createPerson(newPerson);
  }

  /** POST /peer/pair with a Remote kind (REMOTE_KINDS). */
  handle(body: Record<string, unknown>, remote: { address?: string }): Promise<Reply> {
    return this.target.handle(body, remote);
  }

  /** What /.well-known/workforce answers: the public identity, the Remote ID, `findable` while requests are accepted. */
  wellKnown(): { app: 'workforce'; protocol: 1; deviceId: string; name: string; fingerprint: string; remoteId: string; peerPort?: number; findable?: true; chain?: unknown } {
    const self = this.deps.mesh.selfInfo();
    const peerPort = this.deps.peerPort?.();
    return {
      app: 'workforce', protocol: 1, deviceId: self.id, name: self.name, fingerprint: this.deps.identity.fingerprint, remoteId: this.remoteId(),
      ...(peerPort ? { peerPort } : {}), ...(this.findable() ? { findable: true as const } : {}), ...this.chain(),
    };
  }

  private findable(): boolean {
    try { return this.deps.findable(); } catch { return false; }
  }

  /** Stores a proven PC, then tells the person which PC is linked as what (linkedNote). */
  private store(info: PeerInfo, options: Parameters<RemoteDeps['mesh']['add']>[1], as: LinkedAs): void {
    const device = this.deps.mesh.add(info, options);
    this.deps.linked?.(linkedNote(device, as));
  }

  /** An employee's PC is in: the personal manager hears once about the person (never fails the link). */
  private admitted(personId: string): void {
    try { this.deps.admitted?.(personId); } catch (error) { this.deps.log.warn('employee welcome not sent', { personId, error: errorText(error) }); }
  }

  /**
   * A LAN hello probe gets this PC's public identity, own Remote ID (older PCs check it), chain and (F09) company name
   * while it accepts requests.
   */
  private hello(): Candidate | undefined {
    if (!this.findable()) return undefined;
    const self = this.deps.mesh.selfInfo();
    const fingerprint = this.deps.identity.fingerprint;
    let company = '';
    try { company = this.deps.company?.().trim().slice(0, 80) ?? ''; } catch { /* the answer goes without it */ }
    return { deviceId: self.id, name: self.name, fingerprint, remoteId: remoteIdOf(fingerprint), addresses: self.addresses, ...this.chain(), ...(company ? { company } : {}) };
  }

  /** This PC's own requests changed: the state goes to the window and phones, the list to my other PCs. */
  protected changed(): void {
    this.emitState();
    this.mirror?.send();
  }

  private emitState(): void {
    try { this.deps.bus.emit('remote.updated', this.state()); } catch (error) { this.deps.log.warn('remote state not sent', { error: errorText(error) }); }
  }
}
