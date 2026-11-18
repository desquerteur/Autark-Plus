// B-057 splits as members of RuntimeServices and of the Dispatcher (merged by module augmentation, like the other late
// additions in this folder; re-exported by ../contracts.ts). An agent splits itself into parallel workers
// (shared/model/splits.ts); the split service (runtime/splits/service.ts) owns their lifecycle, the dispatcher runs
// each split turn on its own lane `<agentId>#<splitId>` next to the agent's main lane (agents/dispatch-lanes.ts).
// Owns: the SplitService interface, the dispatcher's lane members, the run journal's split listings.
// Never: behaviour.

import type { Origin } from '../../shared/model/origin.ts';
import type { Run } from '../../shared/model/runs.ts';
import type { SplitGroupView, SplitPartInput, SplitTurn, SplitView } from '../../shared/model/splits.ts';
/** The session seeding hook's shapes (splits/fork.ts seedSplitSession, called by the turn pipeline). */
export type { SeedArgs, SeedResult, SeedRoute } from '../splits/fork.ts';

/** Where an agents.split call came from (the calling turn's facts – runtime-set, never the agent's text). */
export interface SplitCreateContext { agentId: string; runId: string; conversationId?: string; taskId?: string; origin?: Origin;
  thread: string; modeKey?: string; cwd?: string; split?: SplitTurn /* set when the caller is itself a part – B-083: its new parts join its own group */ }

/**
 * How a split's run ended (turn-finish of a split turn). `retryable`: a limit, an outage or an engine error before effects.
 * `requeue` (sent with status 'failed' + retryable): the part's work never started – its agent paused for its budget
 * before the turn planned, or the runtime stopped before it ran – so it goes back to 'queued' without using an attempt.
 */
export interface SplitRunEnd { runId: string; status: 'done' | 'failed' | 'stopped'; retryable?: boolean; error?: string; requeue?: boolean;
  /** Sent with status 'failed' + retryable: no account could run it now (a usage limit or an outage) – it waits for one without using an attempt (splits/holds.ts). */
  wait?: boolean }

/** A running split lane of the dispatcher. */
export interface SplitLane { agentId: string; splitId: string; runId: string }

/**
 * How far a group still at work is (SplitService.activeOn): its parts in total, done, running, waiting (B-080: not started
 * yet – pending or queued) and ended otherwise (failed, stopped, skipped). B-080: `thread` and `conversationId` say where
 * it was split, so a turn elsewhere names that chat.
 */
export interface SplitProgress { id: string; goal: string; thread: string; conversationId?: string; status: 'pending' | 'running'; parts: number; done: number; running: number; waiting: number; ended: number }

export interface SplitService {
  /** Validates and stores a group with its parts (status pending); they start when the calling turn ends – B-083: a part's call adds parts to its own group, which start at once; `wait` (decision 10 of 17.11.2026): they start at once and the calling turn waits for them (waitFor). Throws WorkforceError (clear English message). */
  create(ctx: SplitCreateContext, input: { goal: string; parts: SplitPartInput[]; wait?: boolean }): SplitGroupView;
  /** Turn-finish of every NON-split turn: pending groups of that run start ('done'/'failed') or are stopped ('stopped' by the person). */
  afterParentTurn(runId: string, status: 'done' | 'failed' | 'stopped'): void;
  /** Turn-finish of a split turn. */
  onSplitRunEnd(splitId: string, end: SplitRunEnd): void;
  /** What the lane builds the split's TurnRequest from; undefined when the split is unknown or not startable. */
  turnFor(splitId: string): SplitTurn | undefined;
  /** The worker's input notes: its brief and the results of the parts it depends on. */
  inputFor(splitId: string): Array<{ text: string; at: number }>;
  /** The origin's "Split results" input block for its next turn on that thread: its parts there that ended and did not reach it yet. */
  pendingResults(agentId: string, thread: string): { splitIds: string[]; text: string } | undefined;
  /** The origin's turn that got that block ended 'done': those parts are gathered. */
  markGathered(runId: string, splitIds: string[]): void;
  /**
   * agents.split_results: the full results text of one of the agent's groups (B-080: from any thread), one part, or its newest
   * group (this thread's first). `runId`: the reading turn – the ended parts shown are gathered when it ends 'done' (FIXES-3 A3).
   */
  results(agentId: string, q: { groupId?: string; idx?: number; thread?: string; runId?: string }): string;
  /**
   * Stops splits (running: aborted; waiting: stopped); returns how many. `by`: who stopped them. `taskId`: exactly the
   * groups split by a turn on that task (the person ended it or took it back – tasks/owners.ts, tasks/capture.ts).
   */
  stop(q: { splitId?: string; groupId?: string; agentId?: string; conversationId?: string; taskId?: string }, by: string): number;
  list(q: { agentId?: string; parentRunId?: string; groupId?: string; conversationId?: string; active?: boolean; limit?: number }): SplitGroupView[];
  get(splitId: string): { split: SplitView; group: SplitGroupView } | undefined;
  /** Starts ready splits up to the agent's runningPerAgent (event-driven: after create / afterParentTurn / a lane's end, onLaneFree). */
  pump(): void;
  /** Boot recovery: running splits queued again or failed, pending groups started or stopped, then pump. */
  reconcile(): void;
  /** B-057 S16: agents.split_merge's outcome on the part's row (Split.branch), published like any split change. Optional until the split core has it. */
  markBranch?(splitId: string, branch: NonNullable<SplitView['branch']>): void;
  /** B-057 S4: how the split's session was seeded (splits/fork.ts SeedResult → Split.fork), recorded by the turn pipeline at its first start. Optional for fakes. */
  markFork?(splitId: string, fork: NonNullable<SplitView['fork']>): void;
  /** B-057 R1-4: the agent's groups still at work (pending or running; B-080: from every thread, `thread`'s first, then newest first, at most `limit`) – the 'splits' line of its own turns. Optional for fakes. */
  activeOn?(agentId: string, thread: string, limit?: number): SplitProgress[];
}

declare module '../contracts.ts' {
  interface RuntimeServices {
    /** B-057 splits; missing = not wired (fakes). */
    splits?: SplitService;
  }
  interface Dispatcher {
    /** B-057: start a split turn on its own lane `<agentId>#<splitId>` at once; 'busy' = the agent's runningPerAgent reached, its lane still ending, or turns may not start now (retry on onLaneFree). */
    startSplit?(input: { agentId: string; splitId: string }): 'started' | 'busy' | 'refused';
    /** B-057: running split lanes of an agent (all when omitted). */
    splitLanes?(agentId?: string): SplitLane[];
    /** B-057: abort a running split lane (stop). */
    stopSplit?(splitId: string, why: 'human' | 'shutdown'): boolean;
    /** B-057: `listener` runs whenever a lane frees or turns may start again (the split service pumps then); returns its removal. */
    onLaneFree?(listener: () => void): () => void;
  }
}

declare module './safety.ts' {
  interface RunJournal {
    /** B-057: like list(), without the runs of splits (the agent's own turns – agents.runs). */
    listTopLevel?(agentId: string, limit?: number): Run[];
    /** B-057: the runs of these splits, oldest first. */
    listBySplit?(splitIds: readonly string[]): Run[];
  }
}
