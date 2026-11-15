// Turn phase 1 – plan and route: who runs, in which mode, on which model/account, with
// which session, prompt and input. Owns: mode resolution (the agent's own mode), the focus
// text for routing, the subconscious's trace of this turn (owner 01.11.2026: real tool calls in the main AI's history, never
// a hint in a prompt; subconscious/service.ts beforeTurn: on a person's message with content – or a colleague's when no person wrote, else the turn's task – one call first, bounded, which sets model and effort and opens the hits of the word search it chooses, v2 15.11.2026), the previous-model rule (RT2, next-route.ts: a model.set request for the
// next step or the task's turns – B-083: or my subconscious's for this turn, read after its look –, else the last run no request shaped), session choice
// (CTX7, compaction-policy.ts; B-080: no working set – a session lives on, the subconscious's marks keep it lean item by
// item, and only a context that no longer fits the model's window has its oldest tool work hidden or, when even that is not
// enough, is renewed = dropped binding; SES2: a session resumes only while its prompt key – stable prompt + offered tools – matches,
// else it is rebuilt with its history (B-080), after a mode switch with "Mode changed from X to Y"; a row from before SES2 is
// accepted once; another engine rebuilds from the record too). 13.11.2026 evening (owner: "der Kontext geht nie verloren … nie
// auf null angefangen oder mit einem Chat"): a turn without a session that holds the context – a rebuild that could not run, a
// session-less engine – starts its input with the agent's own record as text (history-text.ts), never a chat's history; the
// wake's chat gives only its new lines. The tool offer, attachment extraction before the delta, and one note for cut-off work
// (interruption-context.ts): when and why it was cut, what came in since, and (PR3) what I already did then when this engine
// cannot know it. The prompt: the stable part is the system prompt; the live (volatile) part goes to the engine with the turn,
// which sends it as the first block of the input (engines/shared.ts contextText) – all of it on a new, renewed or rebuilt
// session or a stateless engine (my latest answers kept in my run log follow it as the input's first lines), only what changed since my last finished
// turn on a resumed one (B-049 F6, volatile-delta.ts; turn-finish records what it then holds). B-066: last-prompt.md shows
// both as they go out this turn, written once the session is chosen.
// Whose turn (tasks/owners.ts): a follow-up (retry/review) for a task another agent owns now plans
// no turn (its owner's manager's review does). Only a wake the human caused
// (answer, approval, or a manual run – messages.retry wakes 'manual' with the stopped run's task)
// resumes a task the human paused, for its owner or lead; a chat or mini-app 'message' wake runs
// without the task (it stays paused); every other wake (retry, review, schedule, task, handoff,
// child – agents and timers) plans no turn for it. An archived chat runs like any other (C2); notes
// before the delta are quoted (quoteHeaders), a 'review' wake's as the app's, never the agent's own.
// 13.11.2026 (owner: one context per agent): the plan's thread is the agent's main thread (shared/model/origin.ts) – one
// native session, volatile-delta record and ledger for every wake, whatever chat, task or source it comes from; the wake's
// chat only decides which lines the input carries.
// A native rebuild from the context ledger (agents/rebuild.ts) on an engine switch, a missing session or worthwhile marks; a turn
// whose history starts from the projection gets the call naming what is condensed or hidden there (turnTrace).
// B-057 (agents/split-turn.ts): a split's turn plans, routes, seeds its session and gets its parent's tool offer there; the
// agent's own turn gets its settled splits' "Split results" block in its input (RoutedTurn.splitParts).
// Never: starts the engine, posts chat messages (only TaskService.resume's quiet line) or
// advances cursors (turn-finish does that).

