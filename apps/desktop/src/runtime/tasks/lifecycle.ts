// Who hears of a task change (the TaskService writes the rows, this decides the rest):
// - created: its owner hears at once ("<giver> gave me …", tasks/give.ts tellGiven) – a person by a notification or push;
// - changed: a quiet status line for a wait, a reopen; an agent owner hears when someone else opened its work again;
// - finished (done or dropped): a quiet line (none for an answered or withdrawn ask), queued wakes and a running turn
//   end, a to-do stops ringing, its open asks and its owner's own pieces end with it, whoever gave it hears how it ended
//   ("I had asked: …"; the person by a notification, a colleague by a push – nobody when it ends quietly), the owner of
//   its parent hears the piece ended, what waits on it goes on (tasks/depends.ts), the one verification step runs;
// - removed: wakes, schedules and mini-app takes go; the anchor message becomes a tombstone line.
// An answered or declined ask ends quietly: the person's own line in the chat says it (answer-receipt.ts).
// Owns: wakes, notifications and status lines that follow a task change.
// Never: shows unchecked work as verified, wakes the one who made the change, or wakes archived agents.

import { HUMAN_ID, SYSTEM_ID } from '../../shared/ids.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import type { StatusLine } from '../../shared/model/chat.ts';
import { isFinished, type Task } from '../../shared/model/tasks.ts';
import { isHumanActor, isPersonId } from '../../shared/model/people.ts';
import type { TaskServiceImpl } from './service.ts';
import { stopRuns } from './owners.ts';
import { dropTimers } from './timers.ts';
import { releaseAppFiles } from './app-files.ts';
import { TaskVerification } from './verification.ts';
import { waitsEnded } from './depends.ts';
import { nameOf, tell, tellGiven } from './give.ts';
import { giverOf } from './next.ts';
import { endNote, endWaitOn, pieceEnded } from './transitions.ts';

export { uncheckedNote } from './verification.ts';

export class TaskLifecycle {
  private readonly t: TaskServiceImpl;
  private readonly verification: TaskVerification;
  constructor(tasks: TaskServiceImpl) { this.t = tasks; this.verification = new TaskVerification(tasks); }

  created(task: Task): void {
    tellGiven(this.t, task, task.createdBy);
  }

  /** After update(): the status line of a wait or a reopen; an agent owner hears when someone else opened its work. */
  changed(before: Task, task: Task, by: string): void {
    if (before.status === task.status && before.waitingOn?.why === task.waitingOn?.why) return;
    if (!task.parentId && !withdrawnAsk(task, by)) {
      const text = task.status === 'waiting' ? `Waiting: ${excerpt(task.title, 60)}${task.waitingOn ? ` · ${excerpt(task.waitingOn.why, 80)}` : ''}`
        : isFinished(before.status) ? `Reopened: ${excerpt(task.title, 60)}` : `Open again: ${excerpt(task.title, 60)}`;
      this.t.line(task, { type: 'note', text, details: { taskId: task.id, status: task.status } }, by);
    }
    const awaited = before.status === 'waiting' && before.waitingOn?.on === 'who' && before.waitingOn.who === by; // their own line reaches the owner
    if (task.status === 'open' && before.status !== 'open' && task.assigneeKind === 'agent' && task.assigneeId && by !== task.assigneeId && !awaited) {
      tell(this.t.s, task.assigneeId, { reason: 'task', taskId: task.id, conversationId: task.conversationId, note: `${nameOf(this.t.s, by)} ${isFinished(before.status) ? 'reopened' : 'opened'} my task "${excerpt(task.title, 120)}" again.` });
    }
  }

  /** Done or dropped (see the header). */
  finished(task: Task, by: string): void {
    const s = this.t.s;
    if (!task.parentId && !answeredTodo(task) && !withdrawnAsk(task, by)) {
      const done = task.status === 'done';
      runLine(this.t, task, { type: done ? 'task_done' : 'note', text: `${done ? 'Done' : 'Dropped'}: ${excerpt(task.title, 60)}`, details: { taskId: task.id, status: task.status, verification: task.result?.verification } }, by);
    }
    s.wakes.cancelTask(task.id, ['retry', 'review', 'task', 'handoff']);
    stopRuns(this.t, task, by);
    if (task.assigneeKind === 'human') {
      dropTimers(s, task.id, task.status === 'dropped'); // a dropped to-do never rings again; a done one keeps a repeat
      if (task.status === 'dropped') releaseAppFiles(s, task.widget, []);
    }
    this.endOpenParts(task);
    // an answered ask: the person's own line reaches whoever asked (answer-receipt.ts) – no second word
    const answered = answeredTodo(task);
    const told = !answered && pieceEnded(this.t, task, by);
    if (answered && task.parentId) endWaitOn(this.t, this.t.repo.get(task.parentId), task, by); // the asked person's answer ends the wait on them
    this.tellGiver(task, by, told ? this.parentOwner(task) : undefined);
    waitsEnded(this.t, task, task.status === 'dropped' ? 'dropped' : 'done', !answered);
    if (task.parentId) { const parent = this.t.repo.get(task.parentId); if (parent) this.t.emit(parent); }
    if (task.status === 'done') this.verification.start(task, by);
  }

