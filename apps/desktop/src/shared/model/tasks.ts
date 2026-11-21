// Task model ("simplified Asana"), human to-dos with adaptive widgets, and schedules.
// A task is its own row; `conversationId` is the chat it was handed over in, if any (its anchor message). Four stored
// states – open, waiting (on whom or what, why, since, until), done, dropped; "working" is only a live run on it
// (TaskView.running). Every unfinished task has one planned look (`nextAt`, runtime/tasks/next.ts).
// Owns: shapes for tasks, results/evidence, schedules, and the pause marker (isPaused).
// Never: a second task world – the board, the "My day" list, the PWA and the phone are queries over these rows.

import type { UiBlock } from '../blocks/catalog.ts';
import type { Attachment } from './chat.ts';
import type { EstimateSource, TaskPrep, TaskWindow } from './calendar.ts';
import type { Origin } from './origin.ts';

export type TaskStatus = 'open' | 'waiting' | 'done' | 'dropped';

/** 'team' is only on rows an older PC still sends: the watcher gives such a task an owner (runtime/tasks/watch.ts). */
export type AssigneeKind = 'team' | 'agent' | 'human';

export type Verification = 'reported_by_human' | 'claimed_by_agent' | 'verified';

export interface Evidence {
  kind: 'file' | 'link' | 'tool' | 'check' | 'note' | 'screenshot';
  label: string;
  ref?: string; // file id, url, run item id …
}

export interface TaskResult {
  summary: string; // what came out – for a dropped task why ("Dropped by Felix: …")
  alsoHandled?: string[]; // side work everyone should know ("Also handled: …")
  evidence: Evidence[];
  followUps?: Array<{ scheduleId?: string; taskId?: string; label: string }>;
  verification: Verification;
  answer?: unknown; // structured answer from a human widget (record/choice/form …)
  /** Why a claimed result is not 'verified' ("Not independently checked: …"), one muted line under the result. */
  verificationNote?: string;
  /** Finished quietly (tasks.finish quiet) – nobody gets a notice. */
  quiet?: true;
}

/** One logged change of a task (runtime/tasks/changes.ts): who changed which of the logged fields, with the values before and after (null = none). */
export interface TaskChange {
  id: string;
  at: number;
  by: string; // the actor's id: 'human', a per_… id, 'system' or an agent id
  kind: 'update' | 'finish' | 'give';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** Set when it was undone (tasks.undo), and by whom. */
  undone?: number;
  undoneBy?: string;
}

/** What a task keeps across turns and owners (the ledger column: one JSON container, read as it is by older PCs too). */
export interface TaskLedger {
  plan?: string[]; // the steps, "✓ " before a done one (tasks.update plan)
  facts?: string[]; // lines learned or decided, kept for whoever works on it next
  stalls?: number; // turns in a row that did not move it (the retry pause doubles)
  movedAt?: number; // its last real move: a status change, a new plan or fact, a give, a finished piece, a turn that moved it
  doneCount?: number; // how often the person ticked off a repeating to-do (its author hears only the first)
  givenIn?: string; // the chat of the agent turn that gave it, when that is not its own chat: where the giver hears how it ended
  changes?: TaskChange[]; // the last logged changes within 24 hours (the undo's source; runtime/tasks/changes.ts)
}

/** What a waiting task waits on: a person or agent (`who`), tasks (`ids`), or something outside; `until`: when it is looked at again. */
export interface TaskWait {
  on: 'who' | 'task' | 'outside';
  who?: string; // an agent id, 'human' (the owner) or a colleague's per_… id
  ids?: string[]; // on 'task'
  why: string;
  since: number;
  until?: number;
}