import type { RuntimeServices, RouteRequest } from '../contracts.ts';
import type { ModeInfo } from '../../shared/model/knowledge.ts';
import type { WakeReason } from '../../shared/model/runs.ts';
import type { TaskView } from '../../shared/model/tasks.ts';
import type { EngineId, RouteDecision } from '../../shared/model/providers.ts';
import { MAIN_THREAD } from '../../shared/model/origin.ts';
import { hasTrace, type SubconsciousTrace } from '../../shared/model/subconscious.ts';
import type { Engine } from '../engines/types.ts';
import { WorkforceError } from '../../shared/errors.ts';
import type { DeltaInput, DeltaResult } from '../context/delta.ts';
import { PROJECTION, quoteHeaders } from '../context/projection.ts';
import { answersRecap, needsRecap, recapScope, recapText, recentActions } from '../context/recent-actions.ts';
import { writeLastPrompt } from '../context/last-prompt.ts';
import { contextText } from '../engines/shared.ts';
import { INTERRUPTED_NOTE } from '../tasks/recover-notes.ts';
import { REDELIVERY_NOTE } from './redelivery.ts';
import { fromPerson } from './publishing.ts';
import { isExternalAgent } from '../../shared/model/external-agents.ts';
import { SessionStore, type SessionBinding } from './sessions.ts';
import { pendingRoute, returnChoice } from './next-route.ts';
import { modeChangeNote, offeredTools, promptKey } from './session-key.ts';
import { promoteLearned } from '../tools/learned.ts'; // B-049 F4 (TOOLS-CORE)
import { forgetSent, sentTo, volatileDelta } from './volatile-delta.ts'; // B-049 F6
import { isPaused } from '../../shared/model/tasks.ts';
import { fitLimit, pastFit } from './compaction-policy.ts';
import { historyText } from './history-text.ts';
import { nativeRebuild, rebuildFellBack } from './rebuild.ts';
import { carriedCalls, marksCall, marksOf } from '../context/ledger/marks.ts';
import type { RoutedTurn, TurnPlan, TurnRequest } from './turn-types.ts';
import type { ToolOffer } from './session-key.ts';
import type { Account } from '../../shared/model/providers.ts';
import { planSplit, seedSplit, splitResults, splitRoute } from './split-turn.ts'; // B-057
import { visionInputs } from '../media/vision-image.ts'; // B-058 G10 (T4): image inputs normalized for every engine
import { interruptionNote } from './interruption-context.ts';
import { noteLabel, scheduleSubject, taskSubject } from './note-label.ts';

/** Runs read for the choice to return to (a task request makes many runs the return rule skips). */
const RETURN_WINDOW = 50;
/** Wakes the human caused (a retry of a stopped answer is 'manual'): the only ones that end the human's pause of a task. */
const BY_HUMAN: ReadonlySet<WakeReason> = new Set(['answer', 'approval', 'manual']);
/** Task states in which a bare 'task' wake has nothing to continue (the owner set the work aside, or it is over). */
const SET_ASIDE: ReadonlySet<string> = new Set(['waiting', 'done', 'dropped']);

/** The turn's mode: the first key the mode library answers (the agent's own; a split part's first) – an unknown
 *  (deleted) key is answered with general. Experience notes use it too (experience.ts). */
export function resolveMode(services: RuntimeServices, keys: Array<string | undefined>): ModeInfo {
  for (const key of keys) {
    if (!key) continue;
    try { return services.modes.get(key); } catch { /* unknown mode → next candidate */ }
  }
  return services.modes.get('general');
}

