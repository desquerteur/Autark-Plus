// What the person gave others (My day "Given by me"): the top-level tasks the member gave (assigned, else created) that
// someone else owns – an agent or a colleague – open, plus those done since last evening (default; the end of working
// hours of the day before), each with its pieces – for the owner never in a chat that became the people's own
// (people/access.ts chatHiddenFromOwner). Handing an own to-do on is tasks.give (tasks/give.ts).
// Owns: that read. Never: writes.

import { HUMAN_ID } from '../../shared/ids.ts';
import { UNFINISHED, type TaskView } from '../../shared/model/tasks.ts';
import type { RuntimeServices } from '../contracts.ts';
import '../contracts/calendar.ts';
import { dayZone, daySettings, lastEvening } from './clock.ts';

/** Work `ownerId` gave that someone else owns (an agent, a colleague) – a top-level task. */
export function isHandedOff(task: TaskView, ownerId: string): boolean {
  if ((task.assignedBy ?? task.createdBy) !== ownerId || task.parentId) return false;
  const mine = task.assigneeKind === 'human' && (ownerId === HUMAN_ID ? task.assigneeId === undefined || task.assigneeId === HUMAN_ID : task.assigneeId === ownerId);
  return !mine;
}

export function handedOff(s: Pick<RuntimeServices, 'tasks' | 'clock' | 'settings' | 'chats'>, ownerId: string, since?: number): TaskView[] {
  const from = since ?? lastEvening(s.clock.now(), dayZone(s), daySettings(s).workEnd);
  const open = s.tasks.list({ status: [...UNFINISHED], limit: 1000 }).filter((task) => isHandedOff(task, ownerId));
  const done = s.tasks.list({ completedSince: from, limit: 200 }).filter((task) => task.status === 'done' && isHandedOff(task, ownerId));
  return [...open, ...done];
}
