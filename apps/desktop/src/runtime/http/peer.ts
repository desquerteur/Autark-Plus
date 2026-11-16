// Routes for linked PCs: `GET /.well-known/workforce` (public identity probe),
// `POST /peer/pair` (pairing proofs, ≤ 64 KB, rate-limited per address) and the `GET /peer`
// WebSocket upgrade handed to the device mesh (pinned-key handshake + encrypted channel).
// The runtime HTTP server (server.ts) routes them among its other routes; PeerRoutes builds the
// servers of the dedicated peer listener (peer-server.ts), which answer 404 to every other path.
// Owns: the HTTP side of these routes, the Host/Origin/tailnet gate of the peer listener and the
// peer sockets it accepted. B-080: a peer socket the keepalive cuts after a minute without any frame is logged
// ('peer socket silent') and marked, so the mesh's 'peer link closed' line says code 4008 (devices/channel.ts).
// F29 stage 1 (16.11.2026): only on the peer listener, `GET /peer/phone` – the Android app's own socket (the pinned
// handshake, then its streams; devices/rendezvous/phone.ts acceptDirect trusts only accepted phones' keys). It is pinged
// every 30 s like the meeting server pings the phone, so the direct socket wakes the phone no more often than the server.
// Sockets before their handshake (both paths): at most MAX_HANDSHAKES_PER_ADDRESS per address, and a closed socket whose
// other side never answers the close frame is cut after PEER_CLOSE_WAIT_MS – one client cannot fill the MAX_PEERS slots.
// Never: decides trust (pairing/mesh/phone bridge do), reads anything but the request
// body, or listens itself (peer-server.ts decides when and where).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer, type ServerOptions, type WebSocket } from 'ws';
import { markSilent, wrapWs, type SocketLike } from '../devices/channel.ts';
import type { Logger } from '../contracts.ts';
import { HttpError, readJson, sendBodyError, sendError, sendJson } from './body.ts';
import { closedSocket, header, rejectUpgrade, requestInfo, safePath } from './request.ts';
import { HostGuard, RateLimiter, isSecureTransport, normalizeAddress, type InterfacesFn } from './security.ts';
import type { MeshAccept, PairingHttp, RequestInfo } from './types.ts';
import { Keepalive, KEEPALIVE_MS } from './keepalive.ts';

export const PAIR_BODY_LIMIT = 64 * 1024;
/** The peer channel allows 8 MB encrypted frames (devices/channel.ts). */
export const PEER_MAX_PAYLOAD = 8 * 1024 * 1024 + 1024;
/** Peer sockets one server accepts at a time. */
export const MAX_PEERS = 32;
/** Sockets of one address before their handshake finished: one client never holds every MAX_PEERS slot. */
export const MAX_HANDSHAKES_PER_ADDRESS = 4;
/** After close() a socket waits this long for the other side's close frame, then it is cut (ws waits 30 s by default). */
export const PEER_CLOSE_WAIT_MS = 2_000;
/** Linked-PC routes: their pairing proofs and encrypted channel apply on every bind. */
export const PEER_PATHS: ReadonlySet<string> = new Set(['/peer', '/peer/pair', '/.well-known/workforce']);
/** F29: the phone app's direct socket (the peer listener only). */
export const PHONE_PEER_PATH = '/peer/phone';
/** The meeting server pings a phone every 30 s; its direct socket gets the same pace. */
export const PHONE_KEEPALIVE_MS = 30_000;

/** The phone bridge's side of /peer/phone (devices/rendezvous/phone.ts): the device id of an accepted phone, else it throws. */
export interface PhoneAccept {
  acceptDirect(socket: SocketLike): Promise<string>;
}

export function serveWellKnown(req: IncomingMessage, res: ServerResponse, pairing: PairingHttp): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'bad_request', 'Method not allowed.', { Allow: 'GET, HEAD' });
    return;
  }
  sendJson(res, 200, pairing.wellKnown());
}

export async function servePair(req: IncomingMessage, res: ServerResponse, info: RequestInfo, deps: { pairing: PairingHttp; limiter: RateLimiter; log: () => Logger }): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'bad_request', 'Method not allowed.', { Allow: 'POST' });
    return;
  }
  if (!deps.limiter.take(info.remote || 'unknown')) {
    sendJson(res, 429, { ok: false, error: { code: 'rate_limited', message: 'Too many pairing attempts. Try again in a minute.' } }, { 'Retry-After': '60' });
    return;
  }
  let body: unknown;
  try {
    body = await readJson(req, PAIR_BODY_LIMIT);
  } catch (error) {
    if (error instanceof HttpError) {
      sendBodyError(req, res, error, (failure) => ({ ok: false, error: { code: failure.code, message: failure.message } }));
      return;
    }
    throw error;
  }
  try {
    sendJson(res, 200, await deps.pairing.handle(body, { address: info.remote || undefined }));
  } catch (error) {
    deps.log().warn('pairing request failed', { error: error instanceof Error ? error.message : String(error) });
    sendJson(res, 500, { ok: false, error: { code: 'internal', message: 'Pairing failed.' } });
  }
}

