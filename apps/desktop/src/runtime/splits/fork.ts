// Seeding a split's native session (B-057 S4): a 'fork' part starts as its parent with the context the parent had at the
// split, tried in this order – the first that works wins, a failure falls to the next and is recorded:
// (a) a native engine fork – the worker's routed engine has caps.fork, the parent's splitting run ran on that engine and
//     account, and the session my main self's splitting turn ended with (B-080: recorded when the group started –
//     recordedParent, SplitGroup.parentSession – so a later turn of the parent that renews or moves its binding changes
//     nothing) is of that engine and account and fits the worker's model window (pastFit; B-080: the window the engine
//     reported for that model, else the catalog's – windowOf): engine.fork (Codex
//     thread/fork through that turn – lastTurn, Claude --resume --fork-session) – also with another model or effort of
//     that account; a recorded ref the parent replaced since stays forkable (the session sweep keeps it ≥ 24 h);
// (b) else a text fallback – the checkpoint of the parent's task (context.checkpoint: goal, done, open, constraints,
//     artifacts – no "next step": the part is the worker's next step) and my own record as text (agents/history-text.ts, the
//     parent thread's context ledger, marks applied – 13.11.2026: never a chat's history), within half the worker model's
//     fit, returned as `inputPrefix`; nothing to carry → fresh.
// A 'brief' part starts fresh. The turn pipeline (agents/turn-prepare.ts chooseSession) calls this for a split's first turn
// when its thread `split:<id>` has no binding yet, binds `ref` under (agent, split thread, engine) with the current
// promptKey and puts `inputPrefix` in front of the turn's input. The choice is noted on the worker's run
// ({splitSeed: how, parentRef?, fellBack?} – not for a brief), recorded as the split's `fork` (services.splits.markFork)
// and returned.
// Owns: that choice, the seeding, the note, the record and the parent session's record at the group's start. Never:
// touches the parent's native session or binding, or binds the result itself.

import type { RuntimeServices } from '../contracts.ts';
import type { Db } from '../db/database.ts';
import type { Engine } from '../engines/types.ts';
import type { TurnPlan } from '../agents/turn-types.ts';
import type { ToolSpec } from '../tools/types.ts';
import type { Account, Effort, RouteDecision } from '../../shared/model/providers.ts';
import type { Handoff } from '../../shared/model/knowledge.ts';
import type { Run } from '../../shared/model/runs.ts';
import { PAST_WINDOW, type SplitFork, type SplitGroup, type SplitParentSession, type SplitTurn } from '../../shared/model/splits.ts';
import { SessionStore } from '../agents/sessions.ts';
import { turnsOn } from '../agents/native-turns.ts';
import { fitLimit, pastFit } from '../agents/compaction-policy.ts';
import { historyText } from '../agents/history-text.ts';
import { turnCwd } from '../git/records.ts';
import { quoteHeaders } from '../context/projection.ts';

/** The text fallback's checkpoint: at most CHECKPOINT_CHARS (my record follows within half the worker model's fit). */
const CHECKPOINT_CHARS = 2_000;
const TEXT_HEAD = "My origin's context at the split, as text:";

/** The worker turn's route as buildTurn resolved it (RoutedTurn's engine, account and provider model, plus the effort it runs with). */
export interface SeedRoute {
  route: RouteDecision;
  engine: Engine;
  account: Account;
  /** Provider model id of the worker's turn. */
  model: string;
  effort: Effort;
}

export interface SeedArgs {
  /** The worker turn's plan (plan.split === split, plan.thread === `split:<id>`). */
  plan: TurnPlan;
  split: SplitTurn;
  route: SeedRoute;
  /** The turn's native dynamic tools (byte-identical to the parent's offer – S8). */
  tools: ToolSpec[];
  /** Every tool name the turn offers (native and through the hub), sorted – ToolOffer.names. */
  toolNames: string[];
  /** The turn's prompt sections as the engine gets them. */
  system: { stable: string; volatile: string };
  /** The turn's prompt key (session-key.ts promptKey of system.stable + toolNames). */
  promptKey: string;
  /** The worker's folder (its worktree, else the parent's). */
  cwd?: string;
  runId: string;
}

