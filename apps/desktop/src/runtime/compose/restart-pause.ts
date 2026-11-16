// The restart pause (system.prepareRestart): right before the updater stops this runtime for an install it pauses agent
// work here (the dispatcher stops, running turns go back to the queue) and checkpoints the database. A pause no restart
// follows – the call came from somewhere other than the updater, an agent's script among them (16.11.2026: an agent's
// own update script paused its company and the pause cut the script off, so agent work stayed stopped for hours), or
// the installer never started – ends by itself after RESTART_PAUSE_MS: work goes on and the install record is answered.
// Since 16.11. evening only main's own link pauses (rpc/handlers/system.ts), each pause leaves a log line, and the
// shutdown closes it first (compose/lifecycle.ts), so a timer running out during a stop never starts agent work again.
// Owns: the pause, its cancel, its end by time and its close at shutdown. Never: decides on an update or stops the runtime itself.

export const RESTART_PAUSE_MS = 2 * 60_000;

export interface RestartPauseDeps {
  /** Stops agent work for the restart (dispatcher.stop). */
  stop(): Promise<void>;
  /** Starts agent work again (dispatcher.start). */
  start(): void;
  /** The install did not happen: its record is answered (recover-notes.ts dropInstall). */
  dropped(): void;
  log(message: string, data?: Record<string, unknown>): void;
  ms?: number;
}

export class RestartPause {
  private readonly deps: RestartPauseDeps;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private paused = false;
  private closed = false;

  constructor(deps: RestartPauseDeps) { this.deps = deps; }

  get active(): boolean { return this.paused; }

  /** Pauses agent work until the restart, a cancel or RESTART_PAUSE_MS later – whichever comes first. */
  async pause(): Promise<void> {
    if (this.closed) return; // the runtime is stopping: its dispatcher stops there
    this.clear();
    this.paused = true;
    const ms = this.deps.ms ?? RESTART_PAUSE_MS;
    this.timer = setTimeout(() => this.end('expired'), ms);
    this.timer.unref?.();
    this.deps.log('restart pause started: agent work stops for the restart, back by itself if none follows', { ms });
    await this.deps.stop();
  }

  /** The restart did not happen (cancel) or did not come in time (expired): the install record is answered, work goes on. */
  end(why: 'cancel' | 'expired'): void {
    if (this.closed) return;
    this.clear();
    this.deps.dropped();
    if (!this.paused) return;
    this.paused = false;
    this.deps.start();
    this.deps.log(why === 'expired' ? 'restart pause ended: no restart came, agent work resumed' : 'restart pause cancelled, agent work resumed', { why });
  }

  /** The runtime stops (the first shutdown step): the timer ends, and nothing here starts agent work or answers a record again. */
  close(): void {
    this.closed = true;
    this.paused = false;
    this.clear();
  }

  private clear(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
