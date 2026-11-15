// Schedule tools: agents think ahead – visible scheduled posts, private reminders and
// recurring routines (e.g. "answer YouTube comments in 24 h, then weekly ×4"). A scheduled
// message has a level like a <chat to> block ('important' – posted as important –, or 'silent': in the history
// without unread or notification, payload.silent; schedules/fire.ts posts it so). One `when` shape
// for all of them ({ at } or { repeat: every | times | cron … }, schedules/when.ts), times without
// a zone in the profile time zone, schedules.update (pause, resume, new when, words, a routine's notes or level; a schedule the
// person paused stays paused until the person resumes it – the scheduler refuses) and every result
// echoes the rule and the next runs so the agent can check itself. B-080: schedules.update applies what fits the kind –
// a reminder's notes are the lines under its first, a level outside a scheduled message is left out with a line in
// the result –; a stopped schedule is "paused" only with a recorded pause, else "ended" (a new when brings it back). The quiet "Scheduled"
// chat line comes from the scheduler (schedules/fire.ts announceCreated), once. B-054: only a scheduled message
// is posted in a chat; a routine is handed over in the run's chat or chatId when the agent is in it (util.ts chatIfAny),
// else its tasks are chat-free; reminders stay chat-free.
// Every schedules.* tool is anyMode – through tools.call in every mode, the direct offers unchanged.
// Owns: schedules.message, schedules.remind, schedules.routine, schedules.update, schedules.list,
// schedules.cancel. Never: changes or cancels schedules of others it does not manage (or the
// person's); never creates hidden recurring work (every schedule is listed and cancellable by the person).

import type { ToolContext, ToolDef } from '../types.ts';
import { CHAT_ID_PROPERTY, failure, json, text } from '../types.ts';
import type { Schedule } from '../../../shared/model/tasks.ts';
import { HUMAN_ID } from '../../../shared/ids.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import type { MessageLevel } from '../../../shared/model/chat.ts';
import { chatIfAny, clip, defineTool, internal, readChat, resolveChat } from './util.ts';
import { previewTimes } from '../../schedules/preview.ts';
import { WHEN_SCHEMA, isoIn, ruleWords, specFromWhen, type WhenArgs } from '../../schedules/when.ts';

interface When { when: WhenArgs }

const LEVEL = {
  type: 'string', enum: ['normal', 'important', 'silent'],
  description: 'important: a push, for what the person would want to hear at once; silent: no notification, only mentioned members are reached.',
};
const TITLE = { type: 'string', minLength: 1, maxLength: 120, description: 'Its name in lists.' };

/** A scheduled message's payload fields for `level`: priority 'important', or silent; none for normal. */
function loudness(level: MessageLevel | undefined): Pick<Schedule['payload'], 'priority' | 'silent'> {
  return level === 'important' ? { priority: 'important' } : level === 'silent' ? { silent: true } : {};
}

function profileZone(ctx: ToolContext): string | undefined {
  return ctx.services.settings.get().profile.timezone || undefined;
}

/** The tool's `when` → a spec (or an error line), in the profile zone. */
function specOf(args: When, ctx: ToolContext) {
  return specFromWhen(args.when, ctx.services.clock.now(), profileZone(ctx));
}

/** What every result echoes: id, rule, state and the next three runs as the scheduler takes them. */
function summary(schedule: Schedule, ctx: ToolContext) {
  let next: string[] = [];
  if (schedule.active && schedule.nextAt !== undefined) {
    const spec = schedule.spec.everyMs !== undefined && schedule.spec.at === undefined ? { ...schedule.spec, at: schedule.nextAt } : schedule.spec;
    try {
      next = previewTimes(spec, ctx.services.clock.now(), { runs: schedule.runs }).map((at) => isoIn(at, schedule.spec.tz));
    } catch { next = [isoIn(schedule.nextAt, schedule.spec.tz)]; }
  }
  return {
    ok: true, scheduleId: schedule.id, kind: schedule.kind, active: schedule.active,
    ...(schedule.pausedBy === HUMAN_ID ? { pausedBy: 'person' } : {}), ...(ended(schedule) ? { ended: true } : {}), rule: ruleWords(schedule.spec), next,
  };
}

