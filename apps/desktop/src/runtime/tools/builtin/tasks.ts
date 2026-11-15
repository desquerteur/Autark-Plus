// Task tools – the four commands every agent has directly (tasks.create, tasks.give, tasks.update, tasks.finish) and two
// readers under "More tools" (tasks.list, tasks.get). One task model: work is a task, a piece is a task under another,
// asking a person is giving them a task (a widget is how they answer). A receiver is named as a chat names a member (an
// id, a guessed id, a name; chat-joins.ts namedMembers), or "me" / "team". Each result says the planned next look in my
// words, so I never plan my own re-check. A task I cannot find comes back with my open tasks.
// Owns: those six tools, the dedupe of the same open ask, the depth limit of pieces given on.
// Never: an alias of an old argument name, or a mode on a task (the mode is the agent's own).

import type { ToolContext, ToolDef } from '../types.ts';
import { CHAT_ID_PROPERTY, EFFORT_PROPERTY, MODEL_PROPERTY, TASK_ID_PROPERTY, WHEN_PROPERTY, failure, json, text } from '../types.ts';
import { HUMAN_ID } from '../../../shared/ids.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import type { UiBlock } from '../../../shared/blocks/catalog.ts';
import { UNFINISHED, isFinished, type Evidence, type Task, type TaskFilter, type TaskStatus, type TaskView } from '../../../shared/model/tasks.ts';
import type { Effort } from '../../../shared/model/providers.ts';
import { isPersonId } from '../../../shared/model/people.ts';
import { chatIfAny, clip, defineTool, internal, parseWhen, resolveChat } from './util.ts';
import { canReadTask } from '../../tasks/access.ts';
import { namedMembers } from './chat-joins.ts';
import { nextWords, renderTask, taskLine } from '../../context/task-text.ts';
import { namesFor } from '../../tasks/next.ts';
import { askedRoute, nameOf } from '../../tasks/give.ts';
import { approveNotes, normalizeAskWidget } from '../../tasks/widgets.ts';
import { askTarget } from '../../people/ask-target.ts';
import { placeOnMyDay } from './calendar.ts';
import { profileZone } from '../../calendar/service.ts';

/** How deep work may be given on below a task (a piece of a piece of a piece) – the guard against endless chains. */
export const MAX_PIECE_DEPTH = 3;
const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATUSES: TaskStatus[] = ['open', 'waiting', 'done', 'dropped'];

/** A time as WHEN_PROPERTY says (undefined: none given; "" clears); one that cannot be read comes back as the refusal. A bare date is that day here. */
function whenOf(ctx: ToolContext, raw: string | undefined, name: string): { at: number | undefined } | { refused: string } {
  if (raw === undefined || !raw.trim()) return { at: undefined };
  const day = BARE_DATE.exec(raw.trim());
  const local = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : undefined;
  if (local && local.getMonth() === Number(day![2]) - 1 && local.getDate() === Number(day![3])) return { at: local.getTime() };
  const at = parseWhen(raw, ctx.services.clock.now());
  return at === undefined ? { refused: `I cannot read ${name} "${clip(raw, 80)}": ${String(WHEN_PROPERTY.description)}` } : { at };
}

/** My open tasks as one line, for a task id that did not fit. */
function myOpenTasks(ctx: ToolContext): string {
  let open: TaskView[] = [];
  try { open = ctx.services.tasks.list({ assigneeKind: 'agent', assigneeId: ctx.agent.id, status: [...UNFINISHED], includeSteps: true, readableBy: ctx.agent.id, limit: 5 }); } catch { open = []; }
  return open.length ? `My open tasks: ${open.map((task) => `${task.id} "${clip(task.title, 60)}"`).join(', ')} (tasks.list has all).` : 'I have no open tasks (tasks.list has all).';
}

