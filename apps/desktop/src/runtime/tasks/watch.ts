// The watcher: every unfinished task has one planned look (Task.nextAt, tasks/next.ts) and this is what comes when it is
// due. A pass (at start, hourly, at the earliest planned look, and when a task row arrives or changes with a look due –
// a row from another PC too) walks the tasks whose look is due or missing, where their owner lives:
//  - a row without an owner (an older PC's "team" row) gets one now (tasks/give.ts pickOwner);
//  - an archived agent's work goes to its successor (tasks/owners.ts handOver);
//  - nothing planned (a row from before the rebuild) → its look is planned now;
//  - a wait whose until passed opens the task;
//  - an agent's due look wakes it under the one key task:<id> with a note in its voice (stuck, due, going on …) and sets
//    the look forward by the retry pause, so a wake that ends without a turn on it is not fired again at once;
//  - a person's work: a due time reached pushes them once; stuck work an agent gave them wakes that agent;
//    the person's own to-dos get nothing beyond their due time.
// It also follows each turn of an owner on its task (afterTurn: tasks/next.ts lookAfterTurn; a person's Stop pauses
// it) and brings outage retries forward when an account or model comes back. At start (recover) it converts rows an
// older PC sent, makes one pass, and wakes the chats whose turn was cut off.
// Where: an agent's tasks on the PC it runs on (devices/sync/home.ts); a person's on the CEO PC with the smallest id,
// never on a PC that joined as an employee.
// Owns: those passes and the timer. Never: calls a model (except the owner pick), writes "working", or wakes a paused task.

import { HUMAN_ID, SYSTEM_ID } from '../../shared/ids.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import { isFinished, isPaused, type Task } from '../../shared/model/tasks.ts';
import { STUCK_MS, movedAt, stuckOf } from '../../shared/model/task-stuck.ts';
import type { OwnershipService, RuntimeServices } from '../contracts.ts';
import type { TaskServiceImpl } from './service.ts';
import { OutageTracker, onlineDeliveryAt } from '../agents/outages.ts';
import { firesHere, homeElsewhere, links } from '../devices/sync/home.ts';
import { DueTimer, REAL_DUE_TIMERS } from '../people/due-timer.ts';
import type { Timers } from '../people/join.ts';
import { INTERRUPTED_NOTE, installReceipt, wakeInstaller } from './recover-notes.ts';
import { OUTAGE_MAX_MS, giverOf, lookAfterTurn, lookOf, namesFor, nextLook, noteOf, stallDelay, wakeReason, type TurnInput } from './next.ts';
import { giveTask, nameOf, pickOwner, tell } from './give.ts';
import { handOver } from './owners.ts';
import { convertTaskRows } from '../bridge/kontext-1311.ts';
import { dueText, profileZone } from '../context/time.ts';
import { isHumanActor } from '../../shared/model/people.ts';

const HOUR_MS = 3600_000;

export type WatchDeps = Pick<RuntimeServices, 'tasks' | 'wakes' | 'chats' | 'clock' | 'db' | 'bus' | 'org' | 'settings'>
  & Partial<Pick<RuntimeServices, 'log' | 'accounts' | 'catalog' | 'host' | 'runs' | 'splits' | 'paths' | 'notifications' | 'people'>>;

export class TaskWatcher implements OwnershipService {
  private readonly s: WatchDeps;
  private readonly timer: DueTimer;
  private offs: Array<() => void> = [];
  private passing = false;
  private armedAt: number | undefined;
  private routing = new Set<string>();

  constructor(deps: WatchDeps, timers: Timers = REAL_DUE_TIMERS) {
    this.s = deps;
    this.timer = new DueTimer(timers, () => deps.clock.now(), () => { this.armedAt = undefined; this.pass(); });
  }

  private get t(): TaskServiceImpl { return this.s.tasks as unknown as TaskServiceImpl; }

  // ------------------------------------------------------------- the follow-up of a turn

  afterTurn(input: TurnInput): void {
    const task = this.t.repo.get(input.taskId);
    if (!task || isFinished(task.status) || task.assigneeKind !== 'agent' || task.assigneeId !== input.agentId) return; // another agent's turn plans nothing
    if (input.outcome === 'stopped') { this.t.pause(task.id, HUMAN_ID); return; }
    if (isPaused(task)) return;
    const now = this.s.clock.now();
    const { at, ledger } = lookAfterTurn(task, input, now, { splits: this.splitsAtWork(task), pieces: this.t.openPieces(task) });
    this.t.emit(this.t.mutate(task.id, (draft) => { draft.ledger = ledger; draft.nextAt = at; }));
    if (input.outcome === 'interrupted') tell(this.s, task.assigneeId!, { reason: 'retry', taskId: task.id, conversationId: task.conversationId, note: INTERRUPTED_NOTE });
    this.arm(at);
  }

  // ------------------------------------------------------------- start