/** Loads agent, task, chat and mode; the subconscious's trace; then reads the request in force – model.set's or my subconscious's for this turn (B-080: turn.ts takes a next step's). */
export async function planTurn(services: RuntimeServices, request: TurnRequest): Promise<TurnPlan | undefined> {
  if (request.split) return planSplit(services, request, resolveMode); // B-057: a split's own plan (agents/split-turn.ts)
  const agent = services.org.get(request.agentId);
  if (!agent || agent.archivedAt || agent.status === 'paused') return undefined;
  let task = request.taskId ? services.tasks.get(request.taskId) : undefined;
  if (task) {
    const owner = task.assigneeKind === 'agent' && task.assigneeId === agent.id;
    if ((request.reason === 'retry' || request.reason === 'review') && !owner) return undefined; // a look back at work I no longer own
    // B-047: a bare 'task' wake (no note: nothing new) for work its owner already set aside is stale – it was queued while
    // that work ran (e.g. at the task's creation) and would restart what the owner just paused, maybe on the person's
    // "stop". Wakes with news (an answer, a finished step, a reopening) carry a note.
    if (request.reason === 'task' && !request.notes.length && SET_ASIDE.has(task.status)) return undefined;
    if (isPaused(task)) {
      if (BY_HUMAN.has(request.reason)) {
        if (owner) task = resumed(services, task, agent.id);
      } else if (request.reason === 'message') {
        task = undefined; // a chat or mini-app event is answered; the work stays paused
      } else {
        return undefined; // only the human resumes paused work
      }
    }
  }
  const conversationId = request.conversationId ?? task?.conversationId;
  const conversation = conversationId ? services.chats.get(conversationId) : undefined;
  if (conversationId && !conversation) return undefined;
  const mode = resolveMode(services, [agent.mode]); // the mode is the agent's own (13.11.2026)

  const room = conversationId ? services.chats.members(conversationId) : [];
  const member = room.find((item) => item.memberId === agent.id && !item.leftAt);
  const memberCursor = member?.readSeq ?? 0;
  const unseen = conversationId ? services.chats.messages(conversationId, { afterSeq: memberCursor, limit: 40 }) : [];
  const lastInput = unseen.filter(message => message.authorKind === 'human' && message.kind !== 'status').at(-1);
  const callId = !task && request.reason === 'message' ? lastInput?.meta.call?.id : undefined;
  // Routing reads what I am asked now: the person's newest line, else my task. Colleagues' reports, paths and
  // addresses in this chat name the topics of the work, not its kind (routing/categories.ts). The card of my task
  // (its title only) reads as the whole task, so every turn of a task has one kind.
  const asked = lastInput && !(lastInput.kind === 'task' && lastInput.taskId === task?.id) ? lastInput.body : undefined;
  const focus = asked ?? (task ? `${task.title}\n${task.notes}` : undefined);
  const needsVision = unseen.some((message) => message.attachments.some((file) => file.mime.startsWith('image/')));

  const thread = MAIN_THREAD; // one context per agent
  const origin = request.origin;
  // The person's lines; a message with only files names them, so a screenshot alone still is the person's turn (v1 routes it as theirs).
  const said = unseen.filter((message) => fromPerson(message, agent.id)).map((message) => message.body.trim() || `[${message.attachments.map((file) => `${file.name} (${file.mime})`).join(', ')}]`).filter((line) => line !== '[]').join('\n');
  const woke = unseen.filter((message) => message.authorId !== agent.id && message.kind !== 'status' && (message.authorKind === 'agent' || isExternalAgent(message.authorId))).map((message) => message.body).join('\n'); // colleagues' lines (v1: routed when no person wrote)
  // My task as this turn reads it (its title, the wake's newest note, else its notes): v1 routes a wake with nobody's words on it. A chat
  // wake's ('message') note is a mini-app event or a waiting task's notice, not the work – there the task's own notes stand.
  const taskNote = request.reason === 'message' ? undefined : request.notes.at(-1)?.text;
  const taskText = task ? [task.title, taskNote ?? task.notes].map((part) => part.trim()).filter(Boolean).join('\n') : undefined;
  // v2 15.11.2026: the entries the call before the turn opened come first in it (subconscious/look.ts), then a kept trace.
  const trace = await subconsciousTrace(services, request.signal, { agent, thread, conversationId, taskId: task?.id, mode: mode.key, said, woke, ...(taskText ? { taskText } : {}), ...(needsVision ? { vision: true } : {}), signal: request.signal });
  // Return rule (RT2, next-route.ts returnRun): with a next step in force my newest done run, with a task's request alone that task's,
  // else the last done run no request shaped; a request in force – the next step's over its task's – wins, marked explicit (it beats
  // default pins and weak priors, never the policy bounds). B-080: taken by turn.ts as the engine starts (that one: its `at` rides
  // on the plan, as its temperature does). B-083: read after the look, so what my subconscious set for this turn
  // (subconscious/route-turn.ts) runs it; a failing read gives the trace it took back to the thread.
  let requested: ReturnType<typeof pendingRoute>;
  let previous: ReturnType<typeof returnChoice>;
  try {
    requested = pendingRoute(services.db, agent.id, task?.id, (taskId) => finished(services, taskId));
    previous = returnChoice(services.runs.list(agent.id, RETURN_WINDOW), requested, { taskId: task?.id });
  } catch (error) {
    if (trace) services.subconscious.putBack?.(agent.id, thread, trace);
    throw error;
  }
  return {
    agent, mode, task, conversationId, ...(origin ? { origin } : {}), thread,
    memberCursor, callId, focus, ...(trace ? { trace } : {}), previous, ...(requested?.temperature !== undefined ? { temperature: requested.temperature } : {}),
    ...(requested?.stepAt !== undefined ? { nextStepAt: requested.stepAt } : {}), needsVision,
  };
}