export interface Task {
  id: string;
  conversationId?: string; // the chat it was handed over in; absent = a chat-free task (To-do area, mail, routine …)
  messageId?: string; // anchor message (kind 'task') in its chat; pieces and chat-free tasks have none
  parentId?: string; // the task this is a piece of
  title: string; // the goal, short
  notes: string; // details (markdown)
  status: TaskStatus;
  assigneeKind: AssigneeKind;
  assigneeId?: string; // agent id or a colleague's per_… id; absent (or 'human') for the owner
  createdBy: string; // 'human', a per_… id, 'system' or an agent id
  priority: 0 | 1 | 2; // 0 normal, 1 high, 2 urgent
  dueAt?: number; // for a person: when they do it
  doneWhen?: string; // the outcome in one line (checked once by the verifier, tasks/verification.ts)
  dependsOn?: string[]; // the tasks this one comes after (tasks/depends.ts)
  widget?: UiBlock; // how a person answers (ask block from the catalog)
  waitingOn?: TaskWait;
  result?: TaskResult;
  ledger: TaskLedger;
  /** The one planned look (column next_at): when the watcher looks at it next (runtime/tasks/next.ts). Absent: nothing planned. */
  nextAt?: number;
  sort: number;
  rev: number; // optimistic concurrency counter
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  /** Who last gave it its owner ("given by"); that giver hears how it ends. */
  assignedBy?: string;
  // My day (shared/model/calendar.ts; written through day.* / todos.prepare, tasks/patch-fields.ts):
  estimateMin?: number; // minutes the person needs
  estimateSource?: EstimateSource;
  spentMs?: number; // accumulated focus-timer time
  timerStartedAt?: number; // focus timer running since (epoch ms)
  window?: TaskWindow; // when it can be done
  prep?: TaskPrep; // host-rendered preparation by an agent
  private?: boolean; // "Only me": no AI help, hidden from agents
  spaceId?: string; // set only on a chat-free task; a task with a chat gets its space from that chat
  origin?: Origin; // why it exists (runtime-written)
  files?: Attachment[]; // the files it was posted with (a quick task's)
}

/** A task with its pieces, as rendered in chats and the board. */
export interface TaskView extends Task {
  steps: Task[]; // its pieces (child tasks)
  progress: { done: number; total: number };
  conversationTitle: string; // '' when the task has no chat
  running: boolean; // a turn runs on it right now ("Working")
}

export interface TaskFilter {
  conversationId?: string;
  status?: TaskStatus[];
  assigneeKind?: AssigneeKind;
  assigneeId?: string;
  spaceId?: string;
  search?: string;
  includeSteps?: boolean;
  limit?: number;
  /** Only tasks finished (done/dropped) at or after this epoch ms. */
  completedSince?: number;
  /** Runtime only (agents' task tools, never an RPC param): only tasks this agent may read (tasks/access.ts readableSql). */
  readableBy?: string;
  /** Unfinished tasks this actor gave (assigned_by, else created_by) that someone else owns – "Given by me". */
  givenBy?: string;
}

export interface CreateTaskInput {
  conversationId?: string; // the chat to hand it over in; absent = a chat-free task
  origin?: Origin; // why it exists (runtime code only – never taken from an agent's or a person's input)
  spaceId?: string; // runtime only – a chat-free task's space (a quick task's chosen space); ignored with a chat
  title: string;
  notes?: string;
  plan?: string[];
  givenIn?: string; // runtime only – the giving agent turn's chat (TaskLedger.givenIn)
  assigneeKind?: AssigneeKind;
  assigneeId?: string;
  dueAt?: number;
  priority?: Task['priority'];
  doneWhen?: string;
  dependsOn?: string[];
  parentId?: string;
  widget?: UiBlock;
  clientId?: string;
  files?: Attachment[]; // runtime only – a quick task's stored files (tasks/quick.ts)
  // My day: as on Task.
  estimateMin?: number;
  estimateSource?: EstimateSource;
  spentMs?: number;
  timerStartedAt?: number;
  window?: TaskWindow;
  prep?: TaskPrep;
  private?: boolean;
}

export const UNFINISHED: readonly TaskStatus[] = ['open', 'waiting'];

export function isFinished(status: TaskStatus): boolean { return status === 'done' || status === 'dropped'; }

/** The wait a person's Stop leaves: "Paused by you" – nothing runs on it until they or its owner move it on. */
export const PAUSED_REASON = 'Paused by you';

export function isPaused(task: Pick<Task, 'status' | 'waitingOn'>): boolean {
  return task.status === 'waiting' && task.waitingOn?.on === 'who' && task.waitingOn.why === PAUSED_REASON;
}

