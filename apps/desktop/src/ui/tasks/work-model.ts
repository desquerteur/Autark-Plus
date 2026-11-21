// Pure rules of Work (#/tasks, B-078 D10) and the owner rules every task surface shares (moved out of
// tasks/model.ts, which re-exports all of it). Work shows two things, told apart by shape (owner 06.11.: "nicht von
// irgendwelchen Texten … sondern Formen und Farben"):
//   For you – the agents' work that needs the person now (waits on them, or an open human step asks them): forYou;
//   the report – a quiet prose block of the team's side work and facts (tasks.finish alsoHandled) and of work
//   nobody asked for, from the last REPORT_DAYS days, deduplicated, newest first (B-080: every line, the view shows
//   REPORT_MAX until "Show all"): report.
//   Your tasks – what the person handed out, typed here or said in his chats (createdBy 'human', or B-080 an agent's
//   task in one of his main-section chats that no schedule started; owned by someone else): open ones and the ones that
//   finished in the last REPORT_DAYS days, newest first, each with one status form (yourTasks, yourStatus) –
//   a spinner while a turn works on it, a check when done – so a task never vanishes after it was sent;
// Everything else the agents handle on their own; one agent's open work shows as slim rows when the sidebar's
// "People & agents" narrows Work to it (#/tasks?owner=, ownerWork). Also: the viewer's scope (a person's device
// keeps its own to-dos), the next moment the report changes by time alone,
// the search's hits over every task under the open matches (B-080 searchHits, searchRows), the Work routes a click
// leads to and what a result's evidence chip opens (B-080 evidenceTarget).
// Owns: these rules (unit-tested in test/unit/work/*). Never: imports the store, rpc or the DOM, or reads a clock –
// callers pass data and the time in.

import { isFinished, isPaused, type Task, type TaskStatus, type TaskView } from '../../shared/model/tasks.ts';
import { isHumanActor } from '../../shared/model/people.ts';
import { onForYouList } from '../../shared/model/todo-later.ts';
import { DAY_MS } from './todo-model.ts';

export { isFinished };

// ------------------------------------------------------------------ order and windows

type Sortable = Pick<Task, 'priority' | 'dueAt' | 'sort' | 'createdAt'>;

/** Board order (same as the runtime): priority ↓, due ↑ (none last), manual sort, age. */
export function compareTasks(a: Sortable, b: Sortable): number {
  return b.priority - a.priority
    || (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER)
    || a.sort - b.sort
    || a.createdAt - b.createdAt;
}

export function finishedAt(task: Pick<Task, 'completedAt' | 'updatedAt'>): number { return task.completedAt ?? task.updatedAt; }

/** Newest finished first. */
export function compareDone(a: Pick<Task, 'completedAt' | 'updatedAt'>, b: Pick<Task, 'completedAt' | 'updatedAt'>): number {
  return finishedAt(b) - finishedAt(a);
}

/** Top-level finished tasks inside the last `days` days, newest first. */
export function recentDone<T extends Task>(list: T[], now: number, days = 3, statuses: readonly TaskStatus[] = ['done']): T[] {
  const since = now - days * DAY_MS;
  return list.filter((task) => !task.parentId && statuses.includes(task.status) && finishedAt(task) >= since).sort(compareDone);
}

/** Case-insensitive search over title, notes and chat name. */
export function searchTasks<T extends TaskView>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((task) => task.title.toLowerCase().includes(q) || task.notes.toLowerCase().includes(q) || task.conversationTitle.toLowerCase().includes(q));
}

const WORK_RANK: Record<TaskStatus, number> = { waiting: 1, open: 4, done: 5, dropped: 6 };

/** Work order: running turns first, then by status, then board order. */
export function compareWork(a: TaskView, b: TaskView): number {
  return Number(b.running) - Number(a.running) || (WORK_RANK[a.status] ?? 7) - (WORK_RANK[b.status] ?? 7) || compareTasks(a, b);
}

// ------------------------------------------------------------------ owners

/** F-52: 'person' – another human of the organisation (on a person's device the CEO is the person 'owner'). */
export type Owner = { kind: 'team' } | { kind: 'agent'; id: string } | { kind: 'human' } | { kind: 'person'; id: string };

export function ownerOf(task: Pick<Task, 'assigneeKind' | 'assigneeId'>): Owner {
  if (task.assigneeKind === 'human') return task.assigneeId && task.assigneeId !== 'human' ? { kind: 'person', id: task.assigneeId } : { kind: 'human' };
  if (task.assigneeKind === 'agent' && task.assigneeId) return { kind: 'agent', id: task.assigneeId };
  return { kind: 'team' };
}