/** The task – only when I may read it; otherwise it does not exist for me (the failure names my open tasks). */
function requireTask(ctx: ToolContext, id: string | undefined): TaskView {
  const task = id ? ctx.services.tasks.get(id) : undefined;
  if (task && canReadTask(ctx.services, ctx.agent.id, task)) return task;
  throw new WorkforceError('not_found', `${id ? `No task "${id}" for me.` : 'This run has no task.'} ${myOpenTasks(ctx)}`);
}

/** Who `to` names: "me", "team", or a member's id (a name that fits nobody comes back with who exists). */
function receiverOf(ctx: ToolContext, raw: string | undefined): string | { refused: string } {
  const value = raw?.trim() || 'me';
  if (['me', 'self', 'myself'].includes(value.toLowerCase())) return ctx.agent.id;
  if (value.toLowerCase() === 'team') return 'team';
  const named = namedMembers(ctx, [value]);
  return typeof named === 'string' ? { refused: named } : named[0];
}

/** How many tasks stand above `taskId`. */
function depthOf(ctx: ToolContext, taskId: string | undefined): number {
  let depth = 0;
  const seen = new Set<string>();
  for (let task = taskId ? ctx.services.tasks.get(taskId) : undefined; task?.parentId && !seen.has(task.id) && depth < 20; task = ctx.services.tasks.get(task.parentId)) {
    seen.add(task.id);
    depth++;
  }
  return depth;
}

/** The owner as "<name> (<id>)". */
function ownerWords(ctx: ToolContext, task: Task): string {
  const id = task.assigneeId ?? HUMAN_ID;
  return id === ctx.agent.id ? 'me' : `${nameOf(ctx.services, id)} (${id})`;
}

/** What every write answers: the task, its owner, state and the next look in my words. */
function answer(ctx: ToolContext, task: TaskView, extra: Record<string, unknown> = {}): ReturnType<typeof json> {
  const names = namesFor(ctx.services, profileZone(ctx.services));
  return json({ ok: true, taskId: task.id, owner: ownerWords(ctx, task), status: task.status, next: nextWords(task, names, ctx.services.clock.now()), ...extra });
}

/** My still open ask to the same person with the same title, widget type and parent (one is enough). */
function openAsk(ctx: ToolContext, title: string, at: { owner: string; parentId?: string; type?: string }): TaskView | undefined {
  const row = ctx.services.db.get<{ id: string }>(
    `SELECT id FROM tasks WHERE created_by = ? AND assignee_kind = 'human' AND status IN ('open', 'waiting') AND parent_id IS ?
       AND COALESCE(assignee_id, 'human') = ? AND lower(trim(title)) = ? AND COALESCE(json_extract(widget, '$.type'), '') = ? LIMIT 1`,
    [ctx.agent.id, at.parentId ?? null, at.owner, title.trim().toLowerCase(), at.type ?? '']);
  return row ? ctx.services.tasks.get(row.id) : undefined;
}

type CreateArgs = {
  title: string; to?: string; doneWhen?: string; notes?: string; plan?: string[]; parentId?: string; dependsOn?: string[]; dueAt?: string;
  priority?: number; widget?: Record<string, unknown>; estimateMin?: number; model?: string; effort?: Effort; chatId?: string;
};

