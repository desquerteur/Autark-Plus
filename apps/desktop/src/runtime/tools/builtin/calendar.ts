// Calendar tools for agents (B-041 track A1, the My day concept §5 – "Kalender lesen, freie Zeit
// finden, Termin/To-do-Block eintragen (sichtbar, nie über meine Termine oder Blöcke hinweg)"): calendar.list and
// calendar.find_free read the person's calendar (text from connected calendars is untrusted data, marked like web
// results – runtime/calendar/agent-view.ts); calendar.add puts an appointment, or a new to-do for the person with
// its block, into it; calendar.place_task gives one of the person's own to-dos a time. Writes are visible: the row
// is the agent's (setBy 'agent'), a status line in the agent's chat says what it placed, and the service refuses a
// time over an appointment or a block the person set (runtime/calendar/service.ts). Times without an offset are
// read in the profile zone. Only from a turn nobody but the owner reads (F-52). Registered in tools/builtin/index.ts.
// B-054: a to-do calendar.add makes in a run with no chat is chat-free (the run's origin, on My day); no hidden chat.
// Moving and removing an entry (calendar.move, calendar.remove) is in calendar-change.ts, on the helpers exported here.
// placeOnMyDay (tasks.create to the person with a time or an estimate): the new to-do gets a block at once – at the given time,
// else the first free slot today (then tomorrow) within working hours.
// B-078 (D20, head of staff as an open capability): list, find_free and add take `who` – 'human', colleagues (per_…),
// 'owner' (an employee's PC: the company's CEO) and rooms (room:…), resolved by calendar/members.ts (a colleague's own
// linked PC answers for them, calendar/linked.ts). Titles go only to the one person who alone reads the turn; anyone
// else, and any chat, gets free/busy (calendar/team.ts). find_free with several members answers the time they share
// within each one's working hours; add with `who` books the appointment for each of them (not where an outsider
// reads). calendar.connect add_ics takes `room`: that calendar then belongs to the room and "list" shows the rooms.
// Owns: these tool definitions. Never: moves a block the person set, plans a private ("Only me") to-do, or writes to
// an outside calendar itself (the sources' mirror does).

import type { ToolContext, ToolDef, ToolOutput } from '../types.ts';
import { failure, json } from '../types.ts';
import { HUMAN_ID } from '../../../shared/ids.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import { DEFAULT_ESTIMATE_MIN, isLocalDate, type CalendarEvent, type CalendarSetBy } from '../../../shared/model/calendar.ts';
import { daySettingsOf } from '../../../shared/model/day-settings.ts';
import type { TaskView } from '../../../shared/model/tasks.ts';
import type { Settings } from '../../../shared/model/system.ts';
import type { CalendarService } from '../../contracts/calendar.ts';
import '../../contracts/calendar.ts';
import { agentEntry, noOutsider, ownerOnlyTurn, spanText, turnPerson, UNTRUSTED_NOTE, workHours } from '../../calendar/agent-view.ts';
import { resolveMember, roomId, rooms, whoList, type Member } from '../../calendar/members.ts';
import { blockOwner, busySpans, conflicts, freeGaps } from '../../calendar/rules.ts';
import { bookTogether, freeTogether, membersBusy } from '../../calendar/team.ts';
import { profileZone } from '../../calendar/service.ts';
import { GOOGLE_ICS_WAY } from '../../calendar/sources/google.ts';
import { localDate, zonedTime } from '../../calendar/when.ts';
import { canReadTask } from '../../tasks/access.ts';
import { quickDraft } from '../../tasks/todo-draft.ts';
import { authorName, clip, defineTool, internal, parseWhen, readChat } from './util.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MAX_LIST_DAYS = 31;
const MAX_FREE = 8;
const WALL = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;
export const TIME = { type: 'string', description: 'ISO ("2026-10-25T10:00" in the person\'s time zone) or from now ("+2h").' };
const WHO = {
  anyOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, minItems: 1, maxItems: 12 }],
  description: '"human" (the person, default), a colleague\'s per_… id, "owner" (on an employee\'s PC: the CEO) or a room:… id; one or a list.',
};

