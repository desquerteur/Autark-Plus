// B-080 (owner 08.11.2026: a new line goes into the running turn "mittendrin", as in Codex and Claude Code): folds of one
// agent and chat run one after another – two lines sent quickly each started a fold, the second read from a cursor the
// first had not moved yet and the turn got the first line twice – and a fold the engine refused because its turn could
// not take it yet (the turn's input was fixed, but its engine had not started: a session rebuild, a compaction or a purge
// before it; live 05.–08.11.2026 a rebuild took 4.5 min and the person's line waited for the whole turn: same chat median
// 535 s, 0 of 18 lines folded) is tried again every STEER_RETRY_MS while that same turn runs. A held line or a line the
// turn already has is not tried again; when the turn ends, the queued wake brings the line in the next turn as before.
// Owns: that order, the retry and its timers. Never: steers itself (dispatch-steer.ts does), moves a cursor, or outlives stop().

import type { SteerResult } from './dispatch-steer.ts';

/** How often a refused fold is tried again while its turn runs. */
export const STEER_RETRY_MS = 2000;

/** Folds per agent and chat: one at a time, refused ones tried again, all stopped with the dispatcher. */
export class FoldRetries {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly chains = new Map<string, Promise<SteerResult>>();
  private readonly retryMs: number;

  constructor(retryMs = STEER_RETRY_MS) { this.retryMs = retryMs; }

  /**
   * Folds after the fold before it for this key; on 'refused' tries again every retryMs while `stillRunning`, until the
   * turn takes the lines or holds one. Resolves with this try ('all' = the turn has every line now).
   */
  async fold(key: string, attempt: () => Promise<SteerResult>, stillRunning: () => boolean): Promise<SteerResult> {
    const result = await this.serial(key, attempt);
    if (result === 'refused' && stillRunning()) this.arm(key, attempt, stillRunning);
    return result;
  }

  private serial(key: string, attempt: () => Promise<SteerResult>): Promise<SteerResult> {
    const run = () => attempt().catch((): SteerResult => 'refused');
    const next = (this.chains.get(key) ?? Promise.resolve<SteerResult>('all')).then(run, run);
    this.chains.set(key, next);
    void next.finally(() => { if (this.chains.get(key) === next) this.chains.delete(key); });
    return next;
  }

  private arm(key: string, attempt: () => Promise<SteerResult>, stillRunning: () => boolean): void {
    if (this.timers.has(key)) return; // one retry per agent and chat: it reads every unseen line anyway
    const timer = setTimeout(() => {
      this.timers.delete(key);
      if (!stillRunning()) return;
      void this.serial(key, attempt).then((result) => { if (result === 'refused' && stillRunning()) this.arm(key, attempt, stillRunning); });
    }, this.retryMs);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  /** Is a retry armed for this agent and chat (tests)? */
  armed(key: string): boolean { return this.timers.has(key); }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