const createTool = defineTool<CreateArgs>({
  name: 'tasks.create',
  description: 'Gives new work to me, a colleague, a person or the team, tracked until done or dropped. Asking a person is giving them a task: a widget is how they answer, and their click comes back to me as their line. Whoever gets it hears of it at once; what I give others stands under "Given by me" until it comes back, and when it ends I hear how. A colleague I just asked in our chat already has that request; a task for it would be a second one.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 300, description: 'The goal in a few words.' },
      to: { type: 'string', description: '"me" (default; with a widget: the person of this chat), a colleague or a person by name or id, or "team" – Autark picks one owner now.' },
      doneWhen: { type: 'string', maxLength: 2000, description: 'The outcome in one line – what exists or changed when it is done.' },
      notes: { type: 'string', maxLength: 20_000, description: "What whoever takes it on cannot find without me: the person's words, the facts, what good looks like." },
      plan: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 300 }, maxItems: 20, description: 'The steps I see, one line each; "✓ " before a done one.' },
      parentId: { type: 'string', description: 'The task this is a piece of; its end wakes that task\'s owner. Default this turn\'s task when the work goes to someone else; "none" for separate work.' },
      dependsOn: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Tasks it comes after; it waits until the last of them ends.' },
      dueAt: { ...WHEN_PROPERTY, description: `When it is due – for a person, when they do it. ${String(WHEN_PROPERTY.description)}` },
      priority: { type: 'integer', minimum: 0, maximum: 2, description: '0 normal, 1 high (a person sees it above their input), 2 urgent.' },
      widget: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'], description: 'How a person answers: an ask block – choice, form, confirm, checklist, record, upload, review, timer.' },
      estimateMin: { type: 'integer', minimum: 5, maximum: 720, description: "Minutes a person needs; it goes into the person's calendar." },
      model: MODEL_PROPERTY, effort: EFFORT_PROPERTY, chatId: CHAT_ID_PROPERTY,
    },
    required: ['title'], additionalProperties: false,
  },
  category: 'think',
  describe: (args, ctx) => internal(`Create task "${clip(args.title, 80)}"${args.to ? ` for ${args.to}` : ''}`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const due = whenOf(ctx, args.dueAt, 'dueAt');
    if ('refused' in due) return failure(due.refused);
    const conversationId = chatIfAny(ctx, args.chatId);
    let widget: UiBlock | undefined;
    let notes = args.notes?.trim() ?? '';
    if (args.widget) {
      notes = [notes, approveNotes(args.widget)].filter(Boolean).join('\n\n');
      const normal = normalizeAskWidget(args.widget);
      if (typeof normal === 'string') return failure(normal);
      widget = normal;
      if (widget.type === 'choice' && !widget.question) widget.question = args.title;
      if (widget.type === 'confirm' && !widget.instructions) widget.instructions = args.title;
      if ((args.priority ?? 0) >= 1) widget.important = true;
    }
    // A widget without `to` goes to the person of this chat (who wrote last), else the person who owns the organisation.
    const asked = args.to === undefined && widget ? (conversationId ? askTarget(ctx.services.db, conversationId, (ctx.services.chats.get(conversationId)?.lastSeq ?? 0) + 1, widget) : undefined) ?? HUMAN_ID : undefined;
    const to = asked ?? receiverOf(ctx, args.to);
    if (typeof to !== 'string') return failure(to.refused);
    const toPerson = to === HUMAN_ID || isPersonId(to);
    if (widget && !toPerson) return failure('A widget is how a person answers: to names a person.');
    const others = to !== ctx.agent.id;
    const parentId = args.parentId === 'none' ? undefined : args.parentId ?? (others ? ctx.taskId : undefined);
    if (parentId) requireTask(ctx, parentId);
    for (const after of args.dependsOn ?? []) requireTask(ctx, after);
    if (parentId && others && !toPerson && depthOf(ctx, parentId) + 1 >= MAX_PIECE_DEPTH) return failure('This work is already three levels deep: I do this part myself.');
    if (toPerson) {
      const same = openAsk(ctx, args.title, { owner: to, parentId, type: widget?.type });
      if (same) return answer(ctx, same, { already: true });
    }
    const route = others && !toPerson ? askedRoute(ctx.services, { model: args.model, effort: args.effort, from: ctx.modelId }) : undefined;
    const task = await ctx.services.tasks.createTo({
      ...(conversationId ? { conversationId } : {}), ...(ctx.origin ? { origin: ctx.origin } : {}),
      title: args.title, ...(notes ? { notes } : {}), ...(args.plan?.length ? { plan: args.plan } : {}), doneWhen: args.doneWhen,
      dueAt: due.at, priority: (args.priority ?? 0) as 0 | 1 | 2, parentId, dependsOn: args.dependsOn, widget,
      ...(args.estimateMin ? { estimateMin: args.estimateMin, estimateSource: 'model' as const } : {}), createdBy: ctx.agent.id,
      ...(others && ctx.conversationId ? { givenIn: ctx.conversationId } : {}),
    }, to, route ? { route } : {});
    // The person's own to-do with a time or an estimate goes into their calendar now (dueAt is when they do it).
    const placed = to === HUMAN_ID && (due.at !== undefined || args.estimateMin) ? placeOnMyDay(ctx, task.id, due.at, args.estimateMin) : undefined;
    return answer(ctx, task, { ...(placed?.when ? { calendar: placed.when } : {}), ...(placed?.note ? { calendarNote: placed.note } : {}) });
  },
});