  /** Whoever gave the work hears how it ended – not the one who ended it, not its owner, nobody for a quiet end. */
  private tellGiver(task: Task, by: string, alreadyTold?: string): void {
    const giver = giverOf(task);
    const owner = task.assigneeId ?? HUMAN_ID;
    if (task.result?.quiet || giver === by || giver === owner || giver === SYSTEM_ID || giver === alreadyTold) return;
    if (answeredTodo(task) && giver === task.createdBy) return; // the asker reads the person's own line
    const title = excerpt(task.title, 120);
    const word = task.status === 'done' ? 'done' : 'dropped';
    if (isHumanActor(giver)) {
      tell(this.t.s, isPersonId(giver) ? giver : HUMAN_ID, { kind: 'done', title: `${task.status === 'done' ? 'Done' : 'Dropped'}: ${excerpt(task.title, 80)}`, body: excerpt(task.result?.summary ?? '', 160), conversationId: task.conversationId, taskId: task.id });
      return;
    }
    // The giver's turn runs where its work lives: its own parent task, else the chat it gave from, else the task's chat
    // when it is in it, else the task itself.
    const parent = task.parentId ? this.t.repo.get(task.parentId) : undefined;
    const onParent = parent && parent.assigneeKind === 'agent' && parent.assigneeId === giver && !isFinished(parent.status) ? parent : undefined;
    const inChat = task.conversationId && this.t.s.chats.members(task.conversationId).some((member) => member.memberId === giver && !member.leftAt);
    const chat = task.ledger.givenIn ?? (inChat ? task.conversationId : undefined);
    const where = onParent ? { taskId: onParent.id, conversationId: onParent.conversationId } : chat ? { conversationId: chat } : { taskId: task.id };
    const lines = [`"${title}", which I gave ${nameOf(this.t.s, owner)}, is ${word}.`, ...endNote(task, true)];
    tell(this.t.s, giver, { reason: 'child', ...where, key: onParent ? `task:${onParent.id}` : `child:${task.id}`, note: lines.join('\n') });
  }

  private parentOwner(task: Task): string | undefined {
    return task.parentId ? this.t.repo.get(task.parentId)?.assigneeId : undefined;
  }

  /** Removed (with `parts`, the tasks under it, gone with it): nothing of them stays planned; the anchor message becomes a quiet tombstone line. */
  removed(task: Task, by: string, parts: Task[] = []): void {
    const s = this.t.s;
    for (const gone of [task, ...parts]) {
      this.verification.forget(gone.id);
      s.wakes.cancelTask(gone.id);
      for (const schedule of s.scheduler?.list({ taskId: gone.id }) ?? []) s.scheduler!.remove(schedule.id);
      releaseAppFiles(s, gone.widget, []); // a removed mini-app to-do's takes go to the clean-up
    }
    stopRuns(this.t, task, by);
    for (const gone of [task, ...parts]) waitsEnded(this.t, gone, 'removed');
    if (task.messageId && !task.parentId) {
      const anchor = s.chats.message(task.messageId);
      if (anchor?.kind === 'task') s.chats.removeMessage(task.messageId, SYSTEM_ID);
      if (anchor) this.t.line(task, { type: 'note', text: `Task removed: ${excerpt(task.title, 60)}`, details: { taskId: task.id } }, by);
    }
  }

  /** An agent's task that ended takes along the asks an agent made for it and its owner's own unfinished pieces (quietly). */
  private endOpenParts(task: Task): void {
    if (task.assigneeKind === 'human') return; // a to-do's own pieces are the person's
    for (const piece of this.t.repo.children(task.id)) {
      if (isFinished(piece.status) || !endsWithTask(task, piece)) continue;
      try { this.t.finish(piece.id, { status: 'dropped', summary: 'Its task ended', quiet: true }, SYSTEM_ID); } catch (error) {
        this.t.s.log?.warn('ending an open part of a finished task failed', { taskId: task.id, pieceId: piece.id, error: String(error) });
      }
    }
  }
}

/** The task line, with meta.fromRun when `by` has a turn running in the task's chat (never a split's) – else the plain line. */
function runLine(t: TaskServiceImpl, task: Task, line: StatusLine, by: string): void {
  let fromRun: string | undefined;
  try { fromRun = t.s.dispatcher?.activity().find((run) => run.agentId === by && run.conversationId === task.conversationId && !run.split)?.runId; } catch { /* no run known */ }
  if (!fromRun || !task.conversationId) { t.line(task, line, by); return; }
  try { t.s.chats.status(task.conversationId, line, { authorId: by, taskId: task.parentId ?? task.id, fromRun }); } catch (error) {
    t.s.log?.warn('task status line failed', { taskId: task.id, error: String(error) });
  }
}

/** A to-do the person answered through its widget or declined: their own line in the chat says it (answer-receipt.ts). */
function answeredTodo(task: Task): boolean {
  if (task.assigneeKind !== 'human' || task.result?.answer === undefined) return false;
  return task.widget !== undefined || task.status === 'dropped';
}

/** An ask the agent that made it ends itself – withdrawn, it leaves the person's list quietly. */
function withdrawnAsk(task: Task, by: string): boolean {
  return task.assigneeKind === 'human' && by === task.createdBy && !isHumanActor(by);
}

/** A part that ends with its task: an ask an agent made for it (not one a person took), or a piece its own owner holds. */
export function endsWithTask(task: Pick<Task, 'assigneeKind' | 'assigneeId'>, part: Pick<Task, 'assigneeKind' | 'assigneeId' | 'createdBy' | 'assignedBy'>): boolean {
  if (part.assigneeKind === 'human') return !isHumanActor(part.createdBy) && !isHumanActor(part.assignedBy ?? '');
  return part.assigneeKind === 'agent' && task.assigneeKind === 'agent' && Boolean(part.assigneeId) && part.assigneeId === task.assigneeId;
}
