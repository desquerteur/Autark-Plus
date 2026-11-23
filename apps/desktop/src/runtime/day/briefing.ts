// The morning briefing (B-041 track A2, the My day concept §4.4, §6.1): one row per member and
// local date in day_briefings (migration 068) and the 'day.briefing' event (ids only). What it says: the work the
// member handed off that was done since last evening, their to-dos an agent prepared since then, handed-off work
// not started yet (a sleeping PC – said plainly), today's planned blocks, what needs them now (My day's Needs-you
// rule, shared/model/todo-later.ts needsYou via countNow, with the to-do whose block runs now) and the chats that matter (day/briefing-chats.ts, ranked
// deterministically). It asks no model (17.11.2026, Konrad: whoever does not see a model's sentences needs no model call –
// "Mein Tag" Paket 1b): its one line is today's counts (Home shows the night's counts – done, prepared, not started – as its
// own line from the ids).
// B-059: the night also counts the work an agent took on in a chat the member is in (the Manager's tasks from the
// person's request – top-level, owned by an agent or the team; takenOn), and says when the PC slept while that
// work waited (keep-awake.ts sleptSince → Briefing.slept; Home shows it).
// Owns: writing and reading briefings. Never: asks a model, message bodies, private to-dos, or text an agent reads.

import { HUMAN_ID, SYSTEM_ID } from '../../shared/ids.ts';
import type { Briefing, SleepSpan } from '../../shared/model/calendar.ts';
import { waitingByChat } from '../../shared/model/chat-rank.ts';
import { isPersonId } from '../../shared/model/people.ts';
import { countNow } from '../../shared/model/todo-later.ts';
import type { TaskView } from '../../shared/model/tasks.ts';
import type { RuntimeServices } from '../contracts.ts';
import '../contracts/calendar.ts';
import { rankChats, type RankedChat } from './briefing-chats.ts';
import { dayBounds, dayZone, daySettings, lastEvening } from './clock.ts';
import { handedOff } from './handed-off.ts';
import { sleptSince } from './keep-awake.ts';

export type BriefingDeps = Pick<RuntimeServices, 'db' | 'bus' | 'clock' | 'tasks' | 'chats' | 'settings' | 'log'>
  & Partial<Pick<RuntimeServices, 'org' | 'calendar'>>;

const MAX_IDS = 50;