const giveTool = defineTool<{ taskId?: string; to: string; note?: string; model?: string; effort?: Effort }>({
  name: 'tasks.give',
  description: 'Hands a task to someone else, or takes one myself. It keeps its brief, plan and facts; they hear of it at once, and when it ends I hear how.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: TASK_ID_PROPERTY,
      to: { type: 'string', minLength: 1, description: '"me", a colleague or a person by name or id, or "team" – Autark picks one owner now.' },
      note: { type: 'string', maxLength: 4000, description: 'What the new owner needs from me; it lands in its notes as "From <my name>: …".' },
      model: MODEL_PROPERTY, effort: EFFORT_PROPERTY,
    },
    required: ['to'], additionalProperties: false,
  },
  category: 'think',
  describe: (args, ctx) => internal(`Give task ${args.taskId ?? ctx.taskId ?? ''} to ${args.to}`.trim(), args.taskId ?? ctx.taskId),
  async run(args, ctx) {
    const task = requireTask(ctx, args.taskId ?? ctx.taskId);
    const to = receiverOf(ctx, args.to);
    if (typeof to !== 'string') return failure(to.refused);
    const view = await ctx.services.tasks.give(task.id, to, ctx.agent.id, { note: args.note, model: args.model, effort: args.effort, ...(ctx.modelId ? { from: ctx.modelId } : {}), ...(ctx.conversationId ? { givenIn: ctx.conversationId } : {}) });
    return answer(ctx, view);
  },
});

type UpdateArgs = {
  taskId?: string; status?: 'open' | 'waiting'; on?: 'who' | 'task' | 'outside'; who?: string; why?: string; until?: string; plan?: string[]; fact?: string;
  title?: string; notes?: string; doneWhen?: string; dueAt?: string; priority?: number; dependsOn?: string[]; rev?: number;
};

