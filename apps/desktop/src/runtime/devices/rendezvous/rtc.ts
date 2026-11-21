// F25 stage 2 (16.11.2026): the PC end of the WebRTC way to a phone app, so a phone reaches this PC straight over UDP –
// across mobile networks and NATs, where stage 1's TCP socket (/peer/phone) can't. The meeting server stays the meeting
// point and the way back: the phone opens its tunnel as always, the pinned handshake runs there, and only inside that
// authenticated, encrypted channel (A) the two trade SDP and ICE candidates as {t:'rtc'} messages – the server sees
// ciphertext and no new frame type. Over the data channel that comes up (werift in plain Node, no window) the phone runs
// the pinned handshake again (rtc-socket.ts, PhoneBridge.acceptRtc: exactly the key of the phone that signalled on A,
// while it is still accepted); its streams then run there (B), and A stays open and idle as the way back.
// Messages on A, v 1: phone hello {net?} → PC offer {id, sdp, ice} (ice = settings.devices.stun) or no {why}; phone
// answer {id, sdp}; phone cand {id, c: RTCIceCandidateInit} … cand {id, done: true}; either side end {id, why}. On B the
// PC sends ready {id} once the handshake is done – from then on the phone moves its streams there.
// Limits (Noah 16.11.2026): one try per phone at a time and at most 6 in 10 minutes (no {why: 'later'}), ≤ 8 peer
// connections, 15 s until B is ready, SDP ≤ 16 KiB,
// ≤ 32 candidates per try, UDP only. A candidate on loopback, 0/8, link-local, multicast, broadcast/reserved or a port
// below 1024 is dropped – trickled or in the answer's SDP, after an mDNS name resolved (pair filter) and as a check's
// source (no answer, no peer-reflexive pair) – so a phone can't aim this PC's checks into its own network. werift runs
// with exactly the settings' STUN list (iceUseDefaultStunServer false: never Google behind an empty list); it loads with
// the first try, so a PC without a phone app never holds it. werift hands DTLS every datagram that is not STUN, from any
// address – one forged packet ended the way in the fuzz test – so its sockets take data only from the far end of a
// checked pair (onlyFromPairs), as libwebrtc does; werift's SCTP receive runs without a catch, so one throw there would
// restart the runtime and end every agent's turn – it is caught and ends this try (guardSctp). Without either guard
// (another werift version) there is no offer: the try ends failed (Noah's review 16.11.2026: fail-closed). When the PC
// ends a way, the phone hears end on A at once – also for a try it never offered (end {id} after hello means no).
// Logs carry outcomes and candidate types, never an address.
// Owns: signalling on A, the peer connections and their limits. Never: trust (the handshake on B) or the streams.

import { randomBytes } from 'node:crypto';
import net from 'node:net';
import type { RTCPeerConnection } from 'werift';
import type { Logger } from '../../contracts.ts';
import { DEFAULT_STUN } from '../../../shared/model/relay.ts';
import type { DeviceSettings } from '../../../shared/model/system.ts';
import { REFUSED_CLOSE, type SecureChannel } from '../channel.ts';
import { RtcSocket } from './rtc-socket.ts';

export const RTC_VERSION = 1;
export const MAX_SDP = 16 * 1024;
export const MAX_CANDIDATES = 32;
export const MAX_CONNECTIONS = 8;
const TRY_MS = 15_000;
/** ICE disconnected this long: the way is gone (the phone is on its tunnel already). */
const LOST_MS = 5_000;
/** Seconds the offer waits for the STUN servers' answers. */
const STUN_WAIT_S = 2;
const NETS = new Set(['wifi', 'cell', 'ethernet', 'vpn', 'other']);
/** Tries per phone in a window: a phone that starts again right after every end makes no loop of STUN and check packets. */
export const MAX_TRIES = 6;
export const TRIES_WINDOW_MS = 10 * 60_000;