/** Hands an upgraded `/peer` socket to the mesh; a failed handshake closes it. 'peer connected' only for a link that stays. True once the handshake succeeded. */
export function acceptPeer(ws: WebSocket, deps: { mesh: MeshAccept; log: () => Logger }, remote: string): Promise<boolean> {
  // `ws` emits 'error' for protocol violations (oversized frame …); without a listener it throws.
  ws.on('error', (error) => deps.log().debug('peer socket error', { remote, error: error.message }));
  return deps.mesh.accept(wrapWs(ws)).then(
    // B-087: a link the mesh closed at once (the other link of a race stays) is no reconnect – agents watch these lines
    (deviceId) => {
      if (deviceId) deps.log().info('peer connected', { deviceId, remote }); else deps.log().debug('peer link not kept (the other link stays)', { remote });
      return true;
    },
    (error: unknown) => {
      deps.log().warn('peer handshake failed', { remote, error: error instanceof Error ? error.message : String(error) });
      // B-077: 4000, not the refusal 4003 – a refusal (unknown device, bad key) already closed with 4003 in devices/channel.ts;
      // anything else (a slow handshake) must not stop the other PC from trying again.
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(4000, 'handshake failed');
      return false;
    },
  );
}

/** F29: hands an upgraded `/peer/phone` socket to the phone bridge; a refused key was closed with 4003 in the handshake already. True once the handshake succeeded. */
export function acceptPhone(ws: WebSocket, deps: { phones: PhoneAccept; log: () => Logger }, remote: string): Promise<boolean> {
  ws.on('error', (error) => deps.log().debug('phone socket error', { remote, error: error.message }));
  return deps.phones.acceptDirect(wrapWs(ws)).then(
    (deviceId) => { deps.log().info('phone connected directly', { deviceId, remote }); return true; },
    (error: unknown) => {
      deps.log().info('phone handshake failed', { remote, error: error instanceof Error ? error.message : String(error) });
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(4000, 'handshake failed');
      return false;
    },
  );
}

/** 'tailscale' servers answer tailnet peers only (they listen on tailnet addresses anyway). */
export type PeerListenMode = 'lan' | 'tailscale';