/** B-080: a stopped schedule nobody paused has ended (its runs are used up); a new when brings it back (scheduler.ts). */
function ended(schedule: Schedule): boolean {
  return !schedule.active && schedule.pausedBy === undefined;
}

/** B-080: the state words of a stopped schedule – the person's pause, an agent's pause, or ended. */
function stateWords(schedule: Schedule): string {
  return schedule.active ? '' : schedule.pausedBy === HUMAN_ID ? ', paused by the person' : schedule.pausedBy ? ', paused' : ', ended';
}

function describeSchedule(schedule: Schedule, ctx: ToolContext): string {
  const important = schedule.payload.silent ? ', silent' : schedule.payload.priority === 'important' ? ', important' : '';
  const next = schedule.nextAt !== undefined && schedule.active ? ` · next ${isoIn(schedule.nextAt, schedule.spec.tz)}` : '';
  const owner = schedule.ownerId === ctx.agent.id ? '' : ` · of ${ctx.services.org.get(schedule.ownerId)?.name ?? schedule.ownerId}`;
  // B-072: a routine's words are its task notes too – a manager tidying a rule must see where it stands
  const notes = schedule.kind === 'routine' && schedule.payload.taskTemplate?.notes ? `\n  notes: ${clip(schedule.payload.taskTemplate.notes, 400)}` : '';
  return `${schedule.id} [${schedule.kind}${important}${stateWords(schedule)}] ${schedule.title} · ${ruleWords(schedule.spec)}${next}${owner}${notes}`;
}

/** B-080: a reminder's note – its words, and `notes` under them after a blank line ("" or none: the words alone). */
function reminderNote(words: string, notes: string | undefined): string {
  return [words, notes].filter(Boolean).join('\n\n');
}

/** A reminder's words: its note up to the blank line reminderNote puts before the notes (words of several lines stay whole). */
function reminderWords(note: string | undefined): string | undefined {
  return note?.split('\n\n')[0]?.trim() || undefined;
}

/** The same rule as cancel: the agent's own schedules or those of agents it manages – never the person's. */
function mayChange(schedule: Schedule, ctx: ToolContext): boolean {
  return schedule.ownerId === ctx.agent.id || (schedule.ownerId !== HUMAN_ID && ctx.services.org.canManage(ctx.agent.id, schedule.ownerId));
}

const scheduleMessage = defineTool<When & { chatId?: string; text: string; mentions?: string[]; title?: string; level?: MessageLevel }>({
  name: 'schedules.message',
  description: 'Posts a message into a chat later, once or repeating, as if I wrote it then. I get back the schedule id, its rule and the next times.',
  inputSchema: {
    type: 'object',
    properties: {
      chatId: CHAT_ID_PROPERTY, text: { type: 'string', minLength: 1 }, mentions: { type: 'array', items: { type: 'string' } }, title: TITLE, level: LEVEL, when: WHEN_SCHEMA,
    },
    required: ['text', 'when'], additionalProperties: false,
  },
  category: 'think',
  describe: (args, ctx) => internal(`Schedule a message: ${clip(args.text, 60)}`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const conversationId = resolveChat(ctx, args.chatId);
    const spec = specOf(args, ctx);
    if (typeof spec === 'string') return failure(spec);
    const schedule = ctx.services.scheduler.create({ ownerId: ctx.agent.id, conversationId, taskId: ctx.taskId, kind: 'message', title: args.title ?? clip(args.text, 60), spec, payload: { body: args.text, mentions: args.mentions, ...loudness(args.level) } });
    return json(summary(schedule, ctx));
  },
});

