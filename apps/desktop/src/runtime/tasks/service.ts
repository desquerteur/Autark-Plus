// TaskService ("simplified Asana"): one task model – work is a task, a piece is a child task, the person's work is a
// task owned by 'human' (or a colleague's per_… id). Tasks are rows of their own (a chat is only where one was handed
// over – its anchoring 'task' message). Four stored states: open, waiting, done, dropped; "working" is a live run on it
// (TaskView.running). Writes: create (tasks/create.ts), update (fields, a wait set or ended, the plan and facts),
// give (tasks/give.ts), finish (done or dropped, with a result), pause / resume (the person's Stop), remove. Every write
// that changes when a task needs a look plans it (Task.nextAt, tasks/next.ts); the watcher fires it (tasks/watch.ts).
// Side effects (who hears, lines, verification, dependencies) live in tasks/lifecycle.ts; human widget flows in
// tasks/human.ts (arming: tasks/timers.ts); owner moves (archived agents, pause) in tasks/owners.ts.
// Owns: every write to `tasks`/`tasks_fts` and the task events.
// Never: shows unverified work as verified, stores "working", or keeps a second copy of the task text outside its row.

import { HUMAN_ID } from '../../shared/ids.ts';
import { WorkforceError } from '../../shared/errors.ts';
import type { UiBlock } from '../../shared/blocks/catalog.ts';
import type { Message, StatusLine } from '../../shared/model/chat.ts';
import { isFinished, isPaused, type CreateTaskInput, type Task, type TaskFilter, type TaskResult, type TaskView, type TaskWait } from '../../shared/model/tasks.ts';
import type { RuntimeServices, TaskService } from '../contracts.ts';
import { ActivityTracker } from '../chat/activity.ts';
import { chatTitleFor } from '../chat/titles.ts';
import { TaskRepo } from './repo.ts';
import { HumanTodos } from './human.ts';
import { handOver, onPersonLine, pauseTask, resumeTask } from './owners.ts';
import { TaskLifecycle } from './lifecycle.ts';
import { armTimer, dueAfter, prepareWidget } from './timers.ts';
import { createTask, type CreateOptions } from './create.ts';
import { taskViews } from './views.ts';
import { isHumanActor, isPersonId } from '../../shared/model/people.ts';
import { DAY_PATCH_FIELDS, type DayPatchField } from './patch-fields.ts';
import { applyDepends, checkDepends } from './depends.ts';
import { answerByReply } from './reply-answer.ts';
import { askedRoute, giveTask, nameOf, pickOwner, receiverOf, type GiveInput } from './give.ts';
import { nextLook } from './next.ts';
import type { Effort } from '../../shared/model/providers.ts';
import { setTaskRoute } from '../agents/next-route.ts';
import '../contracts/people.ts';

export type TaskDeps = Pick<RuntimeServices, 'db' | 'bus' | 'clock' | 'chats' | 'wakes'>
  & Partial<Pick<RuntimeServices, 'org' | 'subconscious' | 'scheduler' | 'notifications' | 'log' | 'dispatcher' | 'catalog' | 'people' | 'settings' | 'decisions'>>;

/** A wait as a caller gives it (since is set here). */
export type WaitInput = Omit<TaskWait, 'since'>;

/** What update() takes: the fields, a wait (status 'waiting' + waitingOn) or its end (status 'open'), the plan and a fact. */
export type TaskPatch = Partial<Pick<Task, 'title' | 'notes' | 'dueAt' | 'priority' | 'doneWhen' | 'sort' | 'widget' | 'dependsOn' | 'status'>>
  & Partial<Pick<Task, DayPatchField>> & { waitingOn?: WaitInput; plan?: string[]; fact?: string; facts?: string[]; doneCount?: number };

/** What finish() takes. */
export interface FinishInput {
  status: 'done' | 'dropped';
  summary: string;
  evidence?: TaskResult['evidence'];
  alsoHandled?: string[];
  followUps?: TaskResult['followUps'];
  quiet?: boolean;
  answer?: unknown;
}

const FIELDS = new Set<string>(['title', 'notes', 'dueAt', 'priority', 'doneWhen', 'sort', 'widget', ...DAY_PATCH_FIELDS]);

export class TaskServiceImpl implements TaskService {
  readonly s: TaskDeps;
  readonly repo: TaskRepo;
  private readonly activity: ActivityTracker;
  private readonly human: HumanTodos;
  readonly life: TaskLifecycle; // read by tasks/create.ts
  private readonly offs: Array<() => void>;