/** The owner filter of Work and the agent page (#/tasks?owner=, O5): 'team' (no owner), an agent or person id, or anyone (undefined). */
export function ownedBy(task: Pick<Task, 'assigneeKind' | 'assigneeId'>, owner: string | undefined): boolean {
  return !owner || (owner === 'team' ? task.assigneeKind === 'team' : task.assigneeId === owner);
}

/** The removable chip of #/tasks?owner=: 'Unassigned' (the sidebar's word for no owner) or the agent's or person's name. */
export const ownerChipLabel = (owner: string, nameOf: (id: string) => string): string => (owner === 'team' ? 'Unassigned' : nameOf(owner));

/** No owner yet: an older PC's row the watcher still has to give an owner. */
export function hasNoOwner(task: Pick<Task, 'parentId' | 'assigneeKind' | 'status'>): boolean {
  return !task.parentId && task.assigneeKind === 'team' && !isFinished(task.status);
}

// ------------------------------------------------------------------ what Work lists

/** `keepOwn`: also list the viewer's own to-dos – a person's device does (colleagues' My day comes later, B-041 §7). */
export interface WorkScope { keepOwn?: boolean }

type Listed = Pick<Task, 'parentId' | 'assigneeKind' | 'assigneeId' | 'status' | 'waitingOn'>;

/** On Work: top-level, and not one of the viewer's own to-dos – on their list when open (onForYouList), any finished one. */
export function onWork(task: Listed, scope: WorkScope = {}): boolean {
  if (task.parentId) return false;
  if (scope.keepOwn) return true;
  return isFinished(task.status) ? ownerOf(task).kind !== 'human' : !onForYouList(task);
}

/** Open work Work lists (everyone's – agents', colleagues', unassigned – but the viewer's own to-dos). */
export function isOpenWork(task: Listed, scope: WorkScope = {}): boolean { return !isFinished(task.status) && onWork(task, scope); }

// ------------------------------------------------------------------ For you

type Asking = Listed & Pick<TaskView, 'steps'>;

/** An open human step with a widget: the owner's question to the person (a mini-app step stays on My day). */
function asksThePerson(task: Pick<TaskView, 'steps'>): boolean {
  return (task.steps ?? []).some((step) => step.assigneeKind === 'human' && !isFinished(step.status) && Boolean(step.widget) && String(step.widget?.type) !== 'app');
}

/** Agent work that needs the person now: it waits on them (never their own pause) or one of its pieces asks them. */
export function needsThePerson(task: Asking): boolean {
  if (isFinished(task.status) || isPaused(task) || ownerOf(task).kind === 'human') return false;
  return waitsOnThePerson(task) || asksThePerson(task);
}

/** Waits on the person (the owner, 'human'). */
export function waitsOnThePerson(task: Pick<Task, 'status' | 'waitingOn'>): boolean {
  return task.status === 'waiting' && task.waitingOn?.on === 'who' && (!task.waitingOn.who || task.waitingOn.who === 'human') && !isPaused(task);
}

/** The For-you cards: the open work that needs the person, the most urgent first, narrowed to the search. */
export function forYou<T extends TaskView>(open: readonly T[], query = '', scope: WorkScope = {}): T[] {
  return searchTasks(open.filter((task) => isOpenWork(task, scope) && needsThePerson(task)), query).sort(compareTasks);
}

/** One owner's open work as slim rows (the sidebar's People & agents), running first. */
export function ownerWork<T extends TaskView>(open: readonly T[], owner: string, query = '', scope: WorkScope = {}): T[] {
  return searchTasks(open.filter((task) => isOpenWork(task, scope) && ownedBy(task, owner)), query).sort(compareWork);
}

/** Open work that matches a search, as slim rows (the search finds every open task, not only For you). */
export function matchingWork<T extends TaskView>(open: readonly T[], query: string, scope: WorkScope = {}): T[] {
  return query.trim() ? searchTasks(open.filter((task) => isOpenWork(task, scope) && !needsThePerson(task)), query).sort(compareWork) : [];
}

/**
 * B-080: the hits of the search over every task (tasks.list – finished ones and steps too) as slim rows: the store's
 * live copy of an open task where it has one, minus what Work already shows (`shown`: the cards, Your tasks) and, as
 * on Work, minus the viewer's own top-level to-dos; running first, then by status.
 */
export function searchHits<T extends TaskView>(hits: readonly T[], live: readonly T[], shown: ReadonlySet<string>, scope: WorkScope = {}): T[] {
  const byId = new Map(live.map((task) => [task.id, task]));
  return hits.map((task) => byId.get(task.id) ?? task)
    .filter((task) => !shown.has(task.id) && (Boolean(task.parentId) || onWork(task, scope)))
    .sort(compareWork);
}

