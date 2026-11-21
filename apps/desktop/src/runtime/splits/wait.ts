// Parts that answer inside the turn that split them (KI-Runde 17.11.2026, decision 10; measured: leads did their
// finding-out by hand because a part only started when their turn ended, while 15 % of runs held 76 % of all tool calls
// at 340k–430k tokens per call): the parts of an `agents.split {wait: true}` start at once and the call that split them
// holds – until every one of them ended, until the wait's bound, until a line for that turn arrives (a person's line, an
// important line, a call voice's 'now' – the dispatcher ends the run's wait, so the turn reaches its next step and reads
// it) or until the call is cut. While a wait is open no part's end wakes the origin and a part's note to it goes into
// that call's result (gather.ts, service.ts).
// Owns: the open waits by run, their bound and the notes they collect. Never: starts, ends or stops a part (runner.ts),
// or writes a row.

import { SPLIT_TERMINAL, type Split } from '../../shared/model/splits.ts';
import { HUB_CALL_MS } from '../engines/claude/lean.ts';
import { STALL_TOOL_MS } from '../agents/stall-watch.ts';

/** How a wait ended: every part came back; 'early' – its bound or a line for the turn ended it, the call answers with
 *  what is there; 'stopped' – the call was cut or its turn is over, so its answer reaches nobody. */
export type WaitEnd = 'parts' | 'early' | 'stopped';

/** A note a part sent the origin that waits for it. */
export interface WaitNote { splitId: string; text: string }

/** What the waiting `agents.split` call brings back: the parts' results as its next turn would have read them. */
export interface SplitWaited { text: string; ended: WaitEnd }

/**
 * The wait's bound: the hub cuts a call that runs longer than HUB_CALL_MS and the stall watch a turn whose call stays
 * silent for STALL_TOOL_MS (agents/stall-watch.ts), so the wait ends a minute before the first of them with what is there.
 */
export const WAIT_MS = Math.min(HUB_CALL_MS, STALL_TOOL_MS) - 60_000;

interface Open { runId: string; ids: Set<string>; notes: WaitNote[]; end(how: WaitEnd): void }

export class SplitWaits {
  private readonly read: (splitId: string) => Split | undefined;
  private readonly open = new Set<Open>();

  constructor(read: (splitId: string) => Split | undefined) {
    this.read = read;
  }

  /** Does the turn that split this part wait for it right now? */
  waiting(splitId: string): boolean {
    for (const entry of this.open) if (entry.ids.has(splitId)) return true;
    return false;
  }

  /** A part's note for the origin that waits for it – it rides in the call's result; false when nobody waits for it. */
  note(splitId: string, text: string): boolean {
    let taken = false;
    for (const entry of this.open) {
      if (!entry.ids.has(splitId)) continue;
      entry.notes.push({ splitId, text });
      taken = true;
    }
    return taken;
  }

  /** Ends the open waits of run `runId` as `how`; the ids of the parts they waited for. */
  end(runId: string, how: WaitEnd): string[] {
    const ids: string[] = [];
    for (const entry of [...this.open]) {
      if (entry.runId !== runId) continue;
      ids.push(...entry.ids);
      entry.end(how);
    }
    return ids;
  }

  /** Every wait whose parts have all ended is over (runner.ts calls this after a part ended or was stopped). */
  look(): void {
    for (const entry of [...this.open]) if (this.allEnded(entry)) entry.end('parts');
  }

  /** Run `runId` holds while those parts work: ends when they have all ended, after `limit`, through end() or when `signal` aborts. */
  async hold(runId: string, splitIds: readonly string[], signal: AbortSignal, limit = WAIT_MS): Promise<{ ended: WaitEnd; notes: WaitNote[] }> {
    const entry: Open = { runId, ids: new Set(splitIds), notes: [], end: () => {} };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped: (() => void) | undefined;
    try {
      const ended = await new Promise<WaitEnd>((resolve) => {
        let done = false;
        entry.end = (how) => { if (!done) { done = true; resolve(how); } };
        this.open.add(entry);
        timer = setTimeout(() => entry.end('early'), Math.max(1, limit));
        timer.unref?.();
        stopped = () => entry.end('stopped');
        if (signal.aborted) stopped();
        else signal.addEventListener('abort', stopped, { once: true });
        if (this.allEnded(entry)) entry.end('parts');
      });
      return { ended, notes: entry.notes };
    } finally {
      this.open.delete(entry);
      if (timer) clearTimeout(timer);
      if (stopped) signal.removeEventListener('abort', stopped);
    }
  }

  private allEnded(entry: Open): boolean {
    for (const id of entry.ids) {
      const split = this.read(id);
      if (split && !SPLIT_TERMINAL.includes(split.status)) return false;
    }
    return true;
  }
}