const remindMe = defineTool<When & { note: string; taskId?: string; chatId?: string }>({
  name: 'schedules.remind',
  description: 'Reminds me at a time: I get a turn with my own note, nothing is posted.',
  inputSchema: {
    type: 'object',
    properties: { note: { type: 'string', minLength: 1, maxLength: 4000 }, taskId: { type: 'string', description: "Default this turn's task." }, chatId: CHAT_ID_PROPERTY, when: WHEN_SCHEMA },
    required: ['note', 'when'], additionalProperties: false,
  },
  category: 'think',
  describe: (args) => internal(`Reminder: ${clip(args.note, 60)}`),
  async run(args, ctx) {
    const spec = specOf(args, ctx);
    if (typeof spec === 'string') return failure(spec);
    const conversationId = args.chatId ? resolveChat(ctx, args.chatId) : ctx.conversationId;
    const schedule = ctx.services.scheduler.create({ ownerId: ctx.agent.id, conversationId, taskId: args.taskId ?? ctx.taskId, kind: 'reminder', title: clip(args.note, 60), spec, payload: { note: args.note } });
    return json(summary(schedule, ctx));
  },
});

const TASK_SCHEMA = {
  type: 'object', required: ['title'], additionalProperties: false, description: 'The task each run creates.', // bounded like tasks.create (fire.ts bounds stored ones again)
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 300 }, notes: { type: 'string', maxLength: 20_000 },
    steps: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 300 }, maxItems: 20, description: 'The plan of each run\'s task, one line each.' },
  },
};

const createRoutine = defineTool<When & { title: string; task: { title: string; notes?: string; steps?: string[] }; chatId?: string }>({
  name: 'schedules.routine',
  description: 'Gives me a new tracked task at set times, once or repeating. Its tasks are handed over in chatId or this chat; without one they stand alone.',
  inputSchema: {
    type: 'object',
    properties: { title: { ...TITLE, description: "The routine's name." }, chatId: { type: 'string' }, task: TASK_SCHEMA, when: WHEN_SCHEMA },
    required: ['title', 'task', 'when'], additionalProperties: false,
  },
  category: 'think',
  describe: (args, ctx) => internal(`Routine: ${clip(args.title, 60)}`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const conversationId = chatIfAny(ctx, args.chatId); // B-054: undefined – each firing creates a chat-free task
    const spec = specOf(args, ctx);
    if (typeof spec === 'string') return failure(spec);
    const schedule = ctx.services.scheduler.create({ ownerId: ctx.agent.id, ...(conversationId ? { conversationId } : {}), taskId: ctx.taskId, kind: 'routine', title: args.title, spec, payload: { taskTemplate: args.task } });
    return json(summary(schedule, ctx));
  },
});

