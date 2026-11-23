// JSON-RPC over a SecureChannel: request/response with ids, timeouts, abort and handlers.
// A call refused before anything was sent (the channel was already closed, or closed under the
// send) carries details.reachable false – the other PC never saw it, so callers report a plain
// failure, not an unknown effect. B-080 (live 07.11.2026: a shell.exec and a demo on the notebook died with the
// link): a closed link no longer aborts the handlers running here – each runs to its end and its answer is dropped;
// only the caller's own stop (a `cancel` frame) aborts one. The caller's pending calls end with LINK_DROPPED. A link this
// PC ends on purpose – the person removed that PC, or this PC quits or updates (mesh.ts revoke/close) – goes through
// stop(), which aborts the handlers running here first (a shell.exec's process tree ends with them).
// B-087: a message too large for the link (channel.ts) never leaves: a call fails with that error, and an answer too large
// (a long full-page screenshot) goes back as an error naming it, so the link and every other call on it stay.
// Owns: correlation of calls, error mapping to WorkforceError data. Never: transport or
// handshake (channel.ts) and never retries a call (effects must not run twice).

import { WorkforceError, toErrorData, type WorkforceErrorData } from '../../shared/errors.ts';
import type { SecureChannel } from './channel.ts';

export type PeerHandler = (params: unknown, fromDeviceId: string, signal: AbortSignal) => Promise<unknown>;

interface Frame {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: WorkforceErrorData;
  cancel?: number; // id of a request the caller aborted
}

/** Refused before the request left this PC. */
const unsent = () => new WorkforceError('unavailable', 'The linked device is offline.', { details: { reachable: false } });
/** A sent call whose link closed before its answer came (its effect there is unknown). */
export const LINK_DROPPED = 'The link dropped while the call ran; on that PC it runs on to its end – its answer did not come back.';

export class RpcPeer {
  readonly channel: SecureChannel;
  private nextId = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private running = new Map<number, AbortController>();
  private handlers: (method: string) => PeerHandler | undefined;
  private idleListeners: Array<() => void> = [];

  constructor(channel: SecureChannel, handlers: (method: string) => PeerHandler | undefined) {
    this.channel = channel;
    this.handlers = handlers;
    channel.onMessage((message) => this.receive(message as Frame));
    channel.onClose(() => {
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new WorkforceError('unavailable', LINK_DROPPED));
        this.pending.delete(id);
      }
      // B-080: the handlers running here go on (serve drops their answers); a link's end is no one's stop
      this.settled();
    });
  }

  /** B-080: this PC ends the link on purpose: every handler running here for that PC is aborted, then the channel closes. */
  stop(): void {
    for (const controller of this.running.values()) controller.abort();
    this.channel.close();
  }

  /** No call in flight either way (a relayed link may then be swapped for a direct one, mesh.ts). */
  idle(): boolean { return this.pending.size === 0 && this.running.size === 0; }

  /**
   * Runs `listener` once no call is in flight either way – at once when that is already so – or
   * when the channel closed (check `channel.closed`). An event, never a timer.
   */
  whenIdle(listener: () => void): void {
    if (this.channel.closed || this.idle()) { listener(); return; }
    this.idleListeners.push(listener);
  }

  private settled(): void {
    if (!this.idleListeners.length || !(this.channel.closed || this.idle())) return;
    for (const listener of this.idleListeners.splice(0)) listener();
  }

  call(method: string, params: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    if (this.channel.closed) return Promise.reject(unsent());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WorkforceError('timeout', 'The linked device did not answer in time.'));
        this.settled();
      }, options.timeoutMs ?? 120_000);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      options.signal?.addEventListener('abort', () => {
        if (!this.pending.has(id)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        try { this.channel.send({ cancel: id }); } catch { /* closed */ }
        reject(new WorkforceError('cancelled', 'Cancelled.'));
        this.settled();
      }, { once: true });
      try {
        this.channel.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof WorkforceError ? error : unsent()); // B-087: too large for the link says so, not "offline"
        this.settled();
      }
    });
  }

  private receive(frame: Frame): void {
    if (typeof frame !== 'object' || frame === null) return;
    if (typeof frame.cancel === 'number') {
      this.running.get(frame.cancel)?.abort();
      return;
    }
    if (typeof frame.method === 'string' && typeof frame.id === 'number') {
      void this.serve(frame.id, frame.method, frame.params);
      return;
    }
    if (typeof frame.id === 'number') {
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(frame.id);
      if (frame.error) entry.reject(new WorkforceError(frame.error.code, frame.error.message, { details: frame.error.details }));
      else entry.resolve(frame.result);
      this.settled();
    }
  }

  private async serve(id: number, method: string, params: unknown): Promise<void> {
    const handler = this.handlers(method);
    const controller = new AbortController();
    this.running.set(id, controller);
    let reply: Frame;
    try {
      if (!handler) throw new WorkforceError('not_found', `Unknown peer method ${method}.`);
      reply = { id, result: await handler(params, this.channel.peerId, controller.signal) };
    } catch (error) {
      reply = { id, error: toErrorData(error) };
    } finally {
      this.running.delete(id);
    }
    if (!this.channel.closed) {
      try { this.channel.send(reply); } catch (error) {
        // B-087: the answer is too large for the link – the caller hears that instead (the effect here happened)
        const why = error instanceof Error ? error.message : String(error);
        try { this.channel.send({ id, error: toErrorData(new WorkforceError('bad_request', `The call ran on that PC, but its answer did not come back. ${why}`)) }); } catch { /* closed */ }
      }
    }
    this.settled(); // after the reply left: a link closed when idle never swallows an answer
  }
}