/** The members `who` names (default: the person), or why not. */
function membersOf(ctx: ToolContext, who: unknown): Member[] | ToolOutput {
  const ids = who === undefined ? [HUMAN_ID] : whoList(who);
  if (typeof ids === 'string') return failure(ids);
  return ids.map((id) => resolveMember(ctx.services, id, (person) => authorName(ctx, person)));
}

/** A time an agent gave: wall times without an offset in the profile zone; a bare date is its local midnight. */
export function toolTime(value: unknown, now: number, tz: string): number | undefined {
  if (typeof value === 'string') {
    const wall = WALL.exec(value.trim());
    if (wall && isLocalDate(wall[1])) return zonedTime(wall[1], wall[2] ? Number(wall[2]) * 60 + Number(wall[3]) : 0, tz);
  }
  return parseWhen(value, now);
}

/** The calendar, or the reason this turn may not use it. */
export function calendarFor(ctx: ToolContext): CalendarService | ToolOutput {
  const calendar = ctx.services.calendar;
  if (!calendar) return failure('The calendar is not available.');
  // B-057: a split's call is judged in its parent's chat (readChat).
  if (!ownerOnlyTurn(ctx.services.db, readChat(ctx))) return failure('The person\'s calendar is private to them: it is not read or changed from a chat other people read along.');
  return calendar;
}

export const isOutput = (value: unknown): value is ToolOutput => typeof value === 'object' && value !== null && 'content' in value;

/** The person's own to-do with this id, as far as this agent may plan it (an error text otherwise). */
export function plannable(ctx: ToolContext, taskId: string): TaskView | string {
  const task = ctx.services.tasks.get(taskId);
  if (!task || task.private || !canReadTask(ctx.services, ctx.agent.id, task)) return `To-do ${taskId} not found.`;
  if (blockOwner(task) !== HUMAN_ID) return `Task ${taskId} is not one of the person's own to-dos.`;
  if (task.status === 'done' || task.status === 'dropped') return `To-do ${taskId} is already finished.`;
  return task;
}

/**
 * Meeting 31.10.: a to-do the person must do physically (or one asked for a time) shows on My day and in the calendar
 * at once – a block at `at`, else the first free slot of `minutes` today from now (then tomorrow) within working
 * hours. Returns when it landed, or why it did not (the to-do stays on the list either way).
 */