export interface SeedResult {
  how: SplitFork['how'];
  /** The new native session (native fork); absent: the turn starts a new one. */
  ref?: string;
  generation?: number;
  /** Text put in front of the turn's input (the text fallback). */
  inputPrefix?: string;
  /** B-057 C: the parent's session a native fork copied (SplitFork.parentRef). */
  parentRef?: string;
  /** B-057 C: why the earlier ways did not seed it ("native: …"). */
  fellBack?: string[];
}

type Way = (s: RuntimeServices, args: SeedArgs, cwd: string) => Promise<SeedResult | string>;

export async function seedSplitSession(s: RuntimeServices, args: SeedArgs): Promise<SeedResult> {
  if (args.split.context === 'brief') {
    mark(s, args, { how: 'fresh' });
    return { how: 'fresh' };
  }
  const fellBack: string[] = [];
  const cwd = args.cwd ?? args.split.cwd ?? turnCwd(s, args.plan.task, args.plan.agent.id);
  let result: SeedResult | undefined;
  for (const [name, way] of [['native', nativeFork]] as Array<[string, Way]>) {
    try {
      const outcome = await way(s, args, cwd);
      if (typeof outcome !== 'string') { result = outcome; break; }
      fellBack.push(`${name}: ${outcome}`);
    } catch (error) {
      fellBack.push(`${name}: ${reason(error)}`);
    }
  }
  result ??= textSeed(s, args, fellBack);
  if (fellBack.length) result.fellBack = fellBack;
  note(s, args.runId, result);
  mark(s, args, result);
  return result;
}

/** (a) The native fork of the parent's session on the worker's engine and account; a string says why not. */
async function nativeFork(s: RuntimeServices, args: SeedArgs, cwd: string): Promise<SeedResult | string> {
  const { engine, account } = args.route;
  if (!engine.caps.fork || !engine.fork) return 'the engine cannot fork';
  const agentId = args.plan.agent.id;
  // S4a: only the session the parent's splitting turn ran on – a binding of this engine from an older turn (the agent
  // switched engine or account since) would lack the parent's recent context, the split itself included.
  const ran = s.runs.get(args.split.parentRunId);
  if (ran?.engine && ran.engine !== engine.id) return "the parent's turn ran on another engine";
  if (ran?.accountId && ran.accountId !== account.id) return "the parent's turn ran on another account";
  // B-080: the session the splitting turn ended with, as recorded when the group started – never the live binding, which
  // the parent's next turn may have renewed or moved on by the time this part starts.
  const parent = args.split.parentSession;
  if (!parent || parent.engine !== engine.id) return "the parent's splitting turn left no session on this engine";
  if (parent.accountId !== account.id) return 'the parent session belongs to another account';
  if (pastFit(parent.contextTokens, windowOf(s, args))) return PAST_WINDOW;
  const forked = await engine.fork({ runId: args.runId, agentId, account, parentRef: parent.ref, cwd, model: args.route.model,
    ...(parent.turn ? { lastTurn: parent.turn } : {}) });
  if (!forked.ref || forked.ref === parent.ref) throw new Error('the engine gave no new session');
  return { how: 'native', ref: forked.ref, generation: forked.generation ?? 1, parentRef: parent.ref };
}

/**
 * B-080: the session the parent's splitting turn ended with – its binding on (agent, the group's thread, the run's engine),
 * with that run's native turn on it (agents/native-turns.ts; Codex names its turns) – recorded when the group starts
 * (splits/runner.ts startGroup; turn-finish saved the binding before it started the group). Undefined: the run named no
 * engine or left no session there (its 'fork' parts start from the text seed).
 */