  /** At start: older rows converted, one pass, the cut-off chat turns woken; returns how many tasks go on now. */
  recover(input: { interruptedRuns?: readonly string[] } = {}): number {
    try { convertTaskRows(this.s.db); } catch (error) { this.s.log?.warn('converting older task rows failed', { error: String(error) }); }
    const now = this.s.clock.now();
    const cut = new Set<string>();
    for (const runId of input.interruptedRuns ?? []) {
      const run = this.s.runs?.get(runId);
      if (!run) continue;
      if (run.taskId) { cut.add(run.taskId); continue; }
      if (run.conversationId && this.active(run.agentId)) {
        this.s.wakes.wake({ agentId: run.agentId, reason: 'retry', conversationId: run.conversationId, dueAt: now, note: INTERRUPTED_NOTE, coalesceKey: `recover:${run.conversationId}` });
      }
    }
    for (const id of cut) {
      const task = this.t.repo.get(id);
      if (task && !isFinished(task.status) && !isPaused(task) && task.assigneeKind === 'agent' && task.assigneeId && this.watchesHere(task)) {
        this.t.repo.setNext(id, now);
        tell(this.s, task.assigneeId, { reason: 'retry', taskId: id, conversationId: task.conversationId, note: INTERRUPTED_NOTE });
      }
    }
    for (const task of this.t.repo.unplannedOfPeople()) this.t.repo.setNext(task.id, nextLook(task, now)); // a person's rows from before
    const continued = this.pass();
    let receipt: ReturnType<typeof installReceipt>;
    try { receipt = installReceipt(this.s); } catch (error) { this.s.log?.warn('install receipt not read', { error: String(error) }); }
    if (receipt) wakeInstaller(this.s, receipt);
    return continued;
  }

  /** The hourly pass, the timer, rows that change or arrive, and the end of outages. Idempotent; returns the stop. */
  start(): () => void {
    if (this.offs.length) return () => this.stop();
    const { bus } = this.s;
    const hourly = setInterval(() => this.pass(), HOUR_MS);
    (hourly as { unref?: () => void }).unref?.();
    const tracker = new OutageTracker(this.accounts(), this.s.catalog?.list() ?? [], this.s.clock.now());
    this.offs = [
      () => clearInterval(hourly),
      bus.on('task.upserted', (task) => { // a look planned here or on another PC; an agent's row without one gets it now
        if (isFinished(task.status)) return;
        if (task.nextAt !== undefined) this.arm(task.nextAt);
        else if (task.assigneeKind !== 'human' && !isPaused(task)) this.arm(this.s.clock.now());
      }),
      bus.on('account.upserted', (account) => { if (tracker.account(account, this.s.clock.now())) this.outagesEnded(); }),
      bus.on('account.removed', ({ id }) => tracker.removed(id)),
      bus.on('models.updated', (list) => { if (tracker.models(list)) this.outagesEnded(); }),
    ];
    try { if (this.s.host) this.offs.push(this.s.host.onPower((event) => { if (event === 'online') this.outagesEnded(onlineDeliveryAt(this.accounts(), this.s.clock.now())); })); } catch { /* a host without power events */ }
    this.arm(this.t.repo.nextLookAfter(this.s.clock.now()));
    return () => this.stop();
  }

  stop(): void {
    for (const off of this.offs.splice(0)) off();
    this.timer.stop();
    this.armedAt = undefined;
  }

  // ------------------------------------------------------------- the pass

  /** One pass over the due and missing looks here; returns how many agent tasks were woken. */
  pass(): number {
    if (this.passing) return 0;
    this.passing = true;
    let woken = 0;
    const now = this.s.clock.now();
    try {
      convertTaskRows(this.s.db); // rows an older PC sent since
      for (const task of this.t.repo.dueLooks(now)) {
        try { if (this.look(task, now)) woken++; } catch (error) { this.s.log?.warn('task look failed', { taskId: task.id, error: String(error) }); }
      }
    } catch (error) {
      this.s.log?.warn('task watcher pass failed', { error: String(error) });
    } finally {
      this.passing = false;
    }
    this.timer.stop();
    this.armedAt = undefined;
    this.arm(this.t.repo.nextLookAfter(now));
    return woken;
  }

  /** One task whose look is due or missing (see the header); true when its agent owner was woken. */
  private look(task: Task, now: number): boolean {
    if (!this.watchesHere(task) || isPaused(task)) return false;
    if (task.assigneeKind === 'team') { this.route(task); return false; }
    if (task.assigneeKind === 'agent' && task.assigneeId && !this.active(task.assigneeId)) {
      this.t.repo.setNext(task.id, now + HOUR_MS); // an owner this PC does not know yet is looked at again later
      handOver(this.t, task.assigneeId);
      return false;
    }
    if (task.nextAt === undefined) { // nothing planned (a row from before): plan it now
      const at = nextLook(task, now, this.t.openPieces(task));
      this.t.repo.setNext(task.id, at);
      if (at === undefined || at > now) return false;
      task = { ...task, nextAt: at };
    }
    const why = lookOf(task, now);
    if (why === 'wait-ends') task = this.open(task, now);
    if (task.assigneeKind === 'human') { this.personLook(task, why, now); return false; }
    const owner = task.assigneeId!;
    if (this.t.isRunning(task.id, owner)) return false; // its turn plans the next look
    const forward = now + stallDelay((task.ledger.stalls ?? 0) + 1);
    this.t.repo.setNext(task.id, forward);
    if (this.s.wakes.list(owner).some((wake) => wake.claimedAt === undefined && wake.taskId === task.id)) return false; // already on its way
    const note = noteOf(task, why, now, namesFor(this.s, profileZone(this.s)));
    tell(this.s, owner, { reason: wakeReason(why), taskId: task.id, conversationId: task.conversationId, note });
    return true;
  }