/**
 * B-080: the search's slim rows – the open matches found here (`local`: chat names and word parts too, which the
 * full-text search does not index) in their own order, then the hits not among them (searchHits); undefined `hits`
 * (no answer yet, or it failed) leaves the open matches alone. Nothing already shown moves when the answer comes.
 */
export function searchRows<T extends TaskView>(local: readonly T[], hits: readonly T[] | undefined, live: readonly T[], shown: ReadonlySet<string>, scope: WorkScope = {}): T[] {
  const rows = local.filter((task) => !shown.has(task.id));
  if (!hits) return rows;
  const here = new Set(local.map((task) => task.id));
  return [...rows, ...searchHits(hits.filter((task) => !here.has(task.id)), live, shown, scope)];
}

// ------------------------------------------------------------------ Your tasks

/** Your tasks shows this many rows until "Show all". */
export const YOUR_TASKS_VISIBLE = 20;

/** The one status form of a Your-tasks row (a fixed cell on its left): shape, never a word. */
export type YourStatus = 'working' | 'done' | 'dropped' | 'needs_you' | 'open';

/** What the cell shows: a running turn first, then the final states, a wait on the person, else the empty circle. */
export function yourStatus(task: Pick<Task, 'status' | 'waitingOn'>, running: boolean): YourStatus {
  if (task.status === 'done' || task.status === 'dropped') return task.status;
  if (running) return 'working';
  return waitsOnThePerson(task) ? 'needs_you' : 'open';
}

export interface YourTask<T> { task: T; status: YourStatus }

/**
 * B-080 (live 05.–08.11.: of 98 top-level tasks only 1 was created by the person – he hands out work by speaking in
 * his chats, and the agent there creates the task): a task he handed out – created by him, or made in one of his own
 * chats (`inMyChat`: the chat list's main section) by its agent, not started by a schedule.
 */
function handedOut(task: Pick<Task, 'createdBy' | 'conversationId' | 'origin'>, inMyChat?: (conversationId: string) => boolean): boolean {
  if (task.createdBy === 'human') return true;
  return Boolean(task.conversationId && inMyChat?.(task.conversationId) && !task.origin?.source?.startsWith('schedule:'));
}

/**
 * The person's own handed-out tasks (handedOut): top-level, owned by someone else (their own to-dos live on My day) –
 * open ones plus the ones finished in the last `days` days, newest first (open: last change, finished: finish time),
 * narrowed to the search. `activeIds` – the tasks an agent works on right now (store activity) – count for the spinner
 * next to the task's own `running` flag; `skip` – ids already shown elsewhere on Work (the For-you cards).
 */