// ---------------------------------------------------------------- schedules

export type ScheduleKind =
  | 'message' // a visible chat message sent at the given time (as if typed then)
  | 'reminder' // an agent's own reminder: wakes the agent with a note to itself
  | 'routine' // recurring job: each fire creates a tracked task/run (e.g. answer comments)
  | 'timer'; // a human timer/reminder widget (rings on desktop/phone)

export interface ScheduleSpec {
  at?: number; // one-off epoch ms; with cron / times "not before", with everyMs the interval's anchor
  cron?: string; // 5-field cron (croner syntax)
  everyMs?: number; // fixed interval (>= 60_000 unless kind 'timer')
  times?: string[]; // B-044: clock times each local day ("09:00", "13:30"; 1–24, in `tz`) – several times a day without cron
  tz?: string; // IANA zone; default OS zone
  until?: number;
  maxRuns?: number;
  except?: string[]; // YYYY-MM-DD dates to skip
  days?: number[]; // only fire on these local weekdays (0 Sunday … 6 Saturday, in `tz`)
  window?: { from: string; to: string }; // only fire between HH:MM and HH:MM
  catchUp?: 'once' | 'all' | 'skip'; // what to do with fires missed while the PC was off
}

/** One entry of a schedule's history (newest last, the last 30 kept): what happened to an occurrence. */
export interface ScheduleRun {
  at: number; // the planned occurrence (epoch ms)
  firedAt: number; // when it was handled
  outcome: 'ok' | 'skipped' | 'failed' | 'ended'; // skipped: missed while the PC was off, or the last routine task was still open; ended: the schedule stopped (its chat or owner is gone)
  manual?: true; // started with "Run now"
  taskId?: string; // a routine's run: the task it created, or the still-open one it was skipped for
  note?: string; // one short line (why skipped or failed)
}

export const SCHEDULE_HISTORY_MAX = 30;

export interface Schedule {
  id: string;
  ownerId: string; // 'human' or agent id
  conversationId?: string;
  taskId?: string;
  kind: ScheduleKind;
  title: string; // shown as a small chip ("Answer YouTube comments · daily 18:00")
  spec: ScheduleSpec;
  payload: { body?: string; note?: string; mentions?: string[]; taskTemplate?: { title: string; notes?: string; mode?: string }; priority?: 'normal' | 'important'; silent?: boolean; ultra?: true }; // silent (B-050 K4): a quiet scheduled message; ultra (B-057): Ultra suggested for it
  nextAt?: number;
  lastAt?: number;
  runs: number;
  active: boolean;
  history?: ScheduleRun[]; // #20: the last runs, kept in the payload column's JSON like pausedBy (no migration)
  pausedBy?: string; // B-044: who paused it ('human' or an agent id); only the person resumes what the person paused
  createdAt: number;
}

// ---------------------------------------------------------------- mini-app to-dos (addition F01)

/**
 * The widget of a to-do an agent programmed itself (an ```app todo=true fence): it points back at
 * the fence – the message stays the only copy of the app's HTML – and is no catalog block (never
 * validated as an ask block, no "Show as…", no timer). Stored in the to-do's widget column.
 * `Task.widget` is still typed `UiBlock`; read it as a TodoWidget through
 * shared/blocks/app-todo.ts `appWidgetOf`.
 */
export interface AppTodoWidget {
  type: 'app';
  messageId: string; // the agent message that holds the fence
  index: number; // the fence's parse index (the chat's blockIndex)
  title?: string;
  permissions: string[]; // what the app may ask the person for (granted by them, once)
  expand?: boolean;
}

/** What a human to-do's widget column holds: a catalog ask block or a mini-app. */
export type TodoWidget = UiBlock | AppTodoWidget;

// ---------------------------------------------------------------- declined to-dos (addition F06)

/**
 * The answer that declines a to-do ("Can't do this…", todos.decline): exactly these keys. The dropped to-do keeps it as `result.answer`.
 */
export interface DeclineAnswer {
  declined: true;
  reason?: string; // one line, why the person cannot or will not do it
}
