// The one stuck rule, shared by the watcher (runtime/tasks/watch.ts) and the views (team activity, work board, My day):
// unfinished work on which nothing moved for two days is stuck – unless a planned time is still ahead (a wait's until,
// the due time). Work without an owner and paused work count too.
// Owns: that rule. Never: I/O or status changes.

import { PAUSED_REASON, isFinished, isPaused, type Task } from './tasks.ts';

export const STUCK_MS = 2 * 24 * 3600_000;

export interface Stuck { why: string; since: number }

type StuckTask = Pick<Task, 'assigneeKind' | 'status' | 'waitingOn' | 'ledger' | 'dueAt' | 'createdAt' | 'startedAt'>;

/** When the task last really moved (its ledger's movedAt, else when it was started or made). */
export function movedAt(task: Pick<Task, 'ledger' | 'startedAt' | 'createdAt'>): number {
  return task.ledger?.movedAt ?? task.startedAt ?? task.createdAt;
}

/** Why unfinished work is stuck, and since when (null: it is not). */
export function stuckOf(task: StuckTask, now: number): Stuck | null {
  if (isFinished(task.status)) return null;
  if (task.assigneeKind === 'team') return { why: 'No owner yet', since: task.createdAt };
  if (isPaused(task)) return { why: PAUSED_REASON, since: task.waitingOn!.since };
  if (task.waitingOn?.until !== undefined && task.waitingOn.until > now) return null;
  if (task.dueAt !== undefined && task.dueAt > now) return null;
  const since = Math.max(movedAt(task), task.waitingOn?.since ?? 0);
  if (now - since < STUCK_MS) return null;
  return { why: task.waitingOn?.why || 'Nothing moved', since };
}