export function placeOnMyDay(ctx: ToolContext, taskId: string, at: number | undefined, minutes = DEFAULT_ESTIMATE_MIN): { when?: string; note?: string } {
  const calendar = calendarFor(ctx);
  if (isOutput(calendar)) return { note: 'Not put into the calendar: it is private to the person here.' };
  const now = ctx.services.clock.now();
  const tz = profileZone(ctx.services);
  let startAt = at;
  if (startAt === undefined) {
    const settings = settingsOf(ctx);
    for (const date of [localDate(now, tz), localDate(now + DAY, tz)]) {
      const hours = workHours(settings, date, tz);
      const busy = busySpans(calendar.list(HUMAN_ID, hours.from, hours.to).events);
      startAt = freeGaps(busy, Math.max(now, hours.from), hours.to, minutes, daySettingsOf(settings).bufferMin)[0]?.startAt;
      if (startAt !== undefined) break;
    }
  }
  if (startAt === undefined) return { note: 'No free slot today or tomorrow: it is on the list without a time.' };
  try {
    const block = placeAs(calendar, taskId, startAt, startAt + minutes * MIN, ctx.agent.id);
    return { when: spanText(block.startAt, block.endAt, tz) };
  } catch (error) {
    return { note: `Not put into the calendar: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Places a block as this agent (its id on the row when the service takes it). */
function placeAs(calendar: CalendarService, taskId: string, startAt: number, endAt: number, agentId: string): CalendarEvent {
  const setBy: CalendarSetBy = 'agent';
  return calendar.upsertBlock(taskId, startAt, endAt, setBy, agentId);
}

/** The settings, or none when they cannot be read (the day defaults apply). */
function settingsOf(ctx: ToolContext): Settings | undefined {
  try { return ctx.services.settings.get(); } catch { return undefined; }
}

/** The visible trace in the agent's chat (cosmetic; never fails the call). */
export function announce(ctx: ToolContext, text: string, details: Record<string, unknown>): void {
  if (!ctx.conversationId) return;
  try { ctx.services.chats.status(ctx.conversationId, { type: 'note', text, details }, { authorId: ctx.agent.id }); } catch { /* status lines are cosmetic */ }
}

/** A refusal of the service as a tool result (its message is meant for the agent). */
export function refused(error: unknown): ToolOutput {
  if (error instanceof WorkforceError && ['conflict', 'bad_request', 'not_found'].includes(error.code)) return failure(error.message);
  throw error;
}

const listCalendar = defineTool<{ from: string; to: string; who?: string | string[] }>({
  name: 'calendar.list',
  description: "Reads a calendar between two times: appointments and to-do blocks, up to 31 days. Others' calendars, and any read in a shared chat, show busy times only.",
  inputSchema: { type: 'object', properties: { from: TIME, to: { ...TIME, description: 'A bare date means its end.' }, who: WHO }, required: ['from', 'to'], additionalProperties: false },
  category: 'read',
  describe: () => internal('Read the calendar'),
  async run(args, ctx) {
    const calendar = ctx.services.calendar;
    if (!calendar) return failure('The calendar is not available.');
    const now = ctx.services.clock.now();
    const tz = profileZone(ctx.services);
    const from = toolTime(args.from, now, tz);
    const end = typeof args.to === 'string' ? args.to.trim() : args.to;
    const to = isLocalDate(end) ? zonedTime(end, 24 * 60, tz) : toolTime(end, now, tz);
    if (from === undefined || to === undefined || to <= from) return failure('Give from and to as times, to after from.');
    if (to - from > MAX_LIST_DAYS * DAY) return failure(`Read at most ${MAX_LIST_DAYS} days at once.`);
    const members = membersOf(ctx, args.who);
    if (isOutput(members)) return members;
    const own = turnPerson(ctx.services.db, readChat(ctx));
    const only = members.length === 1 ? members[0] : undefined;
    if (!only || only.where !== 'here' || only.ownerId !== own) {
      const busy = await membersBusy(ctx.services, members, from, to, tz, ctx.signal);
      return json({ tz, from: new Date(from).toISOString(), to: new Date(to).toISOString(), members: busy, note: 'Busy times: I read titles only of the person whose calendar it is, in a turn only they read.' });
    }
    const list = calendar.list(only.ownerId, from, to);
    const entries = list.events.map((row) => {
      const task = row.taskId ? ctx.services.tasks.get(row.taskId) : undefined;
      return agentEntry(row, task && canReadTask(ctx.services, ctx.agent.id, task) ? task : undefined, list.tz);
    });
    const untrusted = entries.some((entry) => entry.source === 'connected');
    return json({ tz: list.tz, from: new Date(from).toISOString(), to: new Date(to).toISOString(), entries, ...(untrusted ? { note: UNTRUSTED_NOTE } : {}),
      ...(list.staleSources.length ? { stale: 'A connected calendar was not synced for over a day; it may miss appointments.' } : {}) });
  },
});

const findFree = defineTool<{ date: string; minutes: number; who?: string | string[] }>({
  name: 'calendar.find_free',
  description: 'Finds free time of a given length on a day, for one or several people together. It looks within working hours around appointments and blocks; I book the slot with calendar.add.',
  inputSchema: { type: 'object', properties: { date: { type: 'string', minLength: 5, maxLength: 10, description: 'YYYY-MM-DD, "today" or "tomorrow".' }, minutes: { type: 'integer', minimum: 5, maximum: 720 }, who: WHO }, required: ['date', 'minutes'], additionalProperties: false },
  category: 'read',
  describe: (args) => internal(`Find ${args.minutes} free minutes on ${args.date}`),
  async run(args, ctx) {
    if (!ctx.services.calendar) return failure('The calendar is not available.');
    const members = membersOf(ctx, args.who);
    if (isOutput(members)) return members;
    const now = ctx.services.clock.now();
    const tz = profileZone(ctx.services);
    const date = args.date === 'today' ? localDate(now, tz) : args.date === 'tomorrow' ? localDate(now + DAY, tz) : args.date;
    if (!isLocalDate(date)) return failure('Give date as YYYY-MM-DD, "today" or "tomorrow".');
    const { free, unreachable } = await freeTogether(ctx.services, members, date, args.minutes, now, tz, ctx.signal);
    const gaps = free.slice(0, MAX_FREE);
    const shared = members.length > 1 ? { with: members.map((member) => member.name) } : {};
    const missing = unreachable.length ? { unreachable, note: `Without ${unreachable.map((member) => member.name).join(', ')}: ${unreachable.map((member) => member.why).join(' ')}` } : {};
    if (!gaps.length) return json({ date, ...shared, free: [], note: `No free ${args.minutes} minutes on ${date} within working hours${members.length > 1 ? ' for everyone' : ''}.`, ...(unreachable.length ? { unreachable } : {}) });
    return json({ date, tz, ...shared, free: gaps.map((gap) => ({ start: new Date(gap.startAt).toISOString(), end: new Date(gap.endAt).toISOString(), when: spanText(gap.startAt, gap.endAt, tz) })), ...missing });
  },
});

/** startAt (from now on) and an optional endAt after it (at most 14 days), or why not. */
function spanOf(args: { startAt: string; endAt?: string }, now: number, tz: string): { startAt: number; endAt?: number } | ToolOutput {
  const startAt = toolTime(args.startAt, now, tz);
  const endAt = args.endAt === undefined ? undefined : toolTime(args.endAt, now, tz);
  if (startAt === undefined || startAt < now - MIN) return failure('Give startAt as a time from now on.');
  if (endAt !== undefined && (endAt <= startAt || endAt - startAt > 14 * DAY)) return failure('endAt must come after startAt (at most 14 days later).');
  return endAt === undefined ? { startAt } : { startAt, endAt };
}

/** calendar.add with who: one appointment for every member (calendar/team.ts), where no outsider reads along. */
async function bookFor(ctx: ToolContext, args: { title: string; startAt: string; endAt?: string; kind?: 'event' | 'todo'; who?: unknown }): Promise<ToolOutput> {
  if (!ctx.services.calendar) return failure('The calendar is not available.');
  if (args.kind === 'todo') return failure('A to-do goes to the person alone: calendar.add kind "todo" without who.');
  if (!noOutsider(ctx.services.db, readChat(ctx))) return failure('Someone outside the organisation reads this chat; I book appointments from a chat of ours.');
  const members = membersOf(ctx, args.who);
  if (isOutput(members)) return members;
  const none = members.find((member) => member.where === 'none');
  if (none && none.where === 'none') return failure(none.reason);
  const now = ctx.services.clock.now();
  const tz = profileZone(ctx.services);
  const span = spanOf(args, now, tz);
  if (isOutput(span)) return span;
  const endAt = span.endAt ?? span.startAt + 60 * MIN;
  try {
    const booked = await bookTogether(ctx.services, members, clip(args.title.trim(), 200), { startAt: span.startAt, endAt }, ctx.agent.id, tz, ctx.signal);
    const when = spanText(span.startAt, endAt, tz);
    const done = booked.filter((entry) => !entry.error);
    if (done.length) announce(ctx, `Booked ${clip(args.title, 60)} · ${when} for ${done.map((entry) => entry.name).join(', ')}`, { who: done.map((entry) => entry.who) });
    return json({ ok: booked.every((entry) => !entry.error), when, booked });
  } catch (error) { return refused(error); }
}

const addToCalendar = defineTool<{ title: string; startAt: string; endAt?: string; kind?: 'event' | 'todo'; who?: string | string[] }>({
  name: 'calendar.add',
  description: "Puts an appointment, or a to-do with its time block, into the person's calendar. With who it goes into every member's; their own entries stay clear, and an existing to-do I place with calendar.place_task.",
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 }, startAt: TIME, endAt: TIME, kind: { type: 'string', enum: ['event', 'todo'], description: 'event (default) or todo.' },
      who: WHO,
    },
    required: ['title', 'startAt'], additionalProperties: false,
  },
  category: 'think',
  describe: (args) => internal(`Add to the calendar: ${clip(args.title, 60)}`),
  async run(args, ctx) {
    if (args.who !== undefined) return bookFor(ctx, args);
    const calendar = calendarFor(ctx);
    if (isOutput(calendar)) return calendar;
    const now = ctx.services.clock.now();
    const tz = profileZone(ctx.services);
    const span = spanOf(args, now, tz);
    if (isOutput(span)) return span;
    const { startAt, endAt } = span;
    try {
      if (args.kind !== 'todo') {
        const { event } = await calendar.add({ text: args.title, startAt, endAt, kind: 'event' }, ctx.agent.id);
        announce(ctx, `Added to the person's calendar: ${clip(event.title ?? args.title, 60)} · ${spanText(event.startAt, event.endAt, tz)}`, { eventId: event.id });
        return json({ ok: true, eventId: event.id, when: spanText(event.startAt, event.endAt, tz) });
      }
      const end = endAt ?? startAt + DEFAULT_ESTIMATE_MIN * MIN;
      const hit = conflicts(calendar.list(HUMAN_ID, startAt, end).events, { startAt, endAt: end })[0];
      if (hit) return failure(`That time is taken (${spanText(hit.startAt, hit.endAt, tz)}). Use calendar.find_free.`);
      const draft = quickDraft(ctx.services, args.title);
      const task = ctx.services.tasks.create({
        ...(ctx.conversationId ? { conversationId: ctx.conversationId } : ctx.origin ? { origin: ctx.origin } : {}), title: draft.title, widget: draft.widget, assigneeKind: 'human', createdBy: ctx.agent.id,
        estimateMin: Math.round((end - startAt) / MIN), estimateSource: 'model',
      });
      const block = placeAs(calendar, task.id, startAt, end, ctx.agent.id);
      announce(ctx, `Added a to-do to the person's calendar: ${clip(task.title, 60)} · ${spanText(block.startAt, block.endAt, tz)}`, { eventId: block.id, taskId: task.id });
      return json({ ok: true, eventId: block.id, taskId: task.id, when: spanText(block.startAt, block.endAt, tz) });
    } catch (error) { return refused(error); }
  },
});