/** Addresses a phone's candidate never makes this PC send to: its own and its network's special ranges. */
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) BLOCKED.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 96], ['64:ff9b::', 96], ['fe80::', 10], ['ff00::', 8]] as const) BLOCKED.addSubnet(address, prefix, 'ipv6');
// (IPv4-mapped IPv6 addresses are checked against the IPv4 ranges by BlockList itself.)

/** An address and port this PC sends ICE checks to: an IP outside the blocked ranges, port 1024 and up. */
export function allowedAddress(host: string, port: number): boolean {
  const family = net.isIP(host);
  return family !== 0 && Number.isInteger(port) && port >= 1024 && port <= 65535 && !BLOCKED.check(host, family === 6 ? 'ipv6' : 'ipv4');
}

/** The type (host, srflx, prflx, relay) of a UDP candidate line this PC takes, else undefined. An mDNS name passes here;
 * the address it resolves to meets allowedAddress in the pair filter. */
export function allowedCandidate(line: string): string | undefined {
  if (line.length > 512) return undefined;
  const parts = line.trim().replace(/^a=/, '').split(/\s+/);
  if (parts.length < 8 || !parts[0].startsWith('candidate:') || parts[2].toLowerCase() !== 'udp' || parts[6] !== 'typ') return undefined;
  const [address, port] = [parts[4], Number(parts[5])];
  const ok = /^[a-z0-9-]{1,64}\.local$/i.test(address) ? Number.isInteger(port) && port >= 1024 && port <= 65535 : allowedAddress(address, port);
  return ok && /^(host|srflx|prflx|relay)$/.test(parts[7]) ? parts[7] : undefined;
}

/** The STUN list this PC offers (settings.devices.stun), or undefined while the WebRTC way is off (devices.rtc false). */
export const rtcStun = (devices: DeviceSettings): readonly string[] | undefined => (devices.rtc === false ? undefined : devices.stun ?? DEFAULT_STUN);

/** werift's settings for one try: exactly these STUN servers, UDP only, the address filters. */
export function peerConfig(stun: readonly string[]) {
  return {
    iceServers: stun.length ? [{ urls: [...stun] }] : [],
    iceUseDefaultStunServer: false, // werift's default falls back to stun.l.google.com behind an empty list
    iceUseTcp: false,
    iceStunGatherTimeout: STUN_WAIT_S,
    iceFilterCandidatePair: (pair: { remoteCandidate: { host: string; port: number } }) => allowedAddress(pair.remoteCandidate.host, pair.remoteCandidate.port),
    iceFilterStunResponse: (_message: unknown, [host, port]: readonly [string, number]) => allowedAddress(host, port),
  };
}

/** The part of werift's ICE connection onlyFromPairs reaches into (werift is pinned exactly; the fuzz test checks it). */
interface IceInternals {
  checkList: Array<{ protocol: unknown; state: number; requestsReceived?: number; remoteCandidate: { host: string; port: number } }>;
  protocols: Array<{ datagramReceived(data: Buffer, addr: [string, number]): void }>;
}
const SUCCEEDED = 3; // werift's CandidatePairState.SUCCEEDED

/** Each ICE socket of `pc` passes on data (DTLS) only from an address that sent an authenticated check or answered one;
 * STUN (first byte 0–3) goes on to werift's own checks. False: werift's insides are not where they were. */
export function onlyFromPairs(pc: RTCPeerConnection): boolean {
  const ice = pc.iceTransports[0]?.connection as unknown as Partial<IceInternals> | undefined;
  if (!Array.isArray(ice?.checkList) || !Array.isArray(ice.protocols) || !ice.protocols.every((protocol) => typeof protocol.datagramReceived === 'function')) return false;
  const pairs = ice.checkList;
  for (const protocol of ice.protocols) {
    const receive = protocol.datagramReceived.bind(protocol);
    protocol.datagramReceived = (data, addr) => {
      if (data[0] < 4 || pairs.some((pair) => pair.protocol === protocol && pair.remoteCandidate.host === addr[0] && pair.remoteCandidate.port === addr[1] && (pair.state === SUCCEEDED || (pair.requestsReceived ?? 0) > 0))) receive(data, addr);
    };
  }
  return true;
}