  /** A person's work: their due time pushes once; stuck work an agent gave them wakes that agent; their own to-do waits. */
  private personLook(task: Task, why: ReturnType<typeof lookOf>, now: number): void {
    const person = task.assigneeId ?? HUMAN_ID;
    const giver = giverOf(task);
    const byAgent = !isHumanActor(giver) && giver !== SYSTEM_ID;
    if (why === 'due' && task.widget?.type !== 'timer') { // a timer to-do rings by itself
      tell(this.s, person, { kind: 'todo', title: `Due: ${excerpt(task.title, 80)}`, body: excerpt(task.notes, 160), taskId: task.id, conversationId: task.conversationId });
    } else if (byAgent && stuckOf(task, now) && this.active(giver)) {
      // the giver's turn runs where its work lives: its own parent task, else the chat it gave from (never the person's task)
      const parent = task.parentId ? this.t.repo.get(task.parentId) : undefined;
      const onParent = parent && parent.assigneeKind === 'agent' && parent.assigneeId === giver && !isFinished(parent.status) ? parent : undefined;
      tell(this.s, giver, {
        reason: 'retry', key: `given:${task.id}`,
        ...(onParent ? { taskId: onParent.id, conversationId: onParent.conversationId } : { conversationId: task.ledger.givenIn ?? task.conversationId }),
        note: `"${excerpt(task.title, 120)}", which I gave ${nameOf(this.s, person)}, has not moved since ${dueText(movedAt(task), profileZone(this.s), now)}.`,
      });
    }
    const at = nextLook(task, now);
    this.t.repo.setNext(task.id, at !== undefined && at > now ? at : byAgent ? now + STUCK_MS : undefined);
  }

  /** A wait whose until passed: the task is open again. */
  private open(task: Task, now: number): Task {
    const opened = this.t.mutate(task.id, (draft) => {
      draft.status = 'open';
      delete draft.waitingOn;
      draft.ledger = { ...draft.ledger, movedAt: now };
    });
    this.t.emit(opened);
    return opened;
  }

  /** An older PC's row without an owner: one owner now (once at a time). */
  private route(task: Task): void {
    if (this.routing.has(task.id)) return;
    this.routing.add(task.id);
    this.t.repo.setNext(task.id, this.s.clock.now() + HOUR_MS);
    void pickOwner(this.t, task, SYSTEM_ID)
      .then((to) => { const fresh = this.t.repo.get(task.id); if (fresh?.assigneeKind === 'team' && !isFinished(fresh.status)) giveTask(this.t, task.id, to, SYSTEM_ID); })
      .catch((error: unknown) => this.s.log?.warn('giving an ownerless task an owner failed', { taskId: task.id, error: String(error) }))
      .finally(() => this.routing.delete(task.id));
  }

  // ------------------------------------------------------------- helpers

  /** Arms the timer for `at` when it is earlier than the one armed. */
  private arm(at: number | undefined): void {
    if (at === undefined) return;
    if (this.armedAt !== undefined && this.armedAt <= at) return;
    this.armedAt = Math.max(at, this.s.clock.now());
    this.timer.arm(this.armedAt);
  }

  /** An account or a model came back (or the host is online): open agent work retrying within the outage pause goes at `at`. */
  private outagesEnded(at = this.s.clock.now()): void {
    this.s.db.run(
      `UPDATE tasks SET next_at = ? WHERE status = 'open' AND assignee_kind = 'agent' AND next_at > ? AND next_at <= ?`,
      [at, at, at + OUTAGE_MAX_MS]);
    this.arm(at);
  }

  /** Where the task's owner lives: an agent where it runs, a person's work on the CEO PC with the smallest id. */
  private watchesHere(task: Task): boolean {
    if (task.assigneeKind === 'agent' && task.assigneeId) return !homeElsewhere(this.s, task.assigneeId);
    try {
      if (links(this.s.db).some(({ link }) => link.kind === 'employer')) return false;
      return firesHere(this.s, HUMAN_ID);
    } catch { return true; }
  }

  private active(agentId: string): boolean {
    const agent = this.s.org.get(agentId);
    return agent !== undefined && agent.archivedAt === undefined;
  }

  private splitsAtWork(task: Task): boolean {
    try {
      return (this.s.splits?.list({ agentId: task.assigneeId!, active: true }) ?? []).some((group) => group.taskId === task.id && group.status !== 'stopped' && group.status !== 'gathered');
    } catch { return false; }
  }

  private accounts() {
    try { return this.s.accounts?.list() ?? []; } catch { return []; }
  }
}
