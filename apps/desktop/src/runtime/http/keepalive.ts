// The shared ping keepalive for every upgraded socket (client + peer), split out of http/ws.ts in C8 (ws.ts re-exports
// it, so imports stay the same): one interval for all sockets, armed only while sockets exist. B-077 (owner 05.11.2026:
// changes pushed at once, like a realtime database): a ping every 15 s, on BOTH ends of a link between PCs
// (compose/peer-dial.ts uses it for the sockets this PC dials), so a dead link closes on either side and the mesh's
// retry and catch-up start. Any frame counts as life, not only the pong (a pong can wait behind a big frame), and a tick
// that comes late because this process itself stalled pings again without terminating anyone.
// B-080 (live 07./08.11.2026: links between reachable PCs were cut and redialed 1–2 s later; the low-RAM notebook and
// the server stalled for up to 70 s): a socket is terminated only after SILENT_MS (a minute, 4 pings) without any
// frame – a stall of up to a minute on either PC keeps the link, a dead link still closes within about 60–75 s.
// `onSilent` hears the socket and its silence just before it is cut (the peer sockets mark and log it).
// Owns: that interval and the last-life times. Never: closes healthy sockets or keeps one after close.

import type { WebSocket } from 'ws';

export const KEEPALIVE_MS = 15_000;
/** Pings without any frame back before a socket is cut (B-080). */
const SILENT_PINGS = 4;

/** One interval for all sockets, armed only while sockets exist; peers silent for SILENT_PINGS intervals are terminated. */
export class Keepalive {
  private readonly sockets = new Map<WebSocket, { lastLife: number }>();
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly onSilent?: (ws: WebSocket, silentMs: number) => void;
  private timer?: ReturnType<typeof setInterval>;
  private last = 0;

  constructor(intervalMs = KEEPALIVE_MS, now: () => number = Date.now, onSilent?: (ws: WebSocket, silentMs: number) => void) {
    this.intervalMs = intervalMs;
    this.now = now;
    this.onSilent = onSilent;
  }

  /** How long a socket may stay without any frame (a minute at the default interval). */
  get silentMs(): number { return this.intervalMs * SILENT_PINGS; }

  add(ws: WebSocket): void {
    const state = { lastLife: this.now() };
    this.sockets.set(ws, state);
    const alive = () => { state.lastLife = this.now(); };
    ws.on('pong', alive);
    ws.on('message', alive);
    ws.once('close', () => this.remove(ws));
    if (!this.timer) {
      this.last = this.now();
      this.timer = setInterval(() => this.tick(), this.intervalMs);
      this.timer.unref?.();
    }
  }

  remove(ws: WebSocket): void {
    this.sockets.delete(ws);
    if (!this.sockets.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  all(): WebSocket[] {
    return [...this.sockets.keys()];
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.sockets.clear();
  }

  /** Exposed for tests: one round of the interval. */
  tick(): void {
    const now = this.now();
    const late = now - this.last > this.intervalMs * 1.5; // this process stalled: the answers may sit unread
    this.last = now;
    for (const [ws, state] of this.sockets) {
      const silent = now - state.lastLife;
      if (silent > this.silentMs && !late) {
        try { this.onSilent?.(ws, silent); } catch { /* a log line only */ }
        ws.terminate();
        this.remove(ws);
        continue;
      }
      try { ws.ping(); } catch { /* closing */ }
    }
  }
}