/**
 * What the subconscious shows this turn (runAttempt journals its calls: the run does not exist yet here); nothing when it has nothing or fails.
 * A stop (the emergency stop, a chat's stop) does not wait for its look: the turn ends now, what the look still hands over waits for the thread's next turn.
 */
async function subconsciousTrace(services: RuntimeServices, signal: AbortSignal, input: Parameters<NonNullable<RuntimeServices['subconscious']['beforeTurn']>>[0]): Promise<SubconsciousTrace | undefined> {
  try {
    if (signal.aborted) return undefined;
    const look = Promise.resolve(services.subconscious.beforeTurn?.(input));
    const stopped = new Promise<'stopped'>((resolve) => signal.addEventListener('abort', () => resolve('stopped'), { once: true }));
    const trace = await Promise.race([look, stopped]);
    if (trace === 'stopped') {
      look.then((late) => { if (hasTrace(late)) services.subconscious.putBack?.(input.agent.id, input.thread, late); }).catch((error) => services.log.warn('the subconscious before the turn failed', { agentId: input.agent.id, error: String(error) }));
      return undefined;
    }
    return hasTrace(trace) ? trace : undefined;
  } catch (error) {
    services.log.warn('the subconscious before the turn failed', { agentId: input.agent.id, error: String(error) });
    return undefined;
  }
}

/** RT2: a task's model.set request ends with the task (done, cancelled or gone). */
function finished(services: RuntimeServices, taskId: string): boolean {
  const status = services.tasks.get(taskId)?.status;
  return !status || status === 'done' || status === 'dropped';
}

/** Ends the human's pause for this turn of the owner; the task as it is now. */
function resumed(services: RuntimeServices, task: TaskView, agentId: string): TaskView {
  try { return services.tasks.resume?.(task.id, agentId) ?? task; } catch (error) {
    services.log.warn('resuming a paused task failed', { taskId: task.id, error: String(error) });
    return task;
  }
}

/** True when routing failed only because no connected model can read images. */
export function visionUnavailable(error: unknown): boolean {
  return error instanceof WorkforceError && error.code === 'unavailable' && error.details?.need === 'vision';
}

/** The same turn without image input; buildTurn then tells the agent it cannot see them. */
export function withoutImages(plan: TurnPlan): TurnPlan {
  return { ...plan, needsVision: false, imagesHidden: true };
}

/** Told to the agent instead of the images (they stay listed by name and stored path). */
export const IMAGES_HIDDEN_NOTE = 'I cannot see the images in this chat right now: no connected model can read images. They are listed by name and stored path. I use a saved description (media.search) when there is one, and say so when I would need to see an image.';

export function routeRequest(plan: TurnPlan, exclude?: string[]): RouteRequest {
  return {
    agent: plan.agent, conversationId: plan.conversationId, taskId: plan.task?.id, mode: plan.mode, text: plan.focus,
    previous: plan.previous, exclude, needs: plan.needsVision ? { vision: true } : undefined,
    ...splitRoute(plan), // B-057 S10: a split's own model choice (routing/split-route.ts)
  };
}

