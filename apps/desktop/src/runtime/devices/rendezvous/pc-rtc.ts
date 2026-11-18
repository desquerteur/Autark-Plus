// PC ↔ PC over WebRTC (18.11.2026, owner: "the server only to meet, everything else directly between the devices"):
// when no stored or meeting-seen address answers, the dialing PC opens a tunnel through the meeting server only to agree
// on a direct path. Its first sealed text frame is an offer {t:'rtc-pc', v:1, op:'offer', sdp}; the other PC answers
// {op:'answer', sdp} or {op:'no', why}. Both SDPs carry all their candidates (no trickle; werift gathers before it hands
// out the description). Once the data channel (werift, UDP, through both NATs) opens, the tunnel closes and the mesh
// runs its usual pinned handshake over the data channel (rtc-socket.ts): the dialer expects the PC it dialed, the
// receiver takes only the key that signalled on the tunnel – DTLS is never what a PC trusts. When no direct path comes
// up within DIAL_MS the mesh takes the tunnel as before; a PC that failed is tried directly again after SKIP_MS, so a
// network that blocks direct paths costs the wait once, not on every dial. An older PC closes the tunnel on the offer
// (it expects a handshake): the dialer falls back at once.
// The same guards as the phone way (rtc.ts): exactly the settings' STUN servers, UDP only, the candidate and pair
// filters, data only from checked pairs, werift's SCTP throw caught – without them no offer and no answer (fail-closed).
// Logs carry outcomes and candidate types, never an address.
// Owns: signalling on the tunnel and the peer connections of PC links. Never: trust (the handshake) or the link itself.

import type { RTCPeerConnection } from 'werift';
import type { Logger } from '../../contracts.ts';
import type { SocketLike } from '../channel.ts';
import { RtcSocket } from './rtc-socket.ts';
import { allowedCandidate, guardSctp, MAX_CANDIDATES, MAX_CONNECTIONS, MAX_TRIES, onlyFromPairs, peerConfig, splitCandidates, TRIES_WINDOW_MS } from './rtc.ts';

export const PC_RTC = 'rtc-pc';
const VERSION = 1;
/** A PC's SDP with its candidates; a sealed tunnel text frame holds at most 16 KiB. */
export const MAX_PC_SDP = 12 * 1024;
/** How long the dialer waits for the data channel before the mesh takes the tunnel. */
export const DIAL_MS = 8_000;
/** After a failed try the dialer goes straight to the tunnel for this long. */
export const SKIP_MS = 30 * 60_000;
/** ICE disconnected this long: the way is gone (the mesh redials). */
const LOST_MS = 5_000;

export interface PcRtcDeps {
  log: Logger;
  /** The STUN servers (settings.devices.stun); undefined while the direct way is off (settings.devices.rtc false). */
  stun(): readonly string[] | undefined;
  /** A tunnel to that PC through the meeting server (text frames sealed to it), or undefined when it is not there. */
  tunnel(fingerprint: string): Promise<SocketLike> | undefined;
  /** The receiving side's handshake on the data channel, only with the key of the PC that signalled. */
  accept(socket: SocketLike, fingerprint: string): Promise<unknown>;
  now?: () => number;
  dialMs?: number;
}

interface Message { t?: unknown; v?: unknown; op?: unknown; sdp?: unknown; why?: unknown }

/** The first text frame of an incoming tunnel when it starts a PC ↔ PC try (else undefined: a handshake). */
export function pcOffer(data: Buffer, isText: boolean): Message | undefined {
  if (!isText || data.length > MAX_PC_SDP + 512) return undefined;
  try {
    const message = JSON.parse(data.toString('utf8')) as Message;
    return message && message.t === PC_RTC && message.op === 'offer' ? message : undefined;
  } catch { return undefined; }
}

export class PcRtc {
  private readonly deps: PcRtcDeps;
  private readonly live = new Set<RTCPeerConnection>();
  private readonly failedAt = new Map<string, number>();
  private readonly starts = new Map<string, number[]>();

  constructor(deps: PcRtcDeps) { this.deps = deps; }

  /** Dialer: a data channel straight to that PC, or undefined when there is no try now (off, failed lately, not there). */
  dial(fingerprint: string): Promise<SocketLike> | undefined {
    const stun = this.deps.stun();
    const failed = this.failedAt.get(fingerprint);
    if (stun === undefined || (failed !== undefined && this.now() - failed < SKIP_MS) || this.live.size >= MAX_CONNECTIONS) return undefined;
    const tunnel = this.deps.tunnel(fingerprint);
    return tunnel && this.offer(fingerprint, stun, tunnel);
  }

