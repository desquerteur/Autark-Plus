// Encrypted, authenticated message channel between two runtimes over a WebSocket-like socket.
// Owns: the SocketLike abstraction (ws adapter + test pairs), running the handshake on either
// side, and AES-256-GCM framing with strictly increasing counters (replay/reorder rejected).
// Messages that arrive before anyone listens (frames right behind the client's auth, delivered
// in the same tick – common through a relay) wait for the first listener instead of being lost.
// B-080: the close code reaches the channel's close listeners (the mesh logs it); a socket its keepalive cut after a
// minute without any frame (markSilent) reports SILENT_CLOSE instead of the plain 1006 of a network error.
// B-087: a message whose frame would pass MAX_FRAME is refused in send() before its counter is used (the other PC would
// drop the whole link for it); a hello with this PC's own key – its own dial come back – closes with 4000, never as a refusal.
// Never: decides which devices are trusted (callers pass `trust`) or interprets payloads.

import { createCipheriv, createDecipheriv } from 'node:crypto';
import type { WebSocket } from 'ws';
import { WorkforceError } from '../../shared/errors.ts';
import { clientFinish, clientHello, serverWelcome, type AuthMessage, type HelloMessage, type SessionKeys, type Signer, type WelcomeMessage } from './handshake.ts';
import { fingerprintOf } from './keys.ts';

export interface SocketLike {
  send(data: Buffer | string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: Buffer, isText: boolean) => void): void;
  /** `code`: the close code when the socket knows one (B-077: 4003 = the other PC refused this one; a network error is 1006). */
  onClose(listener: (code?: number) => void): void;
}

/** The close code a PC sends when it does not accept the other (unknown device, bad key or signature). */
export const REFUSED_CLOSE = 4003;
/** B-080: the code a socket reports when this PC's keepalive cut it for silence (never sent: the socket is cut, not closed). */
export const SILENT_CLOSE = 4008;

/** Sockets a keepalive cut for silence (compose/peer-dial.ts, http/peer.ts). */
const silenced = new WeakSet<object>();
/** Marks `ws` as cut for silence: its close reports SILENT_CLOSE. */
export function markSilent(ws: object): void { silenced.add(ws); }

/** Adapts a `ws` WebSocket to SocketLike. */
export function wrapWs(ws: WebSocket): SocketLike {
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onMessage: (listener) => ws.on('message', (data, isBinary) => listener(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer), !isBinary)),
    onClose: (listener) => { ws.on('close', (code: number) => listener(silenced.has(ws) ? SILENT_CLOSE : code)); ws.on('error', () => listener(1006)); },
  };
}

/** In-memory connected socket pair (tests, same-process loopback). */
export function socketPair(): [SocketLike, SocketLike] {
  type Side = { message: Array<(d: Buffer, t: boolean) => void>; close: Array<(code?: number) => void>; closed: boolean };
  const a: Side = { message: [], close: [], closed: false };
  const b: Side = { message: [], close: [], closed: false };
  const make = (self: Side, other: Side): SocketLike => ({
    send(data) {
      if (self.closed) return;
      const isText = typeof data === 'string';
      const copy = Buffer.from(data);
      queueMicrotask(() => { if (!other.closed) other.message.forEach((l) => l(copy, isText)); });
    },
    close(code) {
      if (self.closed) return;
      self.closed = true;
      other.closed = true;
      queueMicrotask(() => { self.close.forEach((l) => l(code)); other.close.forEach((l) => l(code)); });
    },
    onMessage: (l) => { self.message.push(l); },
    onClose: (l) => { self.close.push(l); },
  });
  return [make(a, b), make(b, a)];
}

/** The largest encrypted frame a PC takes (a dialed socket's maxPayload, compose/peer-dial.ts); a larger one ends the link. */
const MAX_FRAME = 8 * 1024 * 1024;
/** The counter (8 bytes) and the GCM tag (16) around a message's bytes. */
const FRAME_OVERHEAD = 8 + 16;

export class SecureChannel {
  readonly peerId: string;
  readonly peerPub: Buffer;
  private readonly socket: SocketLike;
  private readonly keys: SessionKeys;
  private sendCounter = 0n;
  private receiveCounter = -1n;
  private listeners: Array<(message: unknown) => void> = [];
  /** Messages opened before the first listener registered (bounded). */
  private backlog: unknown[] = [];
  private closeListeners: Array<(code?: number) => void> = [];
  closed = false;

  constructor(socket: SocketLike, keys: SessionKeys, peerId: string, peerPub: Buffer) {
    this.socket = socket;
    this.keys = keys;
    this.peerId = peerId;
    this.peerPub = peerPub;
    socket.onMessage((data, isText) => {
      if (isText) return this.close(); // after the handshake only encrypted binary frames are valid
      this.receive(data);
    });
    socket.onClose((code) => this.markClosed(code));
  }

