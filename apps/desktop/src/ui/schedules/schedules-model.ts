// #20: the Schedules tab, pure – what a row and a run line say, the order of the list and the draft of the form
// (an agent job, a message, a reminder) → the `schedules.create` / `schedules.update` parameters. The rule itself
// is the composer's form model (chat/composer/schedule-form.ts: Once / Days / Interval / Advanced) and its words
// (schedule-rule.ts), so a rule reads the same here and in a chat.
// Owns: these words, the order and the draft → request step. Never: RPC, DOM or the clock (`now` is passed in).

import type { Methods } from '../../shared/api/methods.ts';
import type { Schedule, ScheduleRun } from '../../shared/model/tasks.ts';
import { scheduleSpec } from '../chat/composer/schedule-form.ts';
import type { ScheduleForm } from '../chat/composer/schedule-form.ts';

/** What the person creates: a job for an agent (each run is a task it works on), a message, a reminder for an agent, or one for themselves (timer). */
export type DraftType = 'job' | 'message' | 'reminder' | 'timer';

export interface Draft {
  type: DraftType;
  title: string;
  /** The job's instructions, the message's text or the reminder's note. */
  body: string;
  agentId: string;
  /** The chat a message is posted in, or where a job's result goes (the contact's chat; '' = none). */
  conversationId: string;
  important: boolean;
}

export const TYPE_LABEL: Record<DraftType, string> = { job: 'Agent job', message: 'Message', reminder: 'Reminder', timer: 'For me' };
export const TYPE_HINT: Record<DraftType, string> = {
  job: 'An agent works on it at the set time – e.g. researches the news – and can send the result to a contact.',
  message: 'Posts your text into a chat at the set time, as if you wrote it then.',
  reminder: 'Wakes an agent with a note to itself – nothing is posted in a chat.',
  timer: 'Reminds you with a notification at the set time – no agent, nothing is posted.',
};

export const KIND_LABEL: Record<Schedule['kind'], string> = { routine: 'Agent job', message: 'Message', reminder: 'Reminder', timer: 'Timer' };

export function emptyDraft(type: DraftType = 'job', agentId = ''): Draft {
  return { type, title: '', body: '', agentId, conversationId: '', important: false };
}

/** A copy of a stored schedule as a new draft (Duplicate): the same kind, words, agent and chat, the title marked as a copy. */
export function duplicateDraft(schedule: Schedule): Draft {
  return { ...draftOf(schedule), title: `${schedule.title} (copy)` };
}

/** A stored schedule as the form's draft (Edit). The contact's chat and the owner stay as they are (not changeable). */
export function draftOf(schedule: Schedule): Draft {
  const type: DraftType = schedule.kind === 'routine' ? 'job' : schedule.kind === 'reminder' || schedule.kind === 'timer' ? schedule.kind : 'message';
  const body = type === 'job' ? schedule.payload.taskTemplate?.notes ?? schedule.payload.body ?? '' : type === 'reminder' || type === 'timer' ? schedule.payload.note ?? '' : schedule.payload.body ?? '';
  return { type, title: schedule.title, body, agentId: schedule.ownerId === 'human' ? '' : schedule.ownerId, conversationId: schedule.conversationId ?? '', important: schedule.payload.priority === 'important' };
}

/** Whether the form can show and change this schedule (not a to-do's timer – it follows its to-do; the person's own reminders are). */
export function editable(schedule: Schedule): boolean {
  return schedule.kind !== 'timer' || !schedule.taskId;
}

/** Active first, then by the next run (paused ones after, by creation). */
export function sortSchedules(list: readonly Schedule[]): Schedule[] {
  return list.slice().sort((a, b) => Number(b.active) - Number(a.active) || (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.createdAt - b.createdAt);
}

export function matches(schedule: Schedule, query: string, ownerName: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${schedule.title} ${ownerName} ${KIND_LABEL[schedule.kind]}`.toLowerCase().includes(q);
}

/** One line of the history: "Ok", "Skipped – Missed while the app was not running" … */
export function outcomeText(run: ScheduleRun): string {
  const head = { ok: run.manual ? 'Run now' : 'Ran', skipped: 'Skipped', failed: 'Failed', ended: 'Ended' }[run.outcome];
  return run.note ? `${head} · ${run.note}` : head;
}

export type CreateParams = Methods['schedules.create']['params'];

export type Built = { create: CreateParams; update: Omit<Methods['schedules.update']['params'], 'id'> } | { error: string };

/**
 * The request for a draft and the rule of the form: `create` for a new schedule, `update` (title, text, level, rule) for an
 * edit. `error` says what is missing – the page shows it on the line above Save.
 */
export function build(draft: Draft, form: ScheduleForm, now: number): Built {
  const body = draft.body.trim();
  if (draft.type === 'message' && !draft.conversationId) return { error: 'Pick the chat the message is posted in.' };
  if ((draft.type === 'job' || draft.type === 'reminder') && !draft.agentId) return { error: 'Pick the agent.' };
  if (!body) return { error: draft.type === 'job' ? 'Write what the agent should do.' : draft.type === 'message' ? 'Write the message.' : draft.type === 'timer' ? 'Write what to remind you of.' : 'Write the note for the agent.' };
  const rule = scheduleSpec(form, now);
  if ('error' in rule) return { error: rule.error };
  const title = draft.title.trim() || undefined;
  const leveled = draft.type === 'job' || draft.type === 'message'; // reminders and timers have no level
  const priority = leveled && draft.important ? 'important' as const : 'normal' as const;
  return {
    create: {
      kind: draft.type === 'job' ? 'routine' : draft.type, body, spec: rule.spec, ...(title ? { title } : {}), ...(leveled ? { priority } : {}),
      ...(draft.type === 'job' || draft.type === 'reminder' ? { agentId: draft.agentId } : {}), ...(draft.type !== 'timer' && draft.conversationId ? { conversationId: draft.conversationId } : {}),
    },
    update: { body, spec: rule.spec, ...(title ? { title } : {}), ...(leveled ? { priority } : {}) },
  };
}
