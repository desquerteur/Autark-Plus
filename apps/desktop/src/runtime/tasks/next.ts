// The one planned look of every unfinished task (Task.nextAt, column next_at) and what it says when it comes:
//  - nextLook: the look after a change outside its owner's own turn (created, given, reopened, a wait set, a piece or an
//    answer arrived, a repair): an agent's open work now; a wait at its until, else a day after it began (outside) or two
//    (on someone or tasks); open work with unfinished pieces of others two days after its last move (a piece's end wakes
//    it sooner); a person's work at its due time, else – given by an agent – two days after its last move; a due time
//    ahead comes first. A paused or finished task has none.
//  - afterTurn: the owner's turn on its task ended – a moved task goes on now, an unmoved one after a doubling pause
//    (1 min · 2^(stalls−1), at most a day), an outage after at most 30 min (or the route's retry-after), a wait as above
//    counted from this turn (the last look) when that is later than the wait's start,
//    work its split groups still do a day after its last move; a person's Stop pauses it.
//  - lookOf / noteOf: why a due look comes and the note in my voice the wake carries; wakeReason ranks it.
// Nothing else plans a task's wake: the watcher (tasks/watch.ts) fires every due look under the one key task:<id>.
// Owns: those rules and texts. Never: wakes anyone itself, or plans a look for a finished or paused task.

import { SYSTEM_ID, HUMAN_ID } from '../../shared/ids.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import type { WakeReason } from '../../shared/model/runs.ts';
import { isFinished, isPaused, type Task } from '../../shared/model/tasks.ts';
import { STUCK_MS, movedAt } from '../../shared/model/task-stuck.ts';
import { isHumanActor } from '../../shared/model/people.ts';
import type { OwnershipService, RuntimeServices } from '../contracts.ts';
import { isOutage } from '../agents/outages.ts';
import { dueText } from '../context/time.ts';

export const STALL_BASE_MS = 60_000;
export const STALL_MAX_MS = 24 * 3600_000;
export const OUTAGE_MAX_MS = 30 * 60_000;
/** A wait on something outside is looked at again a day after it began (when it names no until). */
export const RECHECK_MS = 24 * 3600_000;

type LookTask = Pick<Task, 'status' | 'assigneeKind' | 'assigneeId' | 'waitingOn' | 'dueAt' | 'ledger' | 'startedAt' | 'createdAt' | 'createdBy' | 'assignedBy'>;
export type TurnInput = Parameters<OwnershipService['afterTurn']>[0];
export type LookWhy = 'continue' | 'retry' | 'recheck' | 'stuck' | 'due' | 'wait-ends';

/** The pause after `stalls` turns in a row that did not move the task: 1 min, 2 min, 4 min … at most a day. */
export function stallDelay(stalls: number): number {
  return Math.min(STALL_BASE_MS * 2 ** Math.max(0, stalls - 1), STALL_MAX_MS);
}

/** Who gave the task (the last giver, else its maker). */
export function giverOf(task: Pick<Task, 'createdBy' | 'assignedBy'>): string {
  return task.assignedBy ?? task.createdBy;
}

const isAgentActor = (id: string) => !isHumanActor(id) && id !== SYSTEM_ID;

const earliest = (...times: Array<number | undefined>): number | undefined => {
  const set = times.filter((at): at is number => at !== undefined);
  return set.length ? Math.min(...set) : undefined;
};

/** The look after a change outside the owner's own turn (see the header); `openPieces`: unfinished pieces another owner holds;
 * `lookedAt`: the last look at a wait (a turn on it), which a wait's next look counts from when it is later than its start. */
export function nextLook(task: LookTask, now: number, openPieces = false, lookedAt = 0): number | undefined {
  if (isFinished(task.status) || isPaused(task)) return undefined;
  if (task.assigneeKind === 'team') return now;
  const due = task.dueAt !== undefined && task.dueAt > now ? task.dueAt : undefined;
  const wait = task.status === 'waiting' ? task.waitingOn : undefined;
  if (task.assigneeKind === 'human') {
    const given = isAgentActor(giverOf(task)) ? Math.max(movedAt(task), wait?.since ?? 0) + STUCK_MS : undefined;
    return earliest(wait?.until, due, given);
  }
  if (wait) return earliest(wait.until ?? Math.max(wait.since, lookedAt) + (wait.on === 'outside' ? RECHECK_MS : STUCK_MS), due);
  return openPieces ? earliest(movedAt(task) + STUCK_MS, due) : now;
}