  /** Receiver: an incoming tunnel from that PC whose first frame was `offer`. */
  answer(signal: SocketLike, fingerprint: string, offer: Message): void {
    const say = (message: Record<string, unknown>) => signal.send(JSON.stringify({ t: PC_RTC, v: VERSION, ...message }));
    const stun = this.deps.stun();
    const why = offer.v !== VERSION ? 'version' : stun === undefined ? 'off' : this.live.size >= MAX_CONNECTIONS ? 'full' : this.spent(fingerprint) ? 'later' : undefined;
    if (why || stun === undefined) { // the dialer closes the tunnel when it read this (a close first would hide the reason)
      say({ op: 'no', why: why ?? 'off' });
      setTimeout(() => signal.close(), 2_000).unref?.();
      this.deps.log.info('pc rtc answer', { outcome: why ?? 'off' });
      return;
    }
    void this.answering(signal, fingerprint, offer.sdp, stun, say);
  }

  private async offer(fingerprint: string, stun: readonly string[], opening: Promise<SocketLike>): Promise<SocketLike> {
    const started = this.now();
    const { RTCPeerConnection } = await import('werift');
    const signal = await opening;
    const pc = new RTCPeerConnection(peerConfig(stun));
    this.live.add(pc);
    return new Promise<SocketLike>((resolve, reject) => {
      let socket: RtcSocket | undefined;
      let over = false;
      let answered = false; // from then on the other PC may close the tunnel first: its data channel opened before mine
      const fail = (outcome: string) => {
        if (socket) { socket.close(1006); return; } // after the channel opened: the link ends, the mesh redials
        if (over) return;
        over = true;
        clearTimeout(timer);
        this.failedAt.set(fingerprint, this.now());
        signal.close();
        this.end(pc);
        this.deps.log.info('pc rtc', { outcome, ms: this.now() - started });
        reject(new Error(`no direct path (${outcome})`));
      };
      const timer = setTimeout(() => fail('timeout'), this.deps.dialMs ?? DIAL_MS);
      timer.unref?.();
      const dc = pc.createDataChannel('autark', { ordered: true });
      dc.stateChanged.subscribe((state) => {
        if (state !== 'open' || over) return;
        over = true;
        clearTimeout(timer);
        signal.close();
        this.failedAt.delete(fingerprint);
        socket = new RtcSocket(dc);
        this.keep(pc, socket);
        this.opened(pc, 'pc rtc', started);
        resolve(socket);
      });
      pc.connectionStateChange.subscribe((state) => { if (!socket && (state === 'failed' || state === 'closed')) fail('failed'); });
      signal.onClose(() => { if (!over && !answered) fail('closed'); });
      signal.onMessage((data, isText) => {
        const message = parse(data, isText);
        if (message?.op === 'answer' && !answered) { answered = true; void this.remote(pc, message.sdp, 'answer').catch(() => fail('failed')); }
        else if (message?.op === 'no') fail(typeof message.why === 'string' ? message.why.slice(0, 20) : 'no');
      });
      void (async () => {
        await pc.setLocalDescription(await pc.createOffer());
        if (!onlyFromPairs(pc) || !guardSctp(pc, () => fail('failed'))) { this.deps.log.warn('pc rtc: werift could not be guarded – no offer'); fail('failed'); return; }
        const sdp = pc.localDescription?.sdp ?? '';
        if (!sdp || Buffer.byteLength(sdp) > MAX_PC_SDP) { fail('failed'); return; }
        if (!over) signal.send(JSON.stringify({ t: PC_RTC, v: VERSION, op: 'offer', sdp }));
      })().catch(() => fail('failed'));
    });
  }