const updateTool = defineTool<UpdateArgs>({
  name: 'tasks.update',
  description: "Keeps a task's state true: its wait, plan, facts and details. The right one is woken and everyone reading it sees where it stands. A wait on someone ends with their line in the task's chat or our 1:1, a wait on a task with its end; outside, I look again at until, else a day later. Asking a person is a task for them (tasks.create), and I wait on that task.",
  inputSchema: {
    type: 'object',
    properties: {
      taskId: TASK_ID_PROPERTY,
      status: { type: 'string', enum: ['open', 'waiting'], description: '"waiting" with on and why; "open" ends a wait.' },
      on: { type: 'string', enum: ['who', 'task', 'outside'], description: 'What moves it next: someone (who), a task, or something outside.' },
      who: { type: 'string', description: 'On who: a person or agent by name or id; on task: its id.' },
      why: { type: 'string', maxLength: 500, description: 'One line.' },
      until: { ...WHEN_PROPERTY, description: `When I look at it again at the latest. ${String(WHEN_PROPERTY.description)}` },
      plan: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 300 }, maxItems: 20, description: 'The steps, one line each, "✓ " before the done ones; it replaces the old plan.' },
      fact: { type: 'string', minLength: 1, maxLength: 500, description: 'One line I learned or decided, kept for whoever works on it next.' },
      title: { type: 'string', minLength: 1, maxLength: 300 }, notes: { type: 'string', maxLength: 20_000 }, doneWhen: { type: 'string', maxLength: 2000 },
      dueAt: WHEN_PROPERTY, priority: { type: 'integer', minimum: 0, maximum: 2 },
      dependsOn: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'The tasks it comes after; it replaces the list.' },
      rev: { type: 'integer', description: 'The rev I read; a newer change wins and I read it again.' },
    },
    additionalProperties: false,
  },
  category: 'think',
  describe: (args, ctx) => internal(`Update task ${args.taskId ?? ctx.taskId ?? ''}`.trim(), args.taskId ?? ctx.taskId),
  async run(args, ctx) {
    const current = requireTask(ctx, args.taskId ?? ctx.taskId);
    const patch: Parameters<typeof ctx.services.tasks.update>[1] = {};
    for (const key of ['title', 'notes', 'doneWhen', 'plan', 'fact'] as const) if (args[key] !== undefined) (patch as Record<string, unknown>)[key] = args[key];
    if (args.priority !== undefined) patch.priority = args.priority as 0 | 1 | 2;
    if (args.dueAt !== undefined) {
      const due = whenOf(ctx, args.dueAt, 'dueAt');
      if ('refused' in due) return failure(due.refused);
      patch.dueAt = due.at;
    }
    if (args.dependsOn !== undefined) { for (const after of args.dependsOn) requireTask(ctx, after); patch.dependsOn = args.dependsOn; }
    if (args.status === 'waiting' || (args.on !== undefined && current.status === 'waiting')) {
      const until = whenOf(ctx, args.until, 'until');
      if ('refused' in until) return failure(until.refused);
      const on = args.on ?? current.waitingOn?.on ?? 'outside';
      let who: string | undefined;
      if (on === 'who') {
        const named = args.who ? receiverOf(ctx, args.who) : { refused: 'A wait on someone names them (who).' };
        if (typeof named !== 'string') return failure(named.refused);
        who = named;
      }
      if (on === 'task') { if (!args.who) return failure('A wait on a task names it (who: its id).'); requireTask(ctx, args.who); }
      const why = args.why?.trim() || current.waitingOn?.why;
      if (!why) return failure('A wait says why, in one line.');
      patch.status = 'waiting';
      patch.waitingOn = { on, why, ...(who ? { who } : {}), ...(on === 'task' ? { ids: [args.who!] } : {}), ...(until.at !== undefined ? { until: until.at } : {}) };
    } else if (args.status === 'open') patch.status = 'open';
    const view = Object.keys(patch).length ? ctx.services.tasks.update(current.id, patch, ctx.agent.id, args.rev) : current;
    return answer(ctx, view, { rev: view.rev });
  },
});

const finishTool = defineTool<{ taskId?: string; status: 'done' | 'dropped'; summary: string; evidence?: Evidence[]; alsoHandled?: string[]; followUps?: Array<{ label: string; scheduleId?: string; taskId?: string }>; quiet?: boolean }>({
  name: 'tasks.finish',
  description: 'Ends a task: done with what came out, or dropped with why it is no longer needed. A task with a doneWhen gets one quick check of the result against it. Its open asks and my own pieces end with it; whoever gave it hears the result.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: TASK_ID_PROPERTY,
      status: { type: 'string', enum: ['done', 'dropped'] },
      summary: { type: 'string', minLength: 1, maxLength: 4000, description: 'The result in a few lines – the person reads it; for dropped, why.' },
      evidence: {
        type: 'array', maxItems: 30, description: 'What shows it: files, links, checks.',
        items: { type: 'object', properties: { kind: { type: 'string', enum: ['file', 'link', 'tool', 'check', 'note', 'screenshot'] }, label: { type: 'string', minLength: 1 }, ref: { type: 'string' } }, required: ['kind', 'label'] },
      },
      alsoHandled: { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 20, description: "Side work and fixes everyone should know, one line each – our team's report." },
      followUps: { type: 'array', maxItems: 20, description: 'What I set up to follow it: a schedule or task, one each.', items: { type: 'object', properties: { label: { type: 'string', minLength: 1 }, scheduleId: { type: 'string' }, taskId: { type: 'string' } }, required: ['label'] } },
      quiet: { type: 'boolean', description: 'Nobody gets a notice.' },
    },
    required: ['status', 'summary'], additionalProperties: false,
  },
  category: 'think',
  describe: (args, ctx) => internal(`${args.status === 'dropped' ? 'Drop' : 'Finish'} task ${args.taskId ?? ctx.taskId ?? ''}`.trim(), args.taskId ?? ctx.taskId),
  async run(args, ctx) {
    const task = requireTask(ctx, args.taskId ?? ctx.taskId);
    const view = ctx.services.tasks.finish(task.id, {
      status: args.status, summary: args.summary, evidence: args.evidence ?? [], alsoHandled: args.alsoHandled, followUps: args.followUps, quiet: args.quiet,
    }, ctx.agent.id);
    return json({ ok: isFinished(view.status), taskId: view.id, status: view.status });
  },
});