/** Each note under the one label (note-label.ts) with its own subject: my schedule for a schedule's note, else the turn's task. */
export function noteLines(request: Pick<TurnRequest, 'reason' | 'notes' | 'origin'>, timezone: string | undefined, task?: Pick<TaskView, 'id' | 'title'>, scheduleTitle?: string): string[] {
  const id = request.origin?.source.startsWith('schedule:') ? request.origin.source.slice('schedule:'.length) : undefined;
  const schedule = scheduleSubject(id, scheduleTitle);
  return request.notes.map((note) => {
    const subject = (note.reason ?? request.reason) === 'schedule' ? schedule : task ? taskSubject(task) : undefined;
    return `${noteLabel(note.at, timezone, subject)} ${note.text}`;
  });
}

/** The title of the schedule a wake came from ('' when it is gone or the wake is not a schedule's). */
function scheduleTitleOf(services: RuntimeServices, origin: TurnRequest['origin']): string | undefined {
  if (!origin?.source.startsWith('schedule:')) return undefined;
  try { return services.scheduler.get(origin.source.slice('schedule:'.length))?.title; } catch { return undefined; }
}

/**
 * Session renewal: the native session binding is dropped; the next build rebuilds the session from the agent's record
 * (agents/rebuild.ts) or, where that cannot run, starts with the record as text (history-text.ts) – nothing of the context is lost.
 * 'mode'/'prompt' (SES2): the session's prompt key no longer matches – run note {fresh, …details}.
 * 'folder': bound to another working folder (Codex, I02; note {fresh: 'folder'}).
 */
export async function renewSession(services: RuntimeServices, plan: TurnPlan, engine: EngineId, runId: string, reason: 'context' | 'overflow' | 'mode' | 'prompt' | 'folder', details: Record<string, unknown> = {}): Promise<void> {
  if (reason === 'overflow') rebuildFellBack(services, plan.agent.id, plan.thread, engine, runId); // a session this run rebuilt that ended on its first turn: no rebuild of the thread for a while
  new SessionStore(services.db).remove(plan.agent.id, plan.thread, engine, services.clock.now()); // B-048: the ref is recorded as superseded
  const data = reason === 'mode' || reason === 'prompt' || reason === 'folder' ? { fresh: reason, ...details } : { sessionRenewed: reason };
  services.runs.item(runId, { kind: 'note', data, effectStatus: 'none' });
}

interface SessionChoice {
  session?: SessionBinding;
  contextWindow?: number;
  /** Delta start: the agent's cursor in the wake's chat. */
  sinceSeq: number;
  /** Told to the agent after a renewal for a mode switch. */
  note?: string;
  /** B-057: a split's session seeded from its parent (it holds the earlier context). */
  seeded?: boolean;
  /** B-057: a split's seed text (splits/fork.ts text fallback), put before the turn's input. */
  prefix?: string;
}

/** What seeding a split's session from its parent needs besides the plan (agents/split-turn.ts seedSplit). */
interface SeedContext { account: Account; model: string; offer: ToolOffer; prompt: { stable: string; volatile: string } }

/**
 * The native session for this turn: none for another account; rebuilt with its history when its prompt key
 * differs (SES2: 'mode' when the mode changed, else 'prompt'; B-080: the rebuild first, so the new prompt keeps the work –
 * renewed with a summary only when no rebuild can be made; a row without a key, from before SES2, is accepted once and
 * stamped); past the fit of the window (B-080 pastFit: the window the engine reported for this model – the one it really
 * runs with: the bound session's, else the newest any session of that model got (SessionStore.reportedWindow, so a model's
 * first session in a thread gets it too; splits/fork.ts uses the same rule) –, else the catalog's) the marks and the fit
 * come first and a renewal only when they cannot bring it in.
 */
