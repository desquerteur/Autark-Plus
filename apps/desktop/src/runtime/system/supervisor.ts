// Process supervisor: every child process the runtime starts is a *lease*.
// Owns: spawning (below-normal priority, hidden windows), idle kill timers and kill trees
// (Windows `taskkill /T /F`, POSIX process groups).
// 07.11.2026: no admission any more – the RAM-based heavy slots (headroom.ts, "waiting for capacity") are gone; how many
// turns run is the dispatcher's one rule (agents/dispatcher.ts: every agent's own turn at once, splits share its cap).
// Login guard 03.11.: a lease can end gently (releaseAfter: the process exits by itself, its tree is killed only after a
// grace) and a group runs one lease at a time (spawnAlone; none starts any more once killAll ran) – for CLIs that may be
// saving a sign-in (accounts/cli.ts).
// I02: an optional env decorator (`env`) is applied to every spawned env – composition gives it the
// safe git env (git/safe-env.ts), so no engine, CLI or sign-in process runs repository hooks.
// Never: decides *what* or *how many* to run (engines/accounts and the dispatcher do) or polls – timers are per lease and reset by activity.

import { spawn as nodeSpawn } from 'node:child_process';
import * as nodeOs from 'node:os';
import type { Readable, Writable } from 'node:stream';

/** The part of ChildProcess the runtime uses (fakes in tests implement just this). */
export interface ChildLike {
  pid?: number;
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
}

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: Array<'pipe' | 'ignore'>;
  windowsHide?: boolean;
  detached?: boolean;
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildLike;

export interface OsLike {
  freemem(): number;
  cpuCount(): number;
  setPriority(pid: number, priority: number): void;
  platform: NodeJS.Platform;
}

export interface LeaseInfo {
  id: number;
  owner: string; // e.g. "codex:acc_…", "claude:run_…"
  kind: 'heavy' | 'light';
  pid?: number;
  startedAt: number;
  lastActiveAt: number;
}

export interface Lease extends LeaseInfo {
  child: ChildLike;
  /** spawnAlone: at most one running lease of this group. */
  group?: string;
  /** Marks activity (resets the idle timer). */
  touch(): void;
  /** Kills the process tree and ends the lease. Idempotent. */
  release(): Promise<void>;
  /** Lets the process exit by itself; kills its tree like release() only if it still runs after graceMs. Resolves when it is gone. */
  releaseAfter(graceMs: number): Promise<void>;
  /** Resolves when the process has exited. */
  exited: Promise<number | null>;
}

export interface SpawnInput {
  command: string; args: string[]; owner: string; kind?: 'heavy' | 'light'; cwd?: string; env?: NodeJS.ProcessEnv; stdio?: Array<'pipe' | 'ignore'>;
  idleMs?: number; onIdle?: () => void; group?: string;
}

export function defaultOs(): OsLike {
  return {
    freemem: () => nodeOs.freemem(),
    cpuCount: () => nodeOs.availableParallelism?.() ?? nodeOs.cpus().length,
    setPriority: (pid, priority) => nodeOs.setPriority(pid, priority),
    platform: process.platform,
  };
}

export interface SupervisorDeps {
  spawn?: SpawnFn;
  os?: OsLike;
  now?: () => number;
  /** Kill a process tree; default uses taskkill on Windows and process groups elsewhere. */
  killTree?: (pid: number) => Promise<void>;
  log?: { warn(message: string, data?: Record<string, unknown>): void };
  /** I02: decorates every child's env (undefined = the inherited env); e.g. the safe git env. */
  env?: (env: NodeJS.ProcessEnv | undefined) => NodeJS.ProcessEnv;
}

export class Supervisor {
  private readonly spawnFn: SpawnFn;
  private readonly os: OsLike;
  private readonly now: () => number;
  private readonly killTreeFn: (pid: number) => Promise<void>;
  readonly log?: SupervisorDeps['log']; // B-052: also the Codex server's short notes
  private readonly envFn?: SupervisorDeps['env'];
  private readonly active = new Map<number, Lease>();
  private sequence = 0;

  /** Set by killAll (shutdown): a spawnAlone still waiting starts nothing – the runtime's exit would kill it at once. */
  private stopping = false;