interface Facts {
  done: TaskView[]; prepared: TaskView[]; waiting: number; planned: Array<{ at: number }>; needsYou: number;
  chats: RankedChat[]; slept: SleepSpan[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export class Briefings {
  readonly s: BriefingDeps;
  constructor(s: BriefingDeps) { this.s = s; }

  /** The stored briefing of `ownerId` for `date` (YYYY-MM-DD), or null. */
  get(ownerId: string, date: string): Briefing | null {
    try {
      const row = this.s.db.get<{ data: string }>('SELECT data FROM day_briefings WHERE owner_id = ? AND date = ?', [ownerId, date]);
      const value = row ? JSON.parse(row.data) as Briefing : undefined;
      return value && value.ownerId === ownerId && value.date === date && Array.isArray(value.lines) ? value : null;
    } catch {
      return null;
    }
  }

  /** Builds, stores and announces the briefing of `date` (the morning run; again later replaces it). */
  async build(ownerId: string, date: string): Promise<Briefing> {
    const s = this.s;
    const now = s.clock.now();
    const facts = this.facts(ownerId, date, now);
    const briefing: Briefing = {
      ownerId, date, at: now, lines: countLines(facts),
      doneTaskIds: facts.done.slice(0, MAX_IDS).map((task) => task.id), preparedTaskIds: facts.prepared.slice(0, MAX_IDS).map((task) => task.id),
      waitingToStart: facts.waiting, planned: facts.planned.length, needsYou: facts.needsYou,
      chats: facts.chats,
      ...(facts.slept.length ? { slept: facts.slept } : {}),
    };
    s.db.run(
      `INSERT INTO day_briefings (owner_id, date, data, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_id, date) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`,
      [ownerId, date, JSON.stringify(briefing), now],
    );
    s.bus.emit('day.briefing', { ownerId, date });
    return briefing;
  }

  private facts(ownerId: string, date: string, now: number): Facts {
    const s = this.s;
    const tz = dayZone(s);
    const since = lastEvening(now, tz, daySettings(s).workEnd);
    const handed = [...handedOff(s, ownerId, since), ...takenOn(s, ownerId, since)];
    const todos = s.tasks.todos(1000);
    const { start, end } = dayBounds(date, tz);
    let blocks: Array<{ at: number }> = [];
    const running = new Set<string>();
    try {
      const events = s.calendar?.list(ownerId, start, end).events.filter((event) => event.kind === 'todo' && event.state === 'planned') ?? [];
      for (const event of events) if (event.taskId && event.startAt <= now && now < event.endAt) running.add(event.taskId);
      blocks = events.sort((a, b) => a.startAt - b.startAt).map((event) => ({ at: event.startAt }));
    } catch (error) { s.log.debug('briefing: no calendar', { error: String(error) }); }
    const waits = new Map([...waitingByChat(todos, now, end)].map(([chatId, list]) => [chatId, list.length])); // Home's rule too
    let chats: RankedChat[] = [];
    try {
      const list = s.chats.list();
      chats = rankChats(list, { waits, now, nameOf: (id) => s.org?.get(id)?.name ?? 'An agent' });
    } catch (error) { s.log.debug('briefing: no chats', { error: String(error) }); }
    return {
      done: handed.filter((task) => task.status === 'done'),
      prepared: todos.filter((task) => task.prep !== undefined && task.prep.at >= since),
      waiting: handed.filter((task) => task.status === 'open' && task.startedAt === undefined && (task.assigneeKind === 'agent' || task.assigneeKind === 'team')).length,
      planned: blocks, needsYou: countNow(todos, now, end, running), chats, slept: sleptSince(s.db, since),
    };
  }
}

/** B-059: top-level work an agent took on in a chat the member is in (the Manager's tasks from the person's request),
 *  owned by an agent or the team – open, plus done since `since`. Never a chat the member is not in (people's own chats). */
export function takenOn(s: Pick<BriefingDeps, 'tasks' | 'chats'>, ownerId: string, since: number): TaskView[] {
  const member = new Map<string, boolean>();
  const inChat = (chatId: string) => {
    if (!member.has(chatId)) {
      let found = false;
      try { found = s.chats.members(chatId).some((entry) => entry.memberId === ownerId && entry.leftAt === undefined); } catch { /* unknown chat */ }
      member.set(chatId, found);
    }
    return member.get(chatId)!;
  };
  const fits = (task: TaskView) => !task.parentId && task.conversationId !== undefined && (task.assigneeKind === 'agent' || task.assigneeKind === 'team')
    && task.createdBy !== ownerId && task.createdBy !== HUMAN_ID && task.createdBy !== SYSTEM_ID && !isPersonId(task.createdBy) && inChat(task.conversationId);
  const open = s.tasks.list({ status: ['open'], limit: 1000 }).filter(fits);
  const done = s.tasks.list({ completedSince: since, limit: 200 }).filter((task) => task.status === 'done' && fits(task));
  return [...open, ...done];
}

/** The briefing's line: today's counts in one line (none when there is nothing to say). The night's counts
 *  (done, prepared, not started) are the briefing's ids and waitingToStart, which Home shows as its own line. */
export function countLines(facts: Pick<Facts, 'planned' | 'needsYou'>): string[] {
  const day = [
    facts.planned.length ? `${plural(facts.planned.length, 'to-do', 'to-dos')} planned` : '',
    facts.needsYou ? `${facts.needsYou} ${facts.needsYou === 1 ? 'needs' : 'need'} you` : '',
  ].filter(Boolean);
  return day.length ? [`Today: ${day.join(', ')}.`] : [];
}