const updateSchedule = defineTool<{ scheduleId: string; paused?: boolean; when?: WhenArgs; text?: string; notes?: string; title?: string; level?: MessageLevel }>({
  name: 'schedules.update',
  description: 'Changes, pauses or resumes one of my schedules or one of an agent I manage. What does not fit its kind is left out with a line; a new when brings an ended one back.',
  inputSchema: {
    type: 'object',
    properties: {
      scheduleId: { type: 'string' }, paused: { type: 'boolean', description: 'One the person paused stays paused until they resume it.' }, when: WHEN_SCHEMA,
      text: { type: 'string', minLength: 1, maxLength: 4000, description: "A message's text, a reminder's note or a routine task's title." },
      notes: { type: 'string', maxLength: 20_000, description: 'A routine task\'s notes or the lines under a reminder; "" clears.' }, title: TITLE, level: LEVEL,
    },
    required: ['scheduleId'], additionalProperties: false,
  },
  category: 'think',
  describe: (args) => internal(`Change schedule ${args.scheduleId}`, args.scheduleId),
  async run(args, ctx) {
    const schedule = ctx.services.scheduler.get(args.scheduleId);
    if (!schedule) return failure('Schedule not found.');
    if (!mayChange(schedule, ctx)) return failure('This schedule belongs to someone I do not manage; it stays as it is.');
    if (args.paused === undefined && !args.when && args.text === undefined && args.notes === undefined && args.title === undefined && !args.level) return failure('Give paused, when, text, notes, title or level.');
    // B-080 (live: two failed calls before the third applied anything): a field that does not fit the kind is left out
    // with a line in the result; the rest is applied.
    const left: string[] = [];
    const patch: Parameters<ToolContext['services']['scheduler']['update']>[1] = {};
    if (args.when) {
      const spec = specOf({ when: args.when }, ctx);
      if (typeof spec === 'string') return failure(spec);
      patch.spec = spec;
    }
    if (args.text !== undefined) {
      if (schedule.kind === 'message') patch.payload = { body: args.text };
      else if (schedule.kind === 'reminder') patch.payload = { note: reminderNote(args.text, args.notes) };
      else if (schedule.kind === 'routine') patch.payload = { taskTemplate: { ...(schedule.payload.taskTemplate ?? { title: schedule.title }), title: clip(args.text, 300) } };
      else return failure('A timer has no text to change.');
      if (schedule.kind !== 'routine' && args.title === undefined) patch.title = clip(args.text, 60);
    }
    if (args.notes !== undefined) {
      if (schedule.kind === 'routine') {
        const template = { ...(patch.payload?.taskTemplate ?? schedule.payload.taskTemplate ?? { title: schedule.title }) };
        if (args.notes) template.notes = args.notes; else delete template.notes;
        patch.payload = { ...patch.payload, taskTemplate: template };
      } else if (schedule.kind === 'reminder') {
        if (args.text === undefined) patch.payload = { note: reminderNote(reminderWords(schedule.payload.note) ?? schedule.title, args.notes) };
      } else left.push('notes stay with routines and reminders: a scheduled message changes with text.');
    }
    if (args.level) {
      if (schedule.kind === 'message') patch.payload = { ...patch.payload, priority: undefined, silent: undefined, ...loudness(args.level) }; // the old level goes
      else left.push('level stays with scheduled messages: a reminder reaches only me, a routine makes my task.');
    }
    if (args.title !== undefined) patch.title = args.title;
    if (args.paused !== undefined) patch.active = !args.paused;
    try {
      const result = summary(ctx.services.scheduler.update(schedule.id, patch, ctx.agent.id), ctx);
      return json(left.length ? { ...result, note: left.join(' ') } : result);
    } catch (error) {
      if (error instanceof WorkforceError) return failure(error.message); // e.g. a schedule the person paused
      throw error;
    }
  },
});

const listSchedules = defineTool<{ chatId?: string; mine?: boolean }>({
  name: 'schedules.list',
  description: 'Lists scheduled messages, reminders and routines with rule and next time. By default I see mine and those of agents I manage.',
  inputSchema: { type: 'object', properties: { chatId: { type: 'string', description: "One chat's; default all." }, mine: { type: 'boolean', description: 'true: only mine.' } }, additionalProperties: false },
  category: 'read',
  describe: () => internal('List schedules'),
  async run(args, ctx) {
    if (args.chatId) resolveChat(ctx, args.chatId, { read: true });
    const schedules = args.chatId ? ctx.services.scheduler.list({ conversationId: args.chatId, ownerId: args.mine ? ctx.agent.id : undefined })
      : args.mine ? ctx.services.scheduler.list({ ownerId: ctx.agent.id })
        : ctx.services.scheduler.list().filter((schedule) => mayChange(schedule, ctx)); // B-072: a manager sees its team's
    return text(schedules.length ? schedules.map((schedule) => describeSchedule(schedule, ctx)).join('\n') : 'No schedules.');
  },
});

const cancelSchedule = defineTool<{ scheduleId: string }>({
  name: 'schedules.cancel',
  description: 'Cancels one of my schedules or one of an agent I manage.',
  inputSchema: { type: 'object', properties: { scheduleId: { type: 'string' } }, required: ['scheduleId'], additionalProperties: false },
  category: 'think',
  describe: (args) => internal(`Cancel schedule ${args.scheduleId}`, args.scheduleId),
  async run(args, ctx) {
    const schedule = ctx.services.scheduler.get(args.scheduleId);
    if (!schedule) return failure('Schedule not found.');
    if (!mayChange(schedule, ctx)) return failure('This schedule belongs to someone I do not manage; it stays.');
    ctx.services.scheduler.remove(schedule.id);
    return json({ ok: true });
  },
});

/** Reachable in every mode through tools.call; a mode's direct offer is unchanged. */
export const scheduleTools: ToolDef[] = [scheduleMessage, remindMe, createRoutine, updateSchedule, listSchedules, cancelSchedule].map((tool) => ({ ...tool, anyMode: true as const }));