/** The part of werift's SCTP transport guardSctp reaches into: its association and the call that replaces it. */
interface SctpInternals { sctp?: object; bindAssociation?: (...args: unknown[]) => unknown }
const sctpThrows = new WeakMap<object, (error: unknown) => void>();
const GUARDED = Symbol('autark.sctpGuard');

/** werift's SCTP receive (handleData, called without a catch) answers a throw with `onThrow` instead of a rejection that
 * would end the runtime – on the association of `pc` and on any it binds later. False: werift's insides are elsewhere. */
export function guardSctp(pc: RTCPeerConnection, onThrow: (error: unknown) => void): boolean {
  const transport = (pc as unknown as { sctpTransport?: SctpInternals }).sctpTransport;
  const sctp = transport?.sctp as { handleData?: unknown } | undefined;
  const proto = sctp ? (Object.getPrototypeOf(sctp) as Record<string | symbol, unknown>) : undefined;
  if (!transport || !sctp || !proto || typeof proto.handleData !== 'function' || typeof transport.bindAssociation !== 'function') return false;
  if (!proto[GUARDED]) { // once per process: every SCTP association of werift goes through its class's handleData
    const handle = proto.handleData as (this: object, data: Buffer) => Promise<unknown>;
    proto.handleData = async function guarded(this: object, data: Buffer) {
      try { return await handle.call(this, data); } catch (error) { sctpThrows.get(this)?.(error); return undefined; }
    };
    proto[GUARDED] = true;
  }
  sctpThrows.set(sctp, onThrow);
  const bind = transport.bindAssociation.bind(transport);
  transport.bindAssociation = (...args: unknown[]) => { const result = bind(...args); if (transport.sctp) sctpThrows.set(transport.sctp, onThrow); return result; };
  return true;
}

/** The answer's SDP without its candidate lines, and those lines (they take the same filter as trickled ones). */
export function splitCandidates(sdp: string): { description: string; candidates: string[] } {
  const lines = sdp.split(/\r?\n/);
  const candidates = lines.filter((line) => line.startsWith('a=candidate:')).map((line) => line.slice(2));
  const description = lines.filter((line) => !line.startsWith('a=candidate:') && line !== 'a=end-of-candidates').join('\r\n');
  return { description, candidates };
}

export interface PhoneRtcDeps {
  log: Logger;
  /** The STUN servers (settings.devices.stun); undefined while this way is off (settings.devices.rtc false). */
  stun(): readonly string[] | undefined;
  /** Until B is ready (default 15 s). */
  tryMs?: number;
  /** The clock of the tries-per-window limit (tests). */
  now?: () => number;
}

/** The handshake on a data channel with exactly the signalling phone's key: its channel B, or a rejection. */
export type OpenRtc = (socket: RtcSocket) => Promise<SecureChannel>;

interface RtcMessage { t?: unknown; v?: unknown; op?: unknown; id?: unknown; sdp?: unknown; c?: { candidate?: unknown } | null; done?: unknown; net?: unknown }

interface Try {
  id: string;
  deviceId: string;
  pc?: RTCPeerConnection;
  say(message: Record<string, unknown>): void;
  started: number;
  state: 'trying' | 'ready' | 'over';
  answered: boolean;
  candidates: number;
  dropped: number;
  net?: string;
  timer?: ReturnType<typeof setTimeout>;
  lost?: ReturnType<typeof setTimeout>;
  b?: SecureChannel;
}

export class PhoneRtc {
  private readonly deps: PhoneRtcDeps;
  private readonly trying = new Map<string, Try>();
  private readonly live = new Set<Try>();
  /** Each phone's starts in the last TRIES_WINDOW_MS. */
  private readonly starts = new Map<string, number[]>();

  constructor(deps: PhoneRtcDeps) { this.deps = deps; }