  /** Throws 'bad_request' (details.reachable false: nothing left this PC) for a message too large for one frame. */
  send(message: unknown): void {
    if (this.closed) throw new Error('Channel closed');
    const plain = Buffer.from(JSON.stringify(message), 'utf8');
    // B-087: measured before the counter is used, so a refused message never costs or reuses a nonce
    if (plain.length + FRAME_OVERHEAD > MAX_FRAME) {
      const mb = (plain.length / 1024 / 1024).toFixed(1);
      throw new WorkforceError('bad_request', `Too large for the link between PCs: ${mb} MB (at most 8 MB per message).`, { details: { reachable: false, bytes: plain.length } });
    }
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(this.sendCounter, 4);
    const cipher = createCipheriv('aes-256-gcm', this.keys.send, nonce);
    const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(this.sendCounter);
    this.sendCounter++;
    this.socket.send(Buffer.concat([counter, body]));
  }

  /** Processes binary frames that arrived before the channel object existed. */
  feed(frames: Buffer[]): void {
    for (const frame of frames) this.receive(frame);
  }

  private receive(frame: Buffer): void {
    if (this.closed) return;
    const message = this.open(frame);
    if (message === undefined) return this.close();
    if (!this.listeners.length) {
      if (this.backlog.length >= 256) return this.close();
      this.backlog.push(message);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.listeners.push(listener);
    for (const message of this.backlog.splice(0)) listener(message); // in order, before anything newer
  }
  /** `code`: the socket's close code (1000 when this side closed it). */
  onClose(listener: (code?: number) => void): void { this.closeListeners.push(listener); }

  close(): void {
    this.socket.close(1000, 'bye');
    this.markClosed(1000);
  }

  private markClosed(code?: number): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener(code);
  }

  private open(frame: Buffer): unknown {
    if (frame.length < 8 + 16 || frame.length > MAX_FRAME) return undefined;
    const counter = frame.readBigUInt64BE(0);
    if (counter <= this.receiveCounter) return undefined; // replay or reorder
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(counter, 4);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.keys.receive, nonce);
      decipher.setAuthTag(frame.subarray(frame.length - 16));
      const plain = Buffer.concat([decipher.update(frame.subarray(8, frame.length - 16)), decipher.final()]);
      this.receiveCounter = counter;
      return JSON.parse(plain.toString('utf8'));
    } catch {
      return undefined;
    }
  }
}

function nextText(socket: SocketLike, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(new Error('Handshake timed out')), timeoutMs);
    timer.unref?.();
    const finish = (error?: Error, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    socket.onMessage((data, isText) => {
      if (done) return;
      if (!isText || data.length > 4096) return finish(new Error('Handshake: unexpected frame'));
      try { finish(undefined, JSON.parse(data.toString('utf8'))); } catch { finish(new Error('Handshake: invalid JSON')); }
    });
    socket.onClose(() => finish(new Error('Handshake: socket closed')));
  });
}

/** Dials side: proves our identity and checks the peer is the expected fingerprint. */
export async function connectSecure(socket: SocketLike, self: Signer, expectFingerprint: string, timeoutMs = 10_000): Promise<SecureChannel> {
  const hello = clientHello(self);
  const reply = nextText(socket, timeoutMs);
  socket.send(JSON.stringify(hello.message));
  const welcome = (await reply) as WelcomeMessage;
  const done = clientFinish(self, hello.state, welcome);
  if (fingerprintOf(done.peerPub) !== expectFingerprint) {
    socket.close(REFUSED_CLOSE, 'unexpected peer');
    throw new Error('Peer key does not match the paired device');
  }
  // Construct before sending auth so the first encrypted frame is never missed.
  const channel = new SecureChannel(socket, done.keys, done.peerId, done.peerPub);
  socket.send(JSON.stringify(done.message));
  return channel;
}

/** Listening side. `trust` maps the peer's public key to a known device id (or rejects). */
export async function acceptSecure(socket: SocketLike, self: Signer, trust: (peerPub: Buffer, claimedId: string) => string | undefined, timeoutMs = 10_000): Promise<SecureChannel> {
  const hello = (await nextText(socket, timeoutMs)) as HelloMessage;
  const server = serverWelcome(self, hello);
  if (server.peerPub.equals(self.publicKey)) {
    // B-087: my own dial came back (an address of another PC that leads here) – 4000, so my dial falls through, unrefused
    socket.close(4000, 'self');
    throw new Error('A dial of this PC reached this PC itself');
  }
  const deviceId = trust(server.peerPub, server.peerId);
  if (!deviceId) {
    socket.close(REFUSED_CLOSE, 'unknown device');
    throw new Error('Unknown device');
  }
  const authPromise = nextText(socket, timeoutMs);
  // Frames the client sends right after its auth message may arrive before we build the channel.
  const early: Buffer[] = [];
  let ready = false;
  socket.onMessage((data, isText) => { if (!isText && !ready) early.push(data); });
  socket.send(JSON.stringify(server.message));
  const keys = server.verifyAuth((await authPromise) as AuthMessage);
  if (!keys) {
    socket.close(REFUSED_CLOSE, 'bad signature');
    throw new Error('Peer signature invalid');
  }
  const channel = new SecureChannel(socket, keys, deviceId, server.peerPub);
  ready = true;
  channel.feed(early);
  return channel;
}