export interface PeerRoutesDeps {
  pairing: PairingHttp;
  mesh: MeshAccept;
  /** F29: the phone app's direct sockets (absent: /peer/phone answers 404). */
  phones?: PhoneAccept;
  log: () => Logger;
  interfaces?: InterfacesFn;
  /** Extra Host names to accept (the MagicDNS name). */
  allowedHosts?: () => string[];
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Servers of the dedicated peer listener: the three peer paths, 404 for everything else. */
export class PeerRoutes {
  private readonly deps: PeerRoutesDeps;
  private readonly guard: HostGuard;
  private readonly limiter = new RateLimiter(30, 60_000);
  private readonly keepalive = new Keepalive(KEEPALIVE_MS, Date.now, (ws, ms) => { markSilent(ws); this.deps.log().info('peer socket silent', { ms }); });
  private readonly phoneKeepalive = new Keepalive(PHONE_KEEPALIVE_MS, Date.now, (ws, ms) => { markSilent(ws); this.deps.log().info('phone socket silent', { ms }); });
  // closeTimeout is in ws 8.22, not yet in its types
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: PEER_MAX_PAYLOAD, perMessageDeflate: false, clientTracking: false, closeTimeout: PEER_CLOSE_WAIT_MS } as ServerOptions);
  private readonly peers = new Set<WebSocket>();
  /** Sockets per remote address whose handshake has not finished. */
  private readonly handshakes = new Map<string, number>();
  private closed = false;

  constructor(deps: PeerRoutesDeps) {
    this.deps = deps;
    this.guard = new HostGuard({ interfaces: deps.interfaces, extra: deps.allowedHosts });
  }

  /** A new (not yet listening) server; its sockets outlive it until closeSockets(). */
  createServer(mode: PeerListenMode): Server {
    const server = createServer((req, res) => this.onRequest(req, res, mode));
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.onUpgrade(req, socket, head, mode));
    server.on('clientError', (_error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      else socket.destroy();
    });
    server.on('error', (error) => this.deps.log().debug('peer listener error', { error: errorText(error) }));
    server.headersTimeout = 30_000;
    server.requestTimeout = 120_000;
    return server;
  }

  /** Shutdown: closes the peer sockets accepted here (close frames first, then cut). */
  async closeSockets(): Promise<void> {
    this.closed = true;
    const sockets = [...this.peers];
    for (const ws of sockets) ws.close(1001, 'server closing');
    await Promise.race([Promise.all(sockets.map(closedSocket)), delay(500, undefined, { ref: false })]);
    for (const ws of this.peers) ws.terminate();
    this.keepalive.stop();
    this.phoneKeepalive.stop();
    this.wss.close();
  }

  private onRequest(req: IncomingMessage, res: ServerResponse, mode: PeerListenMode): void {
    this.route(req, res, mode).catch((error: unknown) => {
      this.deps.log().error('peer request failed', { path: safePath(req), error: errorText(error) });
      if (!res.headersSent) sendError(res, 500, 'internal', 'Something went wrong. It was logged.');
      else res.destroy();
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse, mode: PeerListenMode): Promise<void> {
    const info = requestInfo(req);
    if (!info) return sendError(res, 400, 'bad_request', 'Invalid request URL.');
    const path = info.url.pathname;
    if (!PEER_PATHS.has(path) && !(path === PHONE_PEER_PATH && this.deps.phones)) return sendError(res, 404, 'not_found', 'Not found.');
    const refused = this.refuse(req, info, mode, false);
    if (refused) return sendError(res, 403, 'forbidden', refused);
    if (path === '/.well-known/workforce') return serveWellKnown(req, res, this.deps.pairing);
    if (path === '/peer/pair') return servePair(req, res, info, { pairing: this.deps.pairing, limiter: this.limiter, log: this.deps.log });
    return sendError(res, 426, 'bad_request', 'WebSocket upgrade required.', { Upgrade: 'websocket' });
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, mode: PeerListenMode): void {
    socket.on('error', () => socket.destroy());
    const info = requestInfo(req);
    if (!info || this.closed) return rejectUpgrade(socket, 503);
    const phones = info.url.pathname === PHONE_PEER_PATH ? this.deps.phones : undefined;
    if (info.url.pathname !== '/peer' && !phones) return rejectUpgrade(socket, 404);
    if (this.refuse(req, info, mode, true)) return rejectUpgrade(socket, 403);
    if (this.peers.size >= MAX_PEERS || (this.handshakes.get(info.remote) ?? 0) >= MAX_HANDSHAKES_PER_ADDRESS) return rejectUpgrade(socket, 503);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.peers.add(ws);
      const finished = this.handshaking(info.remote);
      ws.once('close', () => { this.peers.delete(ws); finished(); });
      if (phones) this.phoneKeepalive.add(ws); else this.keepalive.add(ws);
      const accepted = phones ? acceptPhone(ws, { phones, log: this.deps.log }, info.remote) : acceptPeer(ws, { mesh: this.deps.mesh, log: this.deps.log }, info.remote);
      void accepted.then((ok) => { if (ok) finished(); });
    });
  }

  /** Counts a socket of `remote` until its handshake succeeds or it closes; the returned function ends that, once. */
  private handshaking(remote: string): () => void {
    this.handshakes.set(remote, (this.handshakes.get(remote) ?? 0) + 1);
    let counted = true;
    return () => {
      if (!counted) return;
      counted = false;
      const left = (this.handshakes.get(remote) ?? 1) - 1;
      if (left > 0) this.handshakes.set(remote, left); else this.handshakes.delete(remote);
    };
  }

  /** Host allowlist (DNS rebinding), Origin for state changes and upgrades, the tailnet-only gate. */
  private refuse(req: IncomingMessage, info: RequestInfo, mode: PeerListenMode, upgrade: boolean): string | undefined {
    if (!this.guard.allows(req.headers.host)) return 'Host not allowed.';
    const method = req.method ?? 'GET';
    if ((upgrade || (method !== 'GET' && method !== 'HEAD')) && !this.guard.allowsOrigin(header(req.headers.origin))) return 'Origin not allowed.';
    if (mode === 'tailscale' && !isSecureTransport(info.remote, normalizeAddress(req.socket.localAddress))) return 'This PC accepts linked PCs only over its tailnet.';
    return undefined;
  }
}