const listTool = defineTool<{ whose?: string; status?: string[]; search?: string; chatId?: string; limit?: number }>({
  name: 'tasks.list',
  description: 'Lists tasks as lines with owner, state, due time and next look. Unfinished ones unless I name statuses.',
  inputSchema: {
    type: 'object',
    properties: {
      whose: { type: 'string', description: '"mine" (default), "given" for what I gave, a name or id for theirs, or "all".' },
      status: { type: 'array', items: { type: 'string', enum: STATUSES } },
      search: { type: 'string', maxLength: 200, description: 'Words of the task.' },
      chatId: { type: 'string', description: "One chat's tasks." },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
  category: 'read',
  describe: () => internal('List tasks'),
  async run(args, ctx) {
    if (args.chatId) resolveChat(ctx, args.chatId, { read: true });
    const whose = args.whose?.trim() || (args.search || args.chatId ? 'all' : 'mine');
    const filter: TaskFilter = { status: (args.status as TaskStatus[] | undefined) ?? [...UNFINISHED], search: args.search, conversationId: args.chatId, readableBy: ctx.agent.id, includeSteps: true, limit: args.limit ?? 30 };
    if (whose === 'given') { filter.givenBy = ctx.agent.id; delete filter.status; }
    else if (whose === 'mine') { filter.assigneeKind = 'agent'; filter.assigneeId = ctx.agent.id; }
    else if (whose !== 'all') {
      const who = receiverOf(ctx, whose);
      if (typeof who !== 'string') return failure(who.refused);
      if (who === HUMAN_ID || isPersonId(who)) { filter.assigneeKind = 'human'; if (who !== HUMAN_ID) filter.assigneeId = who; }
      else { filter.assigneeKind = 'agent'; filter.assigneeId = who; }
    }
    const tasks = ctx.services.tasks.list(filter);
    const names = namesFor(ctx.services, profileZone(ctx.services));
    const now = ctx.services.clock.now();
    return text(tasks.length ? tasks.map((task) => taskLine(task, names, now, { owner: true, mine: ctx.agent.id })).join('\n') : 'No tasks.');
  },
});

const getTool = defineTool<{ taskId: string }>({
  name: 'tasks.get',
  description: 'Shows one task whole: brief, plan, facts, pieces, what it waits on, next look, result.',
  inputSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 1 } }, required: ['taskId'], additionalProperties: false },
  category: 'read',
  anyMode: true,
  describe: (args) => internal(`Read task ${args.taskId}`, args.taskId),
  async run(args, ctx) {
    const task = requireTask(ctx, args.taskId);
    const body = renderTask(ctx.services, task, profileZone(ctx.services), '## Task').split('\n');
    return text([...body.slice(0, 3), `Owner: ${ownerWords(ctx, task)}`, ...body.slice(3)].join('\n'));
  },
});

export const taskTools: ToolDef[] = [createTool, giveTool, updateTool, finishTool, listTool, getTool];
