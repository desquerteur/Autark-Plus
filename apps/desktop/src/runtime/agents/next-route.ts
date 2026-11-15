// "Use model X" requests of the agent itself (model.set tool → the routing of later turns) and
// the choice a turn returns to (RT2).
// Owns: in the kv table, one pending next-step request per agent (13.11.2026: one context – wherever the next turn is
// woken, it is the same me) – the next turn that reaches its engine takes
// it (B-080: planTurn reads it with its `at`, agents/turn.ts deletes that one with takeNextRoute just before the engine
// starts, so a turn that fails before its engine leaves it for the next one and a request written while the turn was
// prepared holds for the next turn) – and one task request per (agent, task): every turn of the
// agent on that task, in any chat (B-080: a task's turns run in several chats, a review or retry wake elsewhere and a
// handoff move it), applies it until the task is done or cancelled, then its row is dropped;
// `returnChoice`, a turn's RouteRequest.previous:
// the request in force (explicit; the next step's fields over the task's), else my last done run
// (any chat – one context; `returnRun`: with a next step in force my newest done run, whatever shaped it; with a task's request
// alone – or under a next step that names neither model nor effort (a temperature alone, 14.11.) – that task's newest done run;
// with none, one that no request of mine or a delegation shaped) and that the interim B-044
// small-model chat default did not route (its reason OLD_CHAT_DEFAULT: that default is gone, so a chat it
// put on Luna never stays there by the return rule) – with that run's category; B-083 D1: a named model also carries `from`, the model I am on
// (`onModel`: my newest done run, whatever shaped it), where the turn stays while the named one cannot run; a
// next-step request is still this one turn's, a task request holds until its model runs (routing/router.ts).
// `catalogModel`, the check of a model a request names (model.set, tasks.create / tasks.give, a split's part, my subconscious's
// turn): B-083 D5 the one lookup (routing/pins.ts modelMatches), D4 no effort refused – the router clamps it;
// `modelWord`: cheap / strong as a need relative to the model I run on.
// B-048 E4.2: a request may name a need (stronger, cheaper, faster, vision, long_context – routing/need.ts)
// instead of a model: it keeps the need, `from` (the model the agent ran on) and the model model.set
// named in its answer; the router resolves the need again on the turn (RouteRequest.previous.need).
// B-078 (D14/D16): a request may carry a temperature (0..2), kept like the effort (next step or task); B-080: planTurn
// puts it on TurnPlan.temperature (also without a run to return to) and the turn hands it to the engine; engines
// without one ignore it.
// B-083: my subconscious sets the coming turn before it starts (v1: subconscious/route-turn.ts): a next-step request with
// `by: 'subconscious'` and its why as `reason`; returnChoice hands both to the router on RouteRequest.previous (`by`,
// `why`), which names it "my subconscious: <why>" on the run's route (by stays 'request'). v1 routes every turn with content
// (a person's or a colleague's lines, else its task), and a next step – its or my own model.set – is relative to the model I am
// on (reviews 14.11.: skipping routed runs returned past nearly every recent turn, off a warm cache, and an effort-only model.set
// landed elsewhere than its preview showed). A turn without a request – a wake without anyone's words and without a task, a call
// that was cut or failed – skips them as B-083 did and continues where the router chose last, and a task's request alone returns
// to that task's runs (a model set for a colleague's receipt never carries over to the work of the next wake).
// Never: bypasses the router – a request reaches it as the explicit previous choice and the
// router keeps policy, budget and availability bounds (routing/previous.ts).

import type { Db } from '../db/database.ts';
import type { ModelCatalog, RouteRequest } from '../contracts.ts';
import type { Effort, ModelInfo } from '../../shared/model/providers.ts';
import { ROUTE_BY_REQUEST, type Run } from '../../shared/model/runs.ts';
import { resolvePin } from '../routing/pins.ts';

const NS = 'next_route';
const TASK_NS = 'next_route_task';

/** RouteRequest.previous as returnChoice gives it: B-083 `by`/`why` = the request in force is my subconscious's, with its why (router.ts reads them). */
export type Previous = NonNullable<RouteRequest['previous']>;
type Need = NonNullable<Previous['need']>['kind'];

/** `need` + `from` (E4.2): a kind of model relative to the one the agent ran on; `modelId` is then the model model.set named.
 *  `temperature` (B-078): the sampling temperature 0..2, kept like the effort; engines that take one send it.
 *  `by` (B-083): 'subconscious' – my subconscious set it before the turn (its why is `reason`); absent – my own model.set or a delegation. */
export interface NextRoute { modelId?: string; effort?: Effort; reason?: string; at: number; need?: Need; from?: string; temperature?: number; by?: 'subconscious' }

/** The route reason of a turn the removed B-044 chat default (an agent's plain conversation on Luna) chose. */
export const OLD_CHAT_DEFAULT = 'small model for conversation';