export function recordedParent(db: Db, run: Pick<Run, 'engine' | 'startedAt'> | undefined, group: Pick<SplitGroup, 'agentId' | 'thread' | 'parentRunId'>): SplitParentSession | undefined {
  if (!run?.engine) return undefined;
  try {
    const binding = new SessionStore(db).get(group.agentId, group.thread, run.engine);
    // B-080 review: only the binding the splitting run left – an older turn's session lacks the split's own context
    if (!binding || (run.startedAt !== undefined && binding.updatedAt < run.startedAt)) return undefined;
    const turn = turnsOn(db, { agentId: group.agentId, conversationId: group.thread, engine: run.engine }, binding.ref)
      .find((entry) => entry.runId === group.parentRunId)?.turn;
    return {
      engine: binding.engine, ...(binding.accountId ? { accountId: binding.accountId } : {}), ref: binding.ref,
      ...(binding.contextTokens !== undefined ? { contextTokens: binding.contextTokens } : {}), ...(turn ? { turn } : {}),
    };
  } catch { return undefined; }
}

/** (b) The parent's checkpoint and my record as text in front of the worker's input; fresh when there is nothing. */
function textSeed(s: RuntimeServices, args: SeedArgs, fellBack: string[]): SeedResult {
  const agentId = args.plan.agent.id;
  const chat = args.split.parentConversationId;
  const taskId = args.split.parentTaskId;
  let checkpoint = '';
  // A task's checkpoint (goal, steps done and open …); a chat alone has none worth more than its lines – its checkpoint
  // would name the chat's newest request, which may be a line the parent had not seen at the split.
  if (taskId) {
    try { checkpoint = clip(quoteHeaders(checkpointText(s.context.checkpoint({ agentId, taskId, conversationId: chat }))), CHECKPOINT_CHARS); }
    catch (error) { fellBack.push(`checkpoint: ${reason(error)}`); }
  }
  const record = historyText(s, agentId, args.split.parentThread, Math.floor(fitLimit(windowOf(s, args)) / 2)) ?? '';
  if (!checkpoint.trim() && !record.trim()) return { how: 'fresh' };
  const parts = [TEXT_HEAD, checkpoint && `My state:\n${checkpoint}`, record];
  return { how: 'text', inputPrefix: parts.filter(Boolean).join('\n\n') };
}

/** The checkpoint as text, without its "next step" (the worker's part is its next step). */
export function checkpointText(handoff: Handoff): string {
  const list = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n');
  return [
    handoff.goal && `Goal: ${handoff.goal}`,
    handoff.verified.length && `Done so far:\n${list(handoff.verified)}`,
    handoff.open.length && `Open:\n${list(handoff.open)}`,
    handoff.constraints?.length && `Known so far:\n${list(handoff.constraints)}`, // B-080: what checkpoint.ts puts there – tried ways, facts found
    handoff.artifacts.length && `Artifacts:\n${list(handoff.artifacts.map((item) => `${item.label}: ${item.ref}`))}`,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n');
}

/**
 * The worker model's context window for the fit – B-080: the main path's rule (agents/turn-prepare.ts chooseSession): the
 * window its engine reported for this model (the one it really runs with), else the catalog's; neither → DEFAULT_WINDOW.
 */
function windowOf(s: RuntimeServices, args: SeedArgs): number | undefined {
  const modelId = args.route.route.modelId;
  try {
    const reported = new SessionStore(s.db).reportedWindow(args.route.engine.id, modelId);
    if (reported) return reported;
  } catch { /* the catalog's then */ }
  try { return s.catalog.get(modelId)?.caps.contextTokens; } catch { return undefined; }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/** The split's `fork` record (Split.fork, shown on its view): how, and for a seeded session its engine, account and parent. */
function mark(s: RuntimeServices, args: SeedArgs, result: SeedResult): void {
  const seeded = result.how === 'native';
  const fork: SplitFork = {
    how: result.how, ...(seeded ? { engine: args.route.engine.id, accountId: args.route.account.id } : {}), ...(result.parentRef ? { parentRef: result.parentRef } : {}),
  };
  try { s.splits?.markFork?.(args.split.splitId, fork); } catch { /* the view only */ }
}

function note(s: RuntimeServices, runId: string, result: SeedResult): void {
  try {
    s.runs.item(runId, { kind: 'note', data: { splitSeed: result.how, ...(result.parentRef ? { parentRef: result.parentRef } : {}), ...(result.fellBack ? { fellBack: result.fellBack } : {}) }, effectStatus: 'none' });
  } catch { /* journal only */ }
}