/** The look after the owner's own turn on the task, and the ledger it leaves. */
export function lookAfterTurn(task: LookTask, input: TurnInput, now: number, busy: { splits: boolean; pieces: boolean }): { at: number | undefined; ledger: Task['ledger'] } {
  const moved = input.progressed || input.outcome === 'interrupted';
  const stalls = moved ? 0 : (task.ledger.stalls ?? 0) + 1;
  const ledger = { ...task.ledger, stalls, ...(input.progressed ? { movedAt: now } : {}) };
  const after = { ...task, ledger };
  const due = task.dueAt !== undefined && task.dueAt > now ? task.dueAt : undefined;
  if (task.status === 'waiting') return { at: nextLook(after, now, false, now), ledger }; // this turn was the look
  if (isOutage(input.outcome)) return { at: now + Math.max(Math.min(stallDelay(stalls), OUTAGE_MAX_MS), input.retryAfterMs ?? 0), ledger };
  if (busy.splits) return { at: earliest(movedAt(after) + RECHECK_MS, due), ledger };
  if (busy.pieces) return { at: nextLook(after, now, true), ledger };
  return { at: stalls ? earliest(now + stallDelay(stalls), due) : now, ledger };
}

/** Why a look that is due at `now` comes (the watcher fires it). */
export function lookOf(task: Pick<Task, 'status' | 'waitingOn' | 'dueAt' | 'nextAt' | 'ledger'>, now: number): LookWhy {
  const wait = task.status === 'waiting' ? task.waitingOn : undefined;
  if (wait?.until !== undefined && wait.until <= now) return 'wait-ends';
  if (task.dueAt !== undefined && task.dueAt <= now && task.nextAt !== undefined && Math.abs(task.nextAt - task.dueAt) < 1000) return 'due';
  if (wait) return wait.on === 'outside' ? 'recheck' : 'stuck';
  return task.ledger.stalls ? 'retry' : 'continue';
}

/** The wake reason a look runs under (its rank in the dispatcher): going on is task work, a look back a retry. */
export function wakeReason(why: LookWhy): WakeReason {
  return why === 'retry' || why === 'recheck' || why === 'stuck' ? 'retry' : 'task';
}

export interface NoteNames { nameOf(id: string): string; zone: string }

/** What a waiting task waits on, in words ("Felix", "2 tasks", "something outside"). */
export function waitWords(task: Pick<Task, 'waitingOn'>, names: Pick<NoteNames, 'nameOf'>): string {
  const wait = task.waitingOn;
  if (!wait) return 'nothing';
  if (wait.on === 'who') return wait.who ? names.nameOf(wait.who) : 'someone';
  if (wait.on === 'task') return `${wait.ids?.length ?? 0} task${wait.ids?.length === 1 ? '' : 's'}`;
  return 'something outside';
}

/** The note in my voice a look carries (times in the person's zone). */
export function noteOf(task: Pick<Task, 'title' | 'status' | 'waitingOn' | 'dueAt' | 'ledger' | 'startedAt' | 'createdAt'>, why: LookWhy, now: number, names: NoteNames): string {
  const title = `"${excerpt(task.title, 120)}"`;
  const at = (ms: number) => dueText(ms, names.zone, now);
  const wait = task.waitingOn;
  const waits = wait && task.status === 'waiting' ? `waits on ${waitWords(task, names)} since ${at(wait.since)} – ${excerpt(wait.why, 200).replace(/\.+$/, '')}` : '';
  switch (why) {
    case 'wait-ends': return `The wait of my task ${title} ended (${at(wait?.until ?? now)}).`;
    case 'due': return `My task ${title} is due now (${at(task.dueAt ?? now)}); it ${waits || 'is open'}.`;
    case 'recheck': return `Next look at my task ${title}: it ${waits}.`;
    case 'stuck': return `My task ${title} has not moved since ${at(Math.max(movedAt(task), wait?.since ?? 0))}${wait ? ` – it ${waits}` : ''}.`;
    case 'retry': return `My task ${title} has not moved since ${at(movedAt(task))}.`;
    default: return `I go on with my task ${title}.`;
  }
}

/** The look in my words, for tool results and task lines ("now", "Fri 13 Nov 19:38", "nothing planned"). */
export function lookWords(at: number | undefined, now: number, zone: string): string {
  if (at === undefined) return 'nothing planned';
  return at <= now + 5_000 ? 'now' : dueText(at, zone, now);
}

/** The person's name for notes: the owner's own name, a colleague's, an agent's (HUMAN_ID → the profile name). */
export function namesFor(s: Pick<RuntimeServices, 'org' | 'settings'> & Partial<Pick<RuntimeServices, 'people'>>, zone: string): NoteNames {
  const owner = (() => { try { return s.settings.get().profile.name?.trim() || 'the person'; } catch { return 'the person'; } })();
  return {
    zone,
    nameOf: (id: string) => id === HUMAN_ID ? owner : id.startsWith('per_') ? s.people?.nameOf(id) ?? 'a colleague' : s.org?.get(id)?.name ?? id,
  };
}