/** A done run of mine a turn can return to (B-057: never a split's – its model is its part's; never one the removed B-044 chat default chose). */
const doneRun = (run: Run) => !run.splitId && Boolean(run.model) && run.status === 'done' && !run.route?.reason?.includes(OLD_CHAT_DEFAULT);

/** What a turn's model is relative to: a next step's request, a task's request alone, or none. */
export type ReturnKind = 'step' | 'task' | 'none';

/**
 * The run a turn returns to (RT2, v1 14.11.2026). 'step' – a next step's request (my own model.set or my subconscious's) is relative to
 * the model I am on: my newest done run, whatever shaped it (model.set's preview shows that one). 'task' – a task's request alone is
 * relative to where that task ran last: its newest done run, else as 'none'. 'none' (B-083) – the router's last own choice: a run a
 * request shaped is skipped, so a model set for one message (a colleague's receipt on Luna) never carries over to other work.
 */
export function returnRun(runs: readonly Run[], kind: ReturnKind, taskId?: string): Run | undefined {
  if (kind === 'step') return runs.find(doneRun);
  const own = kind === 'task' && taskId ? runs.find((run) => doneRun(run) && run.taskId === taskId) : undefined;
  return own ?? runs.find((run) => doneRun(run) && run.route?.by !== ROUTE_BY_REQUEST);
}

/**
 * The kind of the request in force: a task's when the turn has its task and the request carries no next step (`stepAt`) of mine or my
 * subconscious's – or one whose model and effort are the task's (`ofTask`: the step names neither, a temperature alone); else a step's.
 */
function kindOf(requested: PendingRoute | undefined, taskId: string | undefined): ReturnKind {
  if (!requested) return 'none';
  return taskId && (requested.ofTask || (requested.stepAt === undefined && !requested.by)) ? 'task' : 'step';
}

function taskKey(agentId: string, taskId: string): string {
  return `${agentId}:${taskId}`;
}