  constructor(deps: TaskDeps) {
    this.s = deps;
    this.repo = new TaskRepo(deps.db);
    this.activity = new ActivityTracker(deps.bus, ({ tasks }) => {
      for (const id of tasks) { const task = this.repo.get(id); if (task) this.emit(task); } // "Working" follows the live run
    });
    this.human = new HumanTodos(this);
    this.life = new TaskLifecycle(this);
    this.offs = [
      deps.bus.on('agent.removed', ({ id }) => handOver(this, id)),
      deps.bus.on('message.created', message => onPersonLine(this, message)),
      deps.bus.on('message.created', message => answerByReply(this, message)), // a typed reply answers the ask it replies to
    ];
  }

  // ------------------------------------------------------------- queries

  list(filter: TaskFilter = {}): TaskView[] { return this.views(this.repo.list(filter)); }
  todos(limit = 50, personId?: string): TaskView[] { return this.views(this.repo.todos(limit, personId)); }
  openFor(agentId: string): TaskView[] { return this.views(this.repo.openFor(agentId)); }

  get(id: string): TaskView | undefined {
    const task = this.repo.get(id);
    return task ? this.views([task])[0] : undefined;
  }

  // ------------------------------------------------------------- writes

  create(input: CreateTaskInput & { createdBy: string }, options: CreateOptions = {}): TaskView {
    return createTask(this, input, options);
  }

  /**
   * New work for `to` ("me", "team", an agent, the person or a colleague by id): "team" picks one owner now (`team`
   * narrows it to that team's agents); `route` is what the work needs from its first turn on.
   */
  async createTo(input: Omit<CreateTaskInput, 'assigneeKind' | 'assigneeId'> & { createdBy: string }, to: string, options: CreateOptions & { team?: string; route?: GiveInput['route'] } = {}): Promise<TaskView> {
    let receiver = receiverOf(to, input.createdBy);
    if (receiver.kind === 'team') receiver = await pickOwner(this, { title: input.title, notes: input.notes ?? '', spaceId: input.spaceId }, input.createdBy, options.team);
    const owner = receiver.kind === 'agent' ? { assigneeKind: 'agent' as const, assigneeId: receiver.id } : { assigneeKind: 'human' as const, ...(receiver.kind === 'human' && receiver.id ? { assigneeId: receiver.id } : {}) };
    const view = this.create({ ...input, ...owner }, options);
    if (receiver.kind === 'agent' && options.route) setTaskRoute(this.s.db, receiver.id, view.id, { ...options.route, reason: `given by ${nameOf(this.s, input.createdBy)}`, at: this.s.clock.now() });
    return view;
  }

  /**
   * Changes fields; status 'waiting' with waitingOn sets (or refreshes) a wait, status 'open' ends it (a pause too) – and
   * a person's 'open' on finished work reopens it. `plan` replaces the plan, `fact` adds one line; both count as a move.
   */
  update(id: string, patch: TaskPatch, by: string, rev?: number): TaskView {
    const current = this.require(id);
    if (patch.widget && current.assigneeKind === 'human') {
      const armed = prepareWidget(patch.widget, this.s.clock.now(), by);
      const due = patch.dueAt === undefined ? dueAfter(current, armed) : undefined; // the old timer's due time moves with the new one
      patch = { ...patch, widget: armed.widget, ...(due !== undefined && due !== current.dueAt ? { dueAt: due } : {}) };
    }
    if (patch.status === 'open' && isPaused(current)) return this.resume(id, by);
    if (patch.status !== undefined && isFinished(current.status)) {
      if (patch.status !== 'open' || !isHumanActor(by)) throw new WorkforceError('conflict', 'This task is finished; new work is a new task (tasks.create).', { details: { taskId: id } });
    }
    if (patch.status === 'waiting' && !patch.waitingOn && current.status !== 'waiting') throw new WorkforceError('bad_request', 'A wait says what it waits on (waitingOn).');
    const after = patch.dependsOn ? checkDepends(this.repo, id, current.parentId, patch.dependsOn) : undefined;
    const now = this.s.clock.now();
    const task = this.mutate(id, draft => {
      const fields = draft as unknown as Record<string, unknown>;
      for (const key of Object.keys(patch)) if (FIELDS.has(key)) fields[key] = (patch as Record<string, unknown>)[key];
      let moved = false;
      if (patch.plan !== undefined) { draft.ledger = { ...draft.ledger, plan: patch.plan.map((line) => line.trim()).filter(Boolean).slice(0, 20) }; moved = true; }
      if (patch.fact?.trim()) {
        const fact = patch.fact.trim();
        draft.ledger = { ...draft.ledger, facts: [...(draft.ledger.facts ?? []).filter((item) => item !== fact), fact].slice(-20) };
        moved = true;
      }
      if (patch.facts !== undefined) draft.ledger = { ...draft.ledger, facts: patch.facts.slice(-20) }; // a runtime caller's whole list (a routine's one skip note)
      if (patch.doneCount !== undefined) draft.ledger = { ...draft.ledger, doneCount: patch.doneCount };
      if (patch.status === 'waiting') {
        const wait = patch.waitingOn ?? current.waitingOn!;
        const same = current.status === 'waiting' && current.waitingOn?.on === wait.on && current.waitingOn.who === wait.who;
        draft.status = 'waiting';
        draft.waitingOn = { ...wait, since: same ? current.waitingOn!.since : now }; // a refreshed wait keeps when it began
        moved = true;
      } else if (patch.status === 'open' && current.status !== 'open') {
        draft.status = 'open';
        delete draft.waitingOn;
        delete draft.completedAt;
        if (isFinished(current.status)) draft.ledger = { ...draft.ledger, facts: [...(draft.ledger.facts ?? []), `Reopened by ${nameOf(this.s, by)}.`].slice(-20) };
        moved = true;
      } else if (patch.waitingOn && draft.status === 'waiting') {
        draft.waitingOn = { ...patch.waitingOn, since: draft.waitingOn?.since ?? now };
      }
      if (after) applyDepends(this.repo, draft, after, now);
      if (moved) draft.ledger = { ...draft.ledger, movedAt: now, stalls: 0 };
      if (moved || after || patch.dueAt !== undefined || Object.hasOwn(patch, 'dueAt') || patch.status !== undefined) draft.nextAt = nextLook(draft, now, this.openPieces(draft));
    }, rev);
    if (patch.widget) armTimer(this.s, task);
    const view = this.emit(task);
    this.life.changed(current, task, by);
    return view;
  }