async function chooseSession(services: RuntimeServices, plan: TurnPlan, request: TurnRequest, engine: Engine, accountId: string, route: RouteDecision, catalogWindow: number | undefined, key: string, native?: SeedContext): Promise<SessionChoice> {
  const store = new SessionStore(services.db);
  let session = engine.caps.sessions ? store.get(plan.agent.id, plan.thread, engine.id) : undefined;
  // A native session lives in one account home (CODEX_HOME / CLAUDE_CONFIG_DIR): no cross-account resume.
  if (session && session.accountId && session.accountId !== accountId) session = undefined;
  const contextWindow = (session && session.model === route.modelId ? session.contextWindow : undefined) ?? store.reportedWindow(engine.id, route.modelId) ?? catalogWindow;
  // The native rebuild, when this turn's case holds (undefined: the path below).
  const rebuild = async (current: SessionBinding | undefined, renewed?: 'mode' | 'prompt', overLimit?: boolean) => (native && engine.caps.rebuild
    ? nativeRebuild(services, { plan, request, engine, account: native.account, route, model: native.model, session: current, offer: native.offer, prompt: native.prompt, promptKey: key, contextWindow, renewed, overLimit })
    : undefined);
  // B-057: a split's first turn without a session on its thread starts from its parent (agents/split-turn.ts seedSplit).
  const seeded = session ? undefined : await seedSplit(services, plan, request, engine, route, key, native);
  if (seeded) return { session: seeded.session, contextWindow, sinceSeq: plan.memberCursor, prefix: seeded.prefix, seeded: seeded.session !== undefined };

  if (session && session.promptKey === undefined) store.stamp(plan.agent.id, plan.thread, engine.id, key, plan.mode.key);
  else if (session && session.promptKey !== key) {
    // A resumed session keeps the prompt and tools it started with: a new one under the new prompt, with the history the
    // ledger holds (B-080: before the summary – a summary first would cut the part the session holds down to the last lines).
    const from = session.mode && session.mode !== plan.mode.key ? session.mode : undefined;
    const reason = from ? 'mode' : 'prompt';
    const details = from ? { from, to: plan.mode.key } : {};
    const note = from ? modeChangeNote(services, from, plan.mode) : undefined;
    const rebuilt = await rebuild(undefined, reason);
    if (rebuilt) {
      services.runs.item(request.runId, { kind: 'note', data: { fresh: reason, ...details, history: 'rebuilt' }, effectStatus: 'none' });
      return { session: rebuilt.session, contextWindow, sinceSeq: rebuilt.sinceSeq, note, seeded: true };
    }
    await renewSession(services, plan, engine.id, request.runId, reason, details);
    return { contextWindow, sinceSeq: plan.memberCursor, note };
  }
  // Every engine with sessions. The subconscious's marks and the fit come first: the renewal is the backstop for a context nothing brings into the window.
  if (session && pastFit(session.contextTokens, contextWindow)) {
    const marked = await rebuild(session, undefined, true);
    if (marked) return { session: marked.session, contextWindow, sinceSeq: marked.sinceSeq, seeded: true };
    await renewSession(services, plan, engine.id, request.runId, 'context');
    return { contextWindow, sinceSeq: plan.memberCursor };
  }
  const rebuilt = await rebuild(session);
  if (rebuilt) return { session: rebuilt.session, contextWindow, sinceSeq: rebuilt.sinceSeq, seeded: true };
  return { session, contextWindow, sinceSeq: plan.memberCursor };
}

/**
 * PR3: the tool calls of unfinished attempts (also this run's, after a failover) when the engine
 * that runs now cannot know them – a new session, another engine or account, or no sessions at all.
 */
function previousAttempt(services: RuntimeServices, plan: TurnPlan, request: TurnRequest, now: Parameters<typeof needsRecap>[1], timezone: string | undefined): string | undefined {
  try {
    const actions = recentActions(services, recapScope(plan), request.runId);
    if (!needsRecap(actions, now)) return undefined;
    services.runs.item(request.runId, { kind: 'note', data: { previousAttempt: actions.length }, effectStatus: 'none' });
    return recapText(actions, timezone);
  } catch (error) {
    services.log.warn('previous attempt recap failed', { agentId: plan.agent.id, error: String(error) });
    return undefined;
  }
}