function put(db: Db, ns: string, k: string, value: NextRoute): void {
  db.run('INSERT INTO kv (ns, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [ns, k, JSON.stringify(value), value.at]);
}

function read(db: Db, ns: string, k: string): NextRoute | undefined {
  const row = db.get<{ value: string }>('SELECT value FROM kv WHERE ns = ? AND key = ?', [ns, k]);
  if (!row) return undefined;
  try { return JSON.parse(row.value) as NextRoute; } catch { return undefined; }
}

/** The request for the agent's next turn, wherever it is woken (one step). */
export function setNextRoute(db: Db, agentId: string, value: NextRoute): void {
  put(db, NS, agentId, value);
}

/** The request for every turn of the agent on `taskId`, in any chat, until the task is done (replaces an earlier one). */
export function setTaskRoute(db: Db, agentId: string, taskId: string, value: NextRoute): void {
  put(db, TASK_NS, taskKey(agentId, taskId), value);
}

/**
 * Deletes the pending next-step request and returns it (it applies to one turn only: agents/turn.ts takes it as the engine
 * starts). B-080: with `at` – the request that turn read (PendingRoute.stepAt) – only while it is still the stored one: a
 * request written since stays for the next turn; without `at`, whatever is stored.
 */
export function takeNextRoute(db: Db, agentId: string, at?: number): NextRoute | undefined {
  const k = agentId;
  const value = read(db, NS, k);
  if (!value || (at !== undefined && value.at !== at)) return undefined;
  db.run('DELETE FROM kv WHERE ns = ? AND key = ?', [NS, k]);
  return value;
}

/**
 * The request in force for a turn; `stepAt` (B-080): the `at` of the next-step request in it, the one takeNextRoute ends; `ofTask`
 * (14.11.2026): its model and effort are the task's request – the next step on top names neither – so the turn returns to the task's runs.
 */
export type PendingRoute = NextRoute & { stepAt?: number; ofTask?: true };

/**
 * The request in force for a turn: the next step's (read, left in place – takeNextRoute ends it) over the task's, field
 * by field; the agent's task requests of finished tasks (`finished`) are dropped first.
 */
export function pendingRoute(db: Db, agentId: string, taskId: string | undefined, finished: (taskId: string) => boolean): PendingRoute | undefined {
  const prefix = `${agentId}:`;
  const rows = db.all<{ key: string }>('SELECT key FROM kv WHERE ns = ? AND substr(key, 1, ?) = ?', [TASK_NS, prefix.length, prefix]);
  for (const row of rows) if (finished(row.key.slice(prefix.length))) db.run('DELETE FROM kv WHERE ns = ? AND key = ?', [TASK_NS, row.key]);
  const step = read(db, NS, agentId);
  const scoped = taskId ? read(db, TASK_NS, taskKey(agentId, taskId)) : undefined;
  if (!step) return scoped;
  if (!scoped) return { ...step, stepAt: step.at };
  // A next-step request that names a model or a need replaces the task's model choice as a whole (E4.2).
  const shapes = Boolean(step.modelId || step.need);
  const model = shapes ? { modelId: step.modelId, need: step.need, from: step.from } : { modelId: scoped.modelId, need: scoped.need, from: scoped.from };
  // B-083: my subconscious's step keeps its own why (never the task request's reason under its name).
  const reason = step.by ? step.reason : step.reason ?? scoped.reason;
  const ofTask = !shapes && step.effort === undefined ? { ofTask: true as const } : {};
  const merged: PendingRoute = { ...model, effort: step.effort ?? scoped.effort, reason, temperature: step.temperature ?? scoped.temperature, by: step.by, at: step.at, stepAt: step.at, ...ofTask };
  for (const field of ['modelId', 'need', 'from', 'effort', 'reason', 'temperature', 'by'] as const) if (merged[field] === undefined) delete merged[field];
  return merged;
}

/** The catalog entry a name points to (D5, the one lookup – also for splits/validate.ts), or undefined. */
export function findModel(catalog: Pick<ModelCatalog, 'get' | 'list'>, name: string): ModelInfo | undefined {
  return catalog.get(name) ?? resolvePin(catalog.list(), name);
}

/**
 * A model a request names (model.set, tasks.create / tasks.give, a split's part, my subconscious's turn): its catalog entry through
 * the one lookup (D5, routing/pins.ts modelMatches: id, older id, provider model id or name in plain form) – else what I
 * read instead (first person, the fact and what helps). The effort is the router's to clamp (D4, routing/router.ts).
 */
export function catalogModel(catalog: Pick<ModelCatalog, 'get' | 'list'>, model: string): ModelInfo | string {
  const info = findModel(catalog, model);
  if (!info) return `Unknown model "${model}". Known: ${catalog.list().filter((item) => item.available).slice(0, 12).map((item) => item.id).join(', ') || 'none'}.`;
  if (!info.available) return `${info.name} has no usable account right now.`;
  return info;
}

/** D5: cheap / strong where I name a model (model.set, tasks.create, tasks.give) – a need relative to the model I run on (routing/need.ts). */
export function modelWord(named: string): 'cheaper' | 'stronger' | undefined {
  const word = named.trim().toLowerCase();
  return word === 'cheap' ? 'cheaper' : word === 'strong' ? 'stronger' : undefined;
}

/** D1: the model I am on – my newest done run (a split's aside), whatever shaped its route. */
export function onModel(runs: readonly Run[]): string | undefined {
  return runs.find((run) => !run.splitId && Boolean(run.model) && run.status === 'done')?.model;
}

/**
 * RouteRequest.previous of a turn. `runs` = the agent's runs, newest first; `taskId` = the turn's task (a task's request alone returns
 * to that task's runs, returnRun). A request without a model and without a run to return to keeps modelId '' (its effort still
 * applies). B-083: a request of my subconscious carries `by` and its why along (a temperature-only one on the run returned to).
 */
export function returnChoice(runs: readonly Run[], requested: PendingRoute | undefined, place: { taskId?: string } = {}): Previous | undefined {
  const choice = choiceOf(runs, requested, place.taskId);
  return choice && requested?.by ? { ...choice, by: requested.by, ...(requested.reason ? { why: requested.reason } : {}) } : choice;
}

function choiceOf(runs: readonly Run[], requested: PendingRoute | undefined, taskId: string | undefined): Previous | undefined {
  const kind = kindOf(requested, taskId);
  const last = returnRun(runs, kind, taskId);
  const category = last?.route?.category ? { category: last.route.category } : {};
  const base: Previous | undefined = last?.model ? { modelId: last.model, effort: last.effort ?? 'medium', ...category } : undefined;
  if (requested?.need) {
    // E4.2: the router resolves the need relative to `from`; modelId = the model model.set named (else `from`).
    const need = { kind: requested.need, ...(requested.from ? { from: requested.from } : {}) };
    const modelId = requested.modelId ?? requested.from ?? base?.modelId ?? '';
    return requested.effort
      ? { modelId, effort: requested.effort, explicit: true, need }
      : { modelId, effort: base?.effort ?? 'medium', explicit: true, asked: 'model', need, ...category };
  }
  // D1: the model the work is on – where the turn stays while the one named cannot run (routing/router.ts): for a task's request alone
  // that task's own base run, never a model set for other work (re-review 14.11.), else the model I am on.
  const on = requested?.modelId ? (kind === 'task' ? last?.model : onModel(runs)) : undefined;
  const from = on && on !== requested?.modelId ? { from: on } : {};
  if (requested?.modelId && requested.effort) return { modelId: requested.modelId, effort: requested.effort, explicit: true, ...from };
  if (requested?.modelId) return { modelId: requested.modelId, effort: base?.effort ?? 'medium', explicit: true, asked: 'model', ...category, ...from };
  if (requested?.effort) return { modelId: base?.modelId ?? '', effort: requested.effort, explicit: true, asked: 'effort', ...category };
  return base;
}