  private async answering(signal: SocketLike, fingerprint: string, sdp: unknown, stun: readonly string[], say: (message: Record<string, unknown>) => void): Promise<void> {
    const started = this.now();
    this.starts.get(fingerprint)?.push(started) ?? this.starts.set(fingerprint, [started]);
    const { RTCPeerConnection } = await import('werift');
    const pc = new RTCPeerConnection(peerConfig(stun));
    this.live.add(pc);
    let socket: RtcSocket | undefined;
    let over = false;
    let answered = false; // from then on the dialer may close the tunnel first: its data channel opened before mine
    const fail = (outcome: string) => {
      if (socket) { socket.close(1006); return; }
      if (over) return;
      over = true;
      clearTimeout(timer);
      signal.close();
      this.end(pc);
      this.deps.log.info('pc rtc answer', { outcome, ms: this.now() - started });
    };
    const timer = setTimeout(() => fail('timeout'), (this.deps.dialMs ?? DIAL_MS) + 2_000);
    timer.unref?.();
    signal.onClose(() => { if (!over && !answered) fail('closed'); });
    pc.connectionStateChange.subscribe((state) => { if (!socket && (state === 'failed' || state === 'closed')) fail('failed'); });
    pc.onDataChannel.subscribe((dc) => {
      const take = () => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        signal.close();
        socket = new RtcSocket(dc);
        this.keep(pc, socket);
        this.opened(pc, 'pc rtc answer', started);
        const taken = socket;
        void this.deps.accept(taken, fingerprint).catch(() => taken.close());
      };
      if (dc.readyState === 'open') take(); else dc.stateChanged.subscribe((state) => { if (state === 'open') take(); });
    });
    try {
      await this.remote(pc, sdp, 'offer');
      await pc.setLocalDescription(await pc.createAnswer());
      if (!onlyFromPairs(pc) || !guardSctp(pc, () => fail('failed'))) { this.deps.log.warn('pc rtc: werift could not be guarded – no answer'); say({ op: 'no', why: 'failed' }); fail('failed'); return; }
      const answer = pc.localDescription?.sdp ?? '';
      if (!answer || Buffer.byteLength(answer) > MAX_PC_SDP) { say({ op: 'no', why: 'failed' }); fail('failed'); return; }
      if (!over) { answered = true; say({ op: 'answer', sdp: answer }); }
    } catch {
      say({ op: 'no', why: 'failed' });
      fail('failed');
    }
  }

  /** The other side's description: candidates in it pass the same filter as the phone's, at most MAX_CANDIDATES. */
  private async remote(pc: RTCPeerConnection, sdp: unknown, type: 'offer' | 'answer'): Promise<void> {
    if (typeof sdp !== 'string' || Buffer.byteLength(sdp) > MAX_PC_SDP) throw new Error('bad description');
    const { description, candidates } = splitCandidates(sdp);
    await pc.setRemoteDescription({ type, sdp: description });
    for (const line of candidates.slice(0, MAX_CANDIDATES)) {
      if (allowedCandidate(line)) await pc.addIceCandidate({ candidate: line, sdpMLineIndex: 0 }).catch(() => undefined);
    }
    await pc.addIceCandidate().catch(() => undefined);
  }

  /** The way stands: the link's socket ends with the peer connection, and the peer connection with the socket. */
  private keep(pc: RTCPeerConnection, socket: RtcSocket): void {
    let lost: ReturnType<typeof setTimeout> | undefined;
    socket.onClose(() => { clearTimeout(lost); this.end(pc); });
    pc.connectionStateChange.subscribe((state) => {
      if (state === 'failed' || state === 'closed') socket.close(1006);
      else if (state === 'disconnected') { lost ??= setTimeout(() => socket.close(1006), LOST_MS); lost.unref?.(); }
      else if (state === 'connected') { clearTimeout(lost); lost = undefined; }
    });
  }

  private opened(pc: RTCPeerConnection, line: string, started: number): void {
    const pair = pc.iceTransports[0]?.getSelectedCandidatePair();
    this.deps.log.info(line, { outcome: 'ok', ms: this.now() - started, local: pair?.local.type ?? undefined, remote: pair?.remote.type ?? undefined });
  }

  private end(pc: RTCPeerConnection): void {
    if (!this.live.delete(pc)) return;
    void pc.close().catch(() => undefined);
  }

  /** That PC started MAX_TRIES tries here in the window already. */
  private spent(fingerprint: string): boolean {
    const since = this.now() - TRIES_WINDOW_MS;
    const recent = (this.starts.get(fingerprint) ?? []).filter((at) => at > since);
    if (recent.length) this.starts.set(fingerprint, recent); else this.starts.delete(fingerprint);
    return recent.length >= MAX_TRIES;
  }

  private now(): number { return this.deps.now?.() ?? Date.now(); }
}

function parse(data: Buffer, isText: boolean): Message | undefined {
  if (!isText) return undefined;
  try {
    const message = JSON.parse(data.toString('utf8')) as Message;
    return message && message.t === PC_RTC ? message : undefined;
  } catch { return undefined; }
}
