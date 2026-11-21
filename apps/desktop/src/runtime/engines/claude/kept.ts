// A Claude Code conversation kept open for a call's voice (KI-Runde 17.11.2026, decision 7.1): one `claude -p` stream-json
// process that takes one user message per spoken line and answers each with one result, for as long as the call runs.
// The engine (engine.ts keepOpen at the call's start, or run with `keep`) starts it like a helper turn – our system prompt only, no tools, no MCP, no
// transcript on disk (--no-session-persistence) – and its session ref is the id it was started with; a later line with that
// ref is written into the same process, so the CLI and the cached prompt are already there. Lines on one process run one
// after the other; a stopped line is interrupted inside the process (control_request interrupt), and a process that does
// not answer the interrupt within STOP_MS is let go. `close` (Engine.unload at the call's end) ends its input, so the CLI
// ends by itself; a process idle for IDLE_MS is closed the same way.
// Owns: the kept processes, their lines and their end. Never: a hard kill while the CLI may still save a sign-in (it ends
// by itself; the supervisor's grace kills its tree only after), or a line written into a process another line still runs on.

import type { Lease, Supervisor } from '../../system/supervisor.ts';
import type { WorkforceErrorData } from '../../../shared/errors.ts';
import type { EngineEvent } from '../types.ts';
import { readJsonLines, isRecord } from '../shared.ts';
import { ClaudeStreamParser } from './stream.ts';

/** A stopped line's process gets this long to answer the interrupt before it is let go. */
export const STOP_MS = 3000;
/** A kept process nobody spoke to for this long is closed (the call's end normally closes it first). */
export const IDLE_MS = 10 * 60_000;

/** A line for a kept process that is gone: the caller says it again on a new one, with the call so far in front. */
export const KEPT_GONE: WorkforceErrorData = { code: 'conflict', message: 'The kept Claude Code process of this call has ended.' };

/** How one line on a kept process ended: its parser (text, usage, errors), and whether it was stopped or the process broke. */
export interface KeptLine { parser: ClaudeStreamParser; interrupted: boolean; broken: boolean }

interface Proc {
  ref: string;
  accountId: string;
  lease: Lease;
  line?: { parser: ClaudeStreamParser; done: () => void };
  queue: Promise<unknown>;
  dead: boolean;
  idle?: ReturnType<typeof setTimeout>;
  /** Runs once when the first line ended or the process did (the prompt file is read by then). */
  read?: () => void;
}

export class ClaudeKept {
  private readonly procs = new Map<string, Proc>();
  private readonly deps: { supervisor: Supervisor; graceMs: number; now: () => number };

  constructor(deps: { supervisor: Supervisor; graceMs: number; now: () => number }) {
    this.deps = deps;
  }

  /** Whether a process for this ref still runs (a line with it is written there). */
  has(ref: string | undefined): boolean {
    const proc = ref ? this.procs.get(ref) : undefined;
    return Boolean(proc && !proc.dead);
  }

  /** Starts the process of a new conversation; `ref` is the session id it was started with, `read` runs once its prompt is read. */
  start(ref: string, accountId: string, spawn: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }, read?: () => void): void {
    const lease = this.deps.supervisor.spawn({ ...spawn, owner: `claude:kept:${ref}`, kind: 'heavy', stdio: ['pipe', 'pipe', 'ignore'] });
    const proc: Proc = { ref, accountId, lease, queue: Promise.resolve(), dead: false, read };
    this.procs.set(ref, proc);
    const gone = () => {
      proc.dead = true;
      if (this.procs.get(ref) === proc) this.procs.delete(ref);
      if (proc.idle) clearTimeout(proc.idle);
      proc.line?.done();
      this.read(proc);
    };
    lease.child.stdin?.on('error', () => {});
    if (!lease.child.stdout) { gone(); return; }
    readJsonLines(lease.child.stdout, (message) => {
      lease.touch();
      const line = proc.line;
      if (!line) return;
      line.parser.push(message);
      if (isRecord(message) && message.type === 'result') line.done();
    }, gone);
    void lease.exited.then(gone);
  }

  /** One line on the kept process: written as one user message, answered by the next result. */
  say(ref: string, content: Array<Record<string, unknown>>, emit: (event: EngineEvent) => void, signal: AbortSignal): Promise<KeptLine> {
    const proc = this.procs.get(ref);
    const parser = new ClaudeStreamParser(emit, this.deps.now);
    if (!proc || proc.dead) return Promise.resolve({ parser, interrupted: false, broken: true });
    const run = proc.queue.then(() => this.line(proc, parser, content, signal));
    proc.queue = run.catch(() => undefined);
    return run;
  }

  /** The call ended: its input ends, the CLI ends by itself (its tree is killed only after the grace). */
  close(ref: string): void {
    const proc = this.procs.get(ref);
    if (!proc) return;
    this.procs.delete(ref);
    this.end(proc);
  }

  /** Every kept process of an account (its histories are purged) or of the app (shutdown). */
  closeAll(accountId?: string): void {
    for (const proc of [...this.procs.values()]) if (!accountId || proc.accountId === accountId) this.close(proc.ref);
  }

  private async line(proc: Proc, parser: ClaudeStreamParser, content: Array<Record<string, unknown>>, signal: AbortSignal): Promise<KeptLine> {
    if (proc.dead) return { parser, interrupted: false, broken: true };
    if (signal.aborted) return { parser, interrupted: true, broken: false };
    if (proc.idle) clearTimeout(proc.idle);
    let interrupted = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const finished = new Promise<void>((resolve) => { proc.line = { parser, done: resolve }; });
    const onAbort = () => {
      interrupted = true;
      try { proc.lease.child.stdin?.write(`${JSON.stringify({ type: 'control_request', request_id: 'interrupt', request: { subtype: 'interrupt' } })}\n`); } catch { /* gone */ }
      stopTimer = setTimeout(() => { this.close(proc.ref); proc.line?.done(); }, STOP_MS);
      stopTimer.unref?.();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      proc.lease.child.stdin?.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
      await finished;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (stopTimer) clearTimeout(stopTimer);
      proc.line = undefined;
      this.read(proc);
    }
    if (!proc.dead && this.procs.get(proc.ref) === proc) {
      proc.idle = setTimeout(() => this.close(proc.ref), IDLE_MS);
      proc.idle.unref?.();
    }
    return { parser, interrupted, broken: !parser.state.done };
  }

  private read(proc: Proc): void {
    const read = proc.read;
    proc.read = undefined;
    try { read?.(); } catch { /* the caller's own */ }
  }

  private end(proc: Proc): void {
    proc.dead = true;
    if (proc.idle) clearTimeout(proc.idle);
    try { proc.lease.child.stdin?.end(); } catch { /* gone */ }
    void proc.lease.releaseAfter(this.deps.graceMs);
    proc.line?.done();
  }
}