  /** A phone's channel on its tunnel (A, the handshake done): its rtc messages from now on. */
  attach(a: SecureChannel, deviceId: string, open: OpenRtc): void {
    let refused = false;
    let current: Try | undefined;
    const say = (message: Record<string, unknown>) => { if (!a.closed) a.send({ t: 'rtc', v: RTC_VERSION, ...message }); };
    a.onMessage((value) => {
      const message = value as RtcMessage | null;
      if (message?.t !== 'rtc') return;
      if (message.op === 'hello') {
        const kind = typeof message.net === 'string' && NETS.has(message.net) ? message.net : undefined; // the phone's network, for the counts
        const why = message.v !== RTC_VERSION ? 'version' : this.deps.stun() === undefined ? 'off' : refused ? 'refused'
          : this.trying.has(deviceId) ? 'busy' : this.live.size >= MAX_CONNECTIONS ? 'full' : this.spent(deviceId) ? 'later' : undefined;
        if (why) { say({ op: 'no', why }); this.deps.log.info('phone rtc', { deviceId, outcome: why, ...(kind ? { net: kind } : {}) }); return; }
        current = this.start(deviceId, kind, say, open, () => { refused = true; });
        return;
      }
      const t = current;
      if (!t || message.id !== t.id || t.state !== 'trying') return;
      if (message.op === 'answer') void this.answer(t, message.sdp);
      else if (message.op === 'cand') void this.candidate(t, message);
      else if (message.op === 'end') this.finish(t, 'ended');
    });
    a.onClose(() => { if (current?.state === 'trying') this.finish(current, 'closed'); });
  }

  private start(deviceId: string, kind: string | undefined, say: Try['say'], open: OpenRtc, refuse: () => void): Try {
    const t: Try = { id: randomBytes(8).toString('hex'), deviceId, say, started: Date.now(), state: 'trying', answered: false, candidates: 0, dropped: 0, net: kind };
    t.timer = setTimeout(() => this.finish(t, 'timeout'), this.deps.tryMs ?? TRY_MS);
    t.timer.unref?.();
    this.trying.set(deviceId, t);
    this.live.add(t);
    this.starts.get(deviceId)?.push(this.now()) ?? this.starts.set(deviceId, [this.now()]);
    void this.offer(t, this.deps.stun() ?? [], open, refuse).catch(() => this.finish(t, 'failed'));
    return t;
  }

  /** The peer connection with its data channel, and the offer on A. */
  private async offer(t: Try, stun: readonly string[], open: OpenRtc, refuse: () => void): Promise<void> {
    const { RTCPeerConnection } = await import('werift');
    if (t.state !== 'trying') return;
    const pc = (t.pc = new RTCPeerConnection(peerConfig(stun)));
    const dc = pc.createDataChannel('autark', { ordered: true });
    dc.stateChanged.subscribe((state) => { if (state === 'open' && t.state === 'trying') void this.inner(t, new RtcSocket(dc), open, refuse); });
    pc.connectionStateChange.subscribe((state) => this.watch(t, state));
    await pc.setLocalDescription(await pc.createOffer());
    const sdp = pc.localDescription?.sdp ?? '';
    if (t.state !== 'trying') return;
    if (!onlyFromPairs(pc) || !guardSctp(pc, () => { this.deps.log.warn('phone rtc: SCTP on the data channel threw; the try ends'); this.finish(t, 'failed'); })) {
      this.deps.log.warn('phone rtc: werift could not be guarded (another werift version?) – no offer');
      this.finish(t, 'failed'); // fail-closed: an unguarded way is no way
      return;
    }
    if (!sdp || Buffer.byteLength(sdp) > MAX_SDP) { this.finish(t, 'failed'); return; }
    t.say({ op: 'offer', id: t.id, sdp, ice: stun.length ? [{ urls: [...stun] }] : [] });
  }

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  /** This phone started MAX_TRIES tries in the window already; older starts drop out. */
  private spent(deviceId: string): boolean {
    const since = this.now() - TRIES_WINDOW_MS;
    const recent = (this.starts.get(deviceId) ?? []).filter((at) => at > since);
    if (recent.length) this.starts.set(deviceId, recent); else this.starts.delete(deviceId);
    return recent.length >= MAX_TRIES;
  }