  constructor(deps: SupervisorDeps = {}) {
    this.spawnFn = deps.spawn ?? ((command, args, options) => nodeSpawn(command, args, options as Parameters<typeof nodeSpawn>[2]) as unknown as ChildLike);
    this.os = deps.os ?? defaultOs();
    this.now = deps.now ?? Date.now;
    this.log = deps.log;
    this.envFn = deps.env;
    this.killTreeFn = deps.killTree ?? ((pid) => this.defaultKillTree(pid));
  }

  /**
   * Like spawn, once no lease of `input.group` runs any more (the last check and the spawn are one synchronous step).
   * After killAll it rejects instead: a waiter woken by the shutdown's kill would start a process the exit kills hard.
   */
  async spawnAlone(input: SpawnInput & { group: string }): Promise<Lease> {
    for (let held = this.holder(input.group); held; held = this.holder(input.group)) await held.exited;
    if (this.stopping) throw new Error('The app is stopping: no new process.');
    return this.spawn(input);
  }

  private holder(group: string): Lease | undefined {
    for (const lease of this.active.values()) if (lease.group === group) return lease;
    return undefined;
  }

  /** Starts a child process as a lease. `idleMs` kills it after that long without `touch()`. */
  spawn(input: SpawnInput): Lease {
    const env = this.envFn ? this.envFn(input.env) : input.env;
    const posix = this.os.platform !== 'win32';
    const child = this.spawnFn(input.command, input.args, {
      cwd: input.cwd, env, stdio: input.stdio ?? ['pipe', 'pipe', 'pipe'], windowsHide: true,
      detached: posix, // own process group so the whole tree can be killed
    });
    if (child.pid) {
      try { this.os.setPriority(child.pid, nodeOs.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
    }
    const id = ++this.sequence;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let released = false;
    let retiring: Promise<void> | undefined;
    let resolveExit!: (code: number | null) => void;
    const exited = new Promise<number | null>((resolve) => { resolveExit = resolve; });
    const lease: Lease = {
      id, owner: input.owner, kind: input.kind ?? 'heavy', pid: child.pid, startedAt: this.now(), lastActiveAt: this.now(), child, exited,
      ...(input.group ? { group: input.group } : {}),
      touch: () => {
        lease.lastActiveAt = this.now();
        if (input.idleMs) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => { input.onIdle?.(); void lease.release(); }, input.idleMs);
          idleTimer.unref?.();
        }
      },
      release: async () => {
        if (released) return exited.then(() => undefined);
        released = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (child.exitCode === null && child.pid) {
          try { await this.killTreeFn(child.pid); } catch (error) { this.log?.warn('kill tree failed', { owner: input.owner, error: String(error) }); }
        }
        if (child.exitCode === null) { try { child.kill(); } catch { /* already gone */ } }
        // Do not hang shutdown on a process that ignores signals.
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000).unref?.())]);
      },
      releaseAfter: (graceMs) => retiring ??= new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) this.log?.warn('process still running after its grace: killing its tree', { owner: input.owner });
          void lease.release();
        }, graceMs);
        timer.unref?.();
        void exited.then(() => { clearTimeout(timer); resolve(); });
      }),
    };
    const finish = (code: number | null) => {
      if (idleTimer) clearTimeout(idleTimer);
      this.active.delete(id);
      resolveExit(code);
    };
    child.once('exit', (code) => finish(code));
    child.once('error', () => finish(null));
    this.active.set(id, lease);
    lease.touch();
    return lease;
  }

  leases(): LeaseInfo[] {
    return [...this.active.values()].map(({ id, owner, kind, pid, startedAt, lastActiveAt }) => ({ id, owner, kind, pid, startedAt, lastActiveAt }));
  }

  async killAll(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.active.values()].map((lease) => lease.release()));
  }

  private defaultKillTree(pid: number): Promise<void> {
    if (this.os.platform === 'win32') {
      return new Promise((resolve) => {
        const killer = this.spawnFn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
        killer.once('exit', () => resolve());
        killer.once('error', () => resolve());
      });
    }
    try { process.kill(-pid, 'SIGTERM'); } catch { /* group gone */ }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } resolve(); }, 3000);
      timer.unref?.();
      resolve();
    });
  }
}