const placeTask = defineTool<{ taskId: string; startAt: string; minutes?: number }>({
  name: 'calendar.place_task',
  description: "Gives one of the person's to-dos a time block in their calendar. A to-do they placed themselves stays where they put it.",
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string', minLength: 1, maxLength: 100 }, startAt: TIME, minutes: { type: 'integer', minimum: 5, maximum: 720, description: 'Default its estimate.' } },
    required: ['taskId', 'startAt'], additionalProperties: false,
  },
  category: 'think',
  describe: (args) => internal(`Place to-do ${args.taskId} in the person's calendar`, args.taskId),
  async run(args, ctx) {
    const calendar = calendarFor(ctx);
    if (isOutput(calendar)) return calendar;
    const task = plannable(ctx, args.taskId);
    if (typeof task === 'string') return failure(task);
    const now = ctx.services.clock.now();
    const tz = profileZone(ctx.services);
    const startAt = toolTime(args.startAt, now, tz);
    if (startAt === undefined || startAt < now - MIN) return failure('Give startAt as a time from now on.');
    const current = calendar.blocksFor([task.id]).get(task.id);
    if (current?.setBy === 'person') return failure(`The person placed this to-do at ${spanText(current.startAt, current.endAt, tz)}; it stays there.`);
    const minutes = args.minutes ?? task.estimateMin ?? ctx.services.estimates?.estimateFor({ ownerId: HUMAN_ID, title: task.title }).minutes ?? DEFAULT_ESTIMATE_MIN;
    const endAt = startAt + minutes * MIN;
    try {
      const block = placeAs(calendar, task.id, startAt, endAt, ctx.agent.id);
      announce(ctx, `Planned for the person: ${clip(task.title, 60)} · ${spanText(block.startAt, block.endAt, tz)}`, { eventId: block.id, taskId: task.id });
      return json({ ok: true, eventId: block.id, when: spanText(block.startAt, block.endAt, tz) });
    } catch (error) { return refused(error); }
  },
});