  private async answer(t: Try, sdp: unknown): Promise<void> {
    if (t.answered || !t.pc) return;
    t.answered = true;
    if (typeof sdp !== 'string' || Buffer.byteLength(sdp) > MAX_SDP) { this.finish(t, 'failed'); return; }
    const { description, candidates } = splitCandidates(sdp);
    try {
      await t.pc.setRemoteDescription({ type: 'answer', sdp: description });
    } catch {
      this.finish(t, 'failed');
      return;
    }
    for (const candidate of candidates) await this.add(t, candidate);
  }

  private async candidate(t: Try, message: RtcMessage): Promise<void> {
    const line = message.c?.candidate;
    if (message.done === true || line === '') { await t.pc?.addIceCandidate().catch(() => undefined); return; }
    if (typeof line === 'string') await this.add(t, line);
  }

  private async add(t: Try, line: string): Promise<void> {
    if (t.state !== 'trying' || ++t.candidates > MAX_CANDIDATES) return;
    if (!allowedCandidate(line)) { t.dropped++; return; }
    await t.pc?.addIceCandidate({ candidate: line, sdpMLineIndex: 0 }).catch(() => undefined); // one m-line: the data channel
  }

  /** The data channel is open: the handshake on it, then B carries the phone's streams. */
  private async inner(t: Try, socket: RtcSocket, open: OpenRtc, refuse: () => void): Promise<void> {
    let b: SecureChannel;
    try {
      b = await open(socket);
    } catch {
      socket.close();
      if (socket.code === REFUSED_CLOSE) refuse(); // not this phone's key (or no longer accepted): no more tries on this A
      this.finish(t, socket.code === REFUSED_CLOSE ? 'refused' : 'failed');
      return;
    }
    if (t.state !== 'trying' || b.closed) { b.close(); return; }
    t.state = 'ready';
    t.b = b;
    clearTimeout(t.timer);
    if (this.trying.get(t.deviceId) === t) this.trying.delete(t.deviceId);
    b.onClose(() => this.finish(t, 'closed'));
    b.send({ t: 'rtc', v: RTC_VERSION, op: 'ready', id: t.id });
    const pair = t.pc?.iceTransports[0]?.getSelectedCandidatePair();
    this.deps.log.info('phone rtc', { deviceId: t.deviceId, outcome: 'ok', ms: Date.now() - t.started, local: pair?.local.type ?? undefined, remote: pair?.remote.type ?? undefined, dropped: t.dropped, ...(t.net ? { net: t.net } : {}) });
  }

  private watch(t: Try, state: string): void {
    if (state === 'failed' || state === 'closed') this.finish(t, t.state === 'ready' ? 'lost' : 'failed');
    else if (state === 'disconnected') { t.lost ??= setTimeout(() => this.finish(t, 'lost'), LOST_MS); t.lost.unref?.(); }
    else if (state === 'connected') { clearTimeout(t.lost); t.lost = undefined; }
  }

  /** The try or the way ends: its peer connection closes, and the phone hears why on A (unless it said end itself). */
  private finish(t: Try, outcome: string): void {
    if (t.state === 'over') return;
    const was = t.state;
    t.state = 'over';
    clearTimeout(t.timer);
    clearTimeout(t.lost);
    if (this.trying.get(t.deviceId) === t) this.trying.delete(t.deviceId);
    this.live.delete(t);
    if (outcome !== 'ended') t.say({ op: 'end', id: t.id, why: outcome }); // A gone: nobody to tell
    t.b?.close();
    void t.pc?.close().catch(() => undefined);
    this.deps.log.info(was === 'ready' ? 'phone rtc ended' : 'phone rtc', { deviceId: t.deviceId, outcome, ms: Date.now() - t.started, ...(was === 'trying' ? { dropped: t.dropped, ...(t.net ? { net: t.net } : {}) } : {}) });
  }
}