  /** Gives task `id` to `to` ("me", "team", an agent, the person or a colleague by id); "team" picks one owner now. */
  async give(id: string, to: string, by: string, input: { note?: string; model?: string; effort?: Effort; from?: string; fact?: string; givenIn?: string } = {}): Promise<TaskView> {
    const task = this.require(id);
    const route = this.s.catalog ? askedRoute(this.s as Pick<RuntimeServices, 'catalog'>, input) : undefined;
    let receiver = receiverOf(to, by);
    if (receiver.kind === 'team') receiver = await pickOwner(this, task, by);
    const give: GiveInput = { ...(input.note ? { note: input.note } : {}), ...(route ? { route } : {}), ...(input.fact ? { fact: input.fact } : {}), ...(input.givenIn ? { givenIn: input.givenIn } : {}) };
    return giveTask(this, id, receiver, by, give);
  }

  /** Ends a task: done with what came out, or dropped with why. A finished task comes back as it is. */
  finish(id: string, input: FinishInput, by: string): TaskView {
    const before = this.require(id);
    if (isFinished(before.status)) return this.views([before])[0];
    if (!input.summary?.trim()) throw new WorkforceError('bad_request', 'Finishing a task needs a summary.');
    const human = isHumanActor(by);
    const summary = input.status === 'dropped' && by !== before.assigneeId && by !== HUMAN_ID ? `Dropped by ${nameOf(this.s, by)}: ${input.summary.trim()}` : input.summary.trim();
    const now = this.s.clock.now();
    const task = this.mutate(id, draft => {
      draft.status = input.status;
      draft.result = {
        summary, evidence: input.evidence ?? [], verification: human ? 'reported_by_human' : 'claimed_by_agent',
        ...(input.alsoHandled?.length ? { alsoHandled: input.alsoHandled } : {}), ...(input.followUps?.length ? { followUps: input.followUps } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}), ...(input.quiet ? { quiet: true as const } : {}),
      };
      draft.completedAt = now;
      delete draft.waitingOn;
      delete draft.nextAt;
    });
    const view = this.emit(task);
    this.life.finished(task, by);
    return view;
  }

  /** The person's Stop: the task waits on them ("Paused by you") until they or its owner move it on. */
  pause(id: string, by: string): TaskView {
    const task = pauseTask(this, id, by);
    return task ? this.emit(task) : this.views([this.require(id)])[0];
  }

  /** Ends a pause: the task is open again and its owner goes on (its look is now). */
  resume(id: string, by: string): TaskView {
    const task = resumeTask(this, id, by);
    return this.emit(task ?? this.require(id));
  }

  remove(id: string, by: string): void {
    const task = this.require(id);
    const parts = this.partsOf(id); // its pieces go with it (ON DELETE CASCADE)
    this.repo.delete(id);
    this.life.removed(task, by, parts);
    this.s.bus.emit('task.removed', { id, ...(task.conversationId ? { conversationId: task.conversationId } : {}) });
    if (task.parentId) { const parent = this.repo.get(task.parentId); if (parent) this.emit(parent); }
  }

  // ------------------------------------------------------------- human flows (tasks/human.ts)

  ingestBlocks(message: Message, blocks: UiBlock[], indexes?: number[]): TaskView[] { return this.human.ingestBlocks(message, blocks, indexes); }
  answer(input: Parameters<TaskService['answer']>[0]): TaskView | undefined { return this.human.answer(input); }
  addTodo(text: string, conversationId?: string): Promise<TaskView> { return this.human.addTodo(text, conversationId); }
  changeWidget(id: string, type: string): TaskView { return this.human.changeWidget(id, type); }
  snooze(ref: string | { messageId: string; blockIndex: number }, until: number): TaskView { return this.human.snooze(ref, until); }
  stopRepeating(id: string, by: string): TaskView { return this.human.stopRepeating(id, by); }

  // ------------------------------------------------------------- shared internals

  require(id: string): Task {
    const task = this.repo.get(id);
    if (!task) throw new WorkforceError('not_found', 'Task not found.', { details: { taskId: id } });
    return task;
  }

  /** Load → change → save with rev check. Throws `conflict` when someone else wrote first. */
  mutate(id: string, change: (draft: Task) => void, expectedRev?: number): Task {
    const current = this.require(id);
    if (expectedRev !== undefined && expectedRev !== current.rev) {
      throw new WorkforceError('conflict', 'The task changed meanwhile. Reload and try again.', { details: { taskId: id, rev: current.rev } });
    }
    const draft: Task = structuredClone(current);
    change(draft);
    draft.rev = current.rev + 1;
    draft.updatedAt = this.s.clock.now();
    if (!this.repo.save(draft, current.rev)) {
      throw new WorkforceError('conflict', 'The task changed meanwhile. Reload and try again.', { details: { taskId: id } });
    }
    return draft;
  }

  emit(task: Task): TaskView {
    const view = this.views([task])[0];
    this.s.bus.emit('task.upserted', view);
    return view;
  }

  /** True while a turn runs on this task (the live activity) – with `agentId`, a turn of that agent. */
  isRunning(id: string, agentId?: string): boolean { return this.activity.running(id, agentId); }

  /** True while any agent runs a turn in this chat. */
  chatRunning(conversationId: string): boolean { return this.activity.working(conversationId).length > 0; }

  /** Unfinished pieces of the task that someone other than its owner holds (their end wakes its owner). */
  openPieces(task: Pick<Task, 'id' | 'assigneeId'>): boolean {
    return this.repo.children(task.id).some((piece) => !isFinished(piece.status) && piece.assigneeId !== task.assigneeId);
  }

  /** Pieces, progress, chat title and whether a turn runs on it (tasks/views.ts). */
  views(tasks: Task[]): TaskView[] {
    return taskViews(this.repo, (conversationId?: string) => conversationId ? chatTitleFor(this.s, conversationId, HUMAN_ID) : '', id => this.activity.running(id), tasks);
  }

  /** Every task under `id` (its pieces and theirs), breadth first, at most 500. */
  private partsOf(id: string): Task[] {
    const out: Task[] = [];
    const seen = new Set([id]);
    for (const queue = [id]; queue.length && out.length < 500;) {
      for (const part of this.repo.children(queue.shift()!)) {
        if (!seen.has(part.id)) { seen.add(part.id); out.push(part); queue.push(part.id); }
      }
    }
    return out;
  }

  /** Quiet status line about a task in its handover chat (a chat-free task writes none – its ledger and runs are its history). */
  line(task: Task, line: StatusLine, by: string): void {
    if (!task.conversationId) return;
    try {
      this.s.chats.status(task.conversationId, line, { authorId: by, taskId: task.parentId ?? task.id });
    } catch (error) {
      this.s.log?.warn('task status line failed', { taskId: task.id, error: String(error) });
    }
  }

  nameOf(id: string): string {
    if (isPersonId(id)) return this.s.people?.nameOf(id) ?? 'Former colleague';
    return id === HUMAN_ID ? 'You' : this.s.org?.get(id)?.name ?? id;
  }

  dispose(): void {
    this.activity.dispose();
    for (const off of this.offs) off();
  }
}