export function yourTasks<T extends TaskView>(
  open: readonly T[], done: readonly T[], now: number,
  options: { activeIds?: ReadonlySet<string>; skip?: ReadonlySet<string>; query?: string; days?: number; inMyChat?: (conversationId: string) => boolean } = {},
): Array<YourTask<T>> {
  const since = now - (options.days ?? REPORT_DAYS) * DAY_MS;
  const seen = new Set<string>();
  const pool = [...open.filter((task) => !isFinished(task.status)), ...done.filter((task) => isFinished(task.status) && finishedAt(task) >= since)]
    .filter((task) => {
      if (seen.has(task.id) || task.parentId || !handedOut(task, options.inMyChat) || ownerOf(task).kind === 'human' || options.skip?.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
  const at = (task: T): number => (isFinished(task.status) ? finishedAt(task) : task.updatedAt);
  return searchTasks(pool, options.query ?? '')
    .sort((a, b) => at(b) - at(a) || b.createdAt - a.createdAt)
    .map((task) => ({ task, status: yourStatus(task, task.running || Boolean(options.activeIds?.has(task.id))) }));
}

// ------------------------------------------------------------------ the report

/** The report covers this many days. */
export const REPORT_DAYS = 3;
/** At most this many lines (B-080: the view shows this many until "Show all"; report() takes every line with max: Infinity). */
export const REPORT_MAX = 8;
/** Kept for callers that load finished work: the report's window. */
export const DONE_DAYS = REPORT_DAYS;

export interface ReportLine<T> { key: string; text: string; at: number; task: T }

type Reported = Pick<TaskView, 'id' | 'parentId' | 'status' | 'completedAt' | 'updatedAt' | 'createdBy' | 'result' | 'title' | 'assigneeKind' | 'assigneeId' | 'waitingOn' | 'conversationId' | 'origin'>;

/** Sources no person starts: a schedule, a connected app, task news (shared/model/origin.ts). */
const UNASKED_SOURCE = /^(schedule:|app:|news$)/;

/**
 * Work nobody asked for: an agent or the app made it, outside any chat (a chat task is the answer to someone there),
 * from a schedule, an app or task news. An agent's task for a person's request in a chat is no report line.
 */
export function unaskedWork(task: Pick<Task, 'createdBy' | 'conversationId' | 'origin'>): boolean {
  return !isHumanActor(task.createdBy) && !task.conversationId && UNASKED_SOURCE.test(task.origin?.source ?? '');
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/**
 * The report: per finished task (done, top-level, on Work, the last `days` days, newest first) its alsoHandled
 * lines – the team's side work and facts – and, for work nobody asked for (unaskedWork: a schedule, an app or task
 * news started it, no person), its result in one line. Deduplicated by text, at most `max` lines.
 */
export function report<T extends Reported>(done: readonly T[], now: number, options: { days?: number; max?: number; scope?: WorkScope; query?: string } = {}): Array<ReportLine<T>> {
  const since = now - (options.days ?? REPORT_DAYS) * DAY_MS;
  const max = options.max ?? REPORT_MAX;
  const q = options.query?.trim().toLowerCase() ?? '';
  const seen = new Set<string>();
  const out: Array<ReportLine<T>> = [];
  const finished = done.filter((task) => task.status === 'done' && !task.parentId && finishedAt(task) >= since && onWork(task, options.scope))
    .sort(compareDone);
  for (const task of finished) {
    const lines = (task.result?.alsoHandled ?? []).map((line) => oneLine(line, 220)).filter(Boolean);
    if (unaskedWork(task) && task.result?.summary?.trim()) lines.push(oneLine(`${task.title}: ${task.result!.summary}`, 220));
    lines.forEach((text, index) => {
      const folded = text.toLowerCase();
      if (out.length >= max || seen.has(folded) || (q && !folded.includes(q) && !task.title.toLowerCase().includes(q))) return;
      seen.add(folded);
      out.push({ key: `${task.id}:${index}`, text, at: finishedAt(task), task });
    });
    if (out.length >= max) break;
  }
  return out;
}

// ------------------------------------------------------------------ People & agents

export interface WorkOwner { id: string; kind: 'agent' | 'person'; count: number }

/** "People & agents": every agent and person with open work, most first (then by name), and how much work has no owner. */
export function workOwners(open: TaskView[], nameOf: (id: string) => string, scope: WorkScope = {}): { owners: WorkOwner[]; unassigned: number } {
  const byId = new Map<string, WorkOwner>();
  let unassigned = 0;
  for (const task of open) {
    if (!isOpenWork(task, scope)) continue;
    const owner = ownerOf(task);
    if (owner.kind === 'team') unassigned++;
    if (owner.kind !== 'agent' && owner.kind !== 'person') continue;
    const entry = byId.get(owner.id);
    if (entry) entry.count++; else byId.set(owner.id, { id: owner.id, kind: owner.kind, count: 1 });
  }
  const owners = [...byId.values()].sort((a, b) => b.count - a.count || nameOf(a.id).localeCompare(nameOf(b.id)));
  return { owners, unassigned };
}

// ------------------------------------------------------------------ the clock

/** The next moment after `now` the report changes by time alone (a finished task leaving its window); none: undefined. */
export function nextWorkChange(_open: readonly TaskView[], done: readonly TaskView[], now: number): number | undefined {
  let next: number | undefined;
  for (const task of done) {
    if (task.parentId) continue;
    const at = finishedAt(task) + REPORT_DAYS * DAY_MS + 1;
    if (at > now && (next === undefined || at < next)) next = at;
  }
  return next;
}

// ------------------------------------------------------------------ routes

export interface WorkRoute { view: 'tasks'; filter?: string; owner?: string; task?: string }

/** Where a Work click leads: Work, narrowed to `owner` or not, never a selected task (older #/tasks/<filter> links open the plain view). */
export function workRoute(owner?: string): WorkRoute {
  return { view: 'tasks', ...(owner ? { owner } : {}) };
}

/** The same Work route with `task` selected – or none (the detail closed). */
export function withTask(route: WorkRoute, task?: string): WorkRoute {
  const { task: _old, ...rest } = route;
  return task ? { ...rest, task } : rest;
}

const WEB = /^https?:\/\//i;
const ABSOLUTE = /^(?:[a-z]:[\\/]|\/|\\\\)/i; // C:\… or C:/…, /…, \\server\…
const IMAGE = /\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/** B-080: what a result's evidence chip opens (ResultView.tsx) – a link, an image path, another path – or nothing (a static chip). */
export function evidenceTarget(ref: string | undefined): { kind: 'link' | 'image' | 'path'; ref: string } | undefined {
  const value = ref?.trim() ?? '';
  if (WEB.test(value)) return { kind: 'link', ref: value };
  if (!ABSOLUTE.test(value)) return undefined;
  return { kind: IMAGE.test(value) ? 'image' : 'path', ref: value };
}