/**
 * The calls the engine shows this turn: the subconscious's; for a history that starts from the projection the call naming what is
 * marked there; and – a stateless engine holds nothing between turns – the subconscious's earlier calls, as a CLI session holds them.
 */
function turnTrace(services: RuntimeServices, plan: TurnPlan, session: SessionBinding | undefined, engine: Engine, runId: string): SubconsciousTrace | undefined {
  const marks = !session ? marksCall(marksOf(services, plan.agent.id, plan.thread)) : undefined;
  const earlier = !engine.caps.sessions ? carriedCalls(services, plan.agent.id, plan.thread, runId) : [];
  const calls = [...(marks ? [marks] : []), ...earlier, ...(plan.trace?.calls ?? [])];
  return calls.length ? { calls } : undefined;
}

/** One input item as last-prompt.md shows it: text as it is, an image by its path. */
function inputLine(item: RoutedTurn['input'][number]): string {
  return item.type === 'text' ? item.text : `[image: ${item.path}]`;
}

/** Resolves engine/account/model for a route, then prompt, tool offer, session and turn input. */
export async function buildTurn(services: RuntimeServices, plan: TurnPlan, request: TurnRequest, route: RouteDecision, repairNotes: string[]): Promise<RoutedTurn> {
  const engine = services.engines.get(route.engine);
  const account = services.accounts.get(route.accountId);
  if (!account) throw new WorkforceError('unavailable', 'The chosen account is not available.');
  const info = services.catalog.get(route.modelId);
  const model = info?.model ?? route.modelId.slice(route.modelId.indexOf(':') + 1);
  const promptInput = { agent: plan.agent, conversationId: plan.conversationId, taskId: plan.task?.id, thread: plan.thread, mode: plan.mode, route };
  let prompt = services.context.prompt(promptInput);
  let offer = offeredTools(services, plan, engine.caps); // B-049 F4: may grow by learned tools below (fresh session only); a part gets its agent's, like its parent
  let key = promptKey(prompt.stable, offer.names);
  // B-057: a split's seeded session starts with this turn's prompt (its volatile part as below).
  const native: SeedContext = { account, model, offer, prompt: { stable: prompt.stable, volatile: prompt.volatile } };
  const { session, contextWindow, sinceSeq, note, seeded: rebuilt, prefix } = await chooseSession(services, plan, request, engine, account.id, route, info?.caps.contextTokens, key, native);
  // B-049 F4 (TOOLS-CORE): tools this agent ran through tools.call in this chat join its offer where a fresh native
  // session starts (new, renewed, dropped, stateless engine) – never in a resumed or rebuilt one (tools/learned.ts); never for a split (B-057).
  if (!plan.split && !session && !rebuilt && promoteLearned(services, plan.agent.id)) {
    prompt = services.context.prompt(promptInput); // its "More tools" list no longer names what became direct
    offer = offeredTools(services, plan, engine.caps);
    key = promptKey(prompt.stable, offer.names);
  }

  let delta: DeltaResult = { text: '', images: [], lastSeq: 0 };
  if (plan.conversationId) {
    // Freshly attached PDFs/text files are extracted first, so the delta carries their text.
    try { await services.context.prepare?.({ agentId: plan.agent.id, conversationId: plan.conversationId, sinceSeq }); } catch (error) {
      services.log.warn('attachment extraction failed; the delta only names the files', { agentId: plan.agent.id, error: String(error) });
    }
    const query: DeltaInput = { agent: plan.agent, conversationId: plan.conversationId, sinceSeq };
    delta = services.context.delta(query);
  }
  // No session holds my context (a rebuild that could not run, a session-less engine, a part not forked): my own record as text.
  const history = !session && !prefix ? historyText(services, plan.agent.id, plan.thread, Math.floor(fitLimit(contextWindow) / 2)) : undefined;

  const timezone = services.settings.get().profile.timezone;
  // A seeded split session holds its parent's context already.
  const recap = rebuilt ? undefined : previousAttempt(services, plan, request, { engine: engine.id, accountId: account.id, sessionNew: !session, stateless: !engine.caps.sessions }, timezone);
  const cut = interruptionNote(services, plan, request, delta.lastSeq, timezone, recap);
  // The cut-off note says what the recovery wake's and the redelivery's notes say: one note, not two.
  const wakeNotes = cut ? request.notes.filter((wake) => wake.text !== INTERRUPTED_NOTE && wake.text !== REDELIVERY_NOTE) : request.notes;
  const results = splitResults(services, plan); // B-057 S6: the agent's own turn gets its settled splits' results once
  const notes = [cut, ...noteLines({ reason: request.reason, notes: wakeNotes, origin: request.origin }, timezone, plan.task, scheduleTitleOf(services, request.origin)), results?.text, ...repairNotes, note].map((line) => line && quoteHeaders(line)); // only the header lines below are headers
  const lines = [...notes, delta.text].filter((line): line is string => Boolean(line && line.trim()));
  // Nothing new arrived: said as a note, so it never reads as a person's instruction (B-047 eval: "resumed on the person's instruction").
  const now = services.clock.now();
  if (!lines.length && plan.task) lines.push(`${noteLabel(now, timezone, taskSubject(plan.task))} Nothing new arrived since my last turn; this task is ${plan.task.status}.`);
  if (!lines.length) lines.push(`${noteLabel(now, timezone)} Nothing new arrived since my last turn.`);
  if (plan.imagesHidden) lines.push(IMAGES_HIDDEN_NOTE);
  // For a session that cannot know them: the agent's latest answers that stayed in its run log – right after the <live> block.
  const answers = !history && (!session || !engine.caps.sessions) ? answersRecap(services, recapScope(plan), request.runId, timezone) : undefined;
  if (answers) lines.unshift(answers);
  const record = prefix ?? history; // a part's seed or my own record: what is new follows it under its own header
  if (record) lines.unshift(record, PROJECTION.fresh);
  const input: RoutedTurn['input'] = [{ type: 'text', text: lines.join('\n\n') }];
  if (engine.caps.images && !plan.imagesHidden) input.push(...await visionInputs(services, delta.images)); // B-058 G10: as they are, a converted copy or a media.view line
  // B-049 F6: a resumed (not seeded) native session gets only the volatile sections changed since its last finished turn.
  const sentKey = { agentId: plan.agent.id, conversationId: plan.thread, engine: engine.id };
  if (rebuilt) forgetSent(services.db, sentKey); // a seeded session starts without the old record
  const shown = prompt.sections ? volatileDelta(prompt.sections, session && !rebuilt ? sentTo(services.db, sentKey, session.ref) : undefined) : undefined;
  const volatile = shown ? shown.text : prompt.volatile;
  // B-066: what goes out this turn, readable; B-076: the main lane only, like last-run.md beside it.
  const dataDir = plan.split ? undefined : services.paths?.data;
  if (dataDir) writeLastPrompt(dataDir, plan.agent.id, { system: prompt.stable, input: services.secrets.redact([contextText(volatile), ...input.map(inputLine)].filter(Boolean).join('\n\n')) }, (message, data) => services.log?.debug(message, data));

  const trace = turnTrace(services, plan, session, engine, request.runId);
  return {
    route, engine, account, model, modelName: info?.name ?? model, contextWindow, session, prompt: { ...prompt, volatile }, tools: offer.native, promptKey: key,
    input, lastSeq: Math.max(delta.lastSeq, plan.memberCursor), ...(shown ? { volatileSent: shown.sections } : {}), ...(trace ? { trace } : {}),
    ...(results ? { splitParts: results.splitIds } : {}), // B-057: these parts are gathered when this turn ends done
  };
}