/**
 * The person's connected calendars (ICS addresses, Google), set up by the agent now that no settings page does it:
 * list them, add an ICS address (Google's "secret address in iCal format" works too), remove one, sync now, or start
 * the Google sign-in – its link goes to the person, who confirms in the browser. Never shows an address or token.
 * Chat sweep 16.11.2026 (owner 11.11.: "Den Kalender müssen ihr irgendwie bekommen … am PC mit Google eingelockt"): the
 * description says how a Google calendar gets here – its secret iCal address, read where that account is signed in –
 * and 'google' without the person's own Google client answers with that way (GOOGLE_ICS_WAY) instead of a dead end.
 */
const connectCalendar = defineTool<{ action: 'list' | 'add_ics' | 'remove' | 'sync' | 'google'; url?: string; label?: string; sourceId?: string; room?: string }>({
  name: 'calendar.connect',
  description: "Lists, adds, syncs or removes the person's and the rooms' connected calendars; once added, a calendar shows in My day and calendar.list reads it. A Google calendar connects through its secret address in iCal format (Google Calendar › Settings › the calendar › Integrate calendar), which I read where that Google account is signed in – the person's pane or their Chrome; add_ics takes it.",
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'add_ics', 'remove', 'sync', 'google'], description: "list (also room ids), add_ics, remove, sync, or google: a sign-in link for the person when this app has their own Google client (list: google.configured)." },
      url: { type: 'string', maxLength: 2000, description: "An https ICS address – Google's secret iCal address works." },
      label: { type: 'string', maxLength: 80 }, sourceId: { type: 'string', maxLength: 100, description: 'For remove or sync; sync without it: all.' },
      room: { type: 'string', minLength: 1, maxLength: 80, description: 'The room it belongs to.' },
    },
    required: ['action'], additionalProperties: false,
  },
  category: 'write_local',
  describe: (args) => ({ summary: `Connected calendars: ${args.action}${args.label ? ` "${clip(args.label, 60)}"` : ''}`, reversible: true, external: args.action !== 'list' }),
  async run(args, ctx) {
    const sources = ctx.services.calendarSources;
    if (!sources) return failure('Connected calendars are not available.');
    const shown = (list: readonly { id: string; kind: string; label: string; status: string; visible: boolean; lastSyncAt?: number; error?: string }[]) =>
      list.map(({ id, kind, label, status, visible, lastSyncAt, error }) => ({ id, kind, label, status, visible, ...(lastSyncAt ? { lastSync: new Date(lastSyncAt).toISOString() } : {}), ...(error ? { error } : {}) }));
    try {
      switch (args.action) {
        case 'list': {
          const known = rooms(ctx.services.db).map((room) => ({ id: room.id, name: room.name, sources: shown(sources.list(room.id)) }));
          return json({ sources: shown(sources.list(HUMAN_ID)), ...(known.length ? { rooms: known } : {}), google: sources.google() });
        }
        case 'add_ics': {
          if (!args.url?.trim()) return failure('Give url: the calendar\'s https ICS address.');
          const room = args.room === undefined ? undefined : roomId(args.room);
          if (args.room !== undefined && !room) return failure('Give room as a name with letters or digits ("Meeting room 2").');
          const input = { url: args.url.trim(), ...(args.label || args.room ? { label: args.label || args.room!.trim() } : {}), ...(room ? { room } : {}) };
          const source = await sources.addIcs(input, HUMAN_ID);
          return json({ ok: true, source: shown([source])[0], ...(room ? { room, note: `Rooms are read-only ICS calendars: a booking with who "${room}" lives in Autark.` } : {}) });
        }
        case 'remove':
          if (!args.sourceId) return failure('Give sourceId (action "list" shows them).');
          await sources.remove(args.sourceId, HUMAN_ID);
          return json({ ok: true });
        case 'sync': return json({ ok: true, sources: shown(await sources.sync(args.sourceId, 'agent')) });
        case 'google':
          if (!sources.google().configured) return failure(`${GOOGLE_ICS_WAY} add_ics takes it.`);
          return json({ ok: true, link: (await sources.connectGoogle()).authUrl, note: 'I send this link to the person; the calendar appears once they confirm.' });
      }
    } catch (error) { return refused(error); }
  },
});

export const calendarTools: ToolDef[] = [listCalendar, findFree, addToCalendar, placeTask, connectCalendar];
