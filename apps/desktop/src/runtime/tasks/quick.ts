// Quick tasks (the person's task composer, tasks.quickCreate): what the person typed becomes ONE plain task. Title =
// first line, notes = only the rest (todo-draft.ts restNotes); files are kept with the task (Task.files on its row – a
// chat-free task has no anchor message to carry them). Who does it: the target – an agent, a manager's branch (that
// manager), a team ("team" picked among that team's agents), a colleague (handed over in the owner's 1:1 with them),
// 'me' (the person's own to-do) – or, without one, the one owner Autark picks now (tasks/give.ts pickOwner). A retried
// post (same clientId) returns the first task.
// Owns: that entry point. Never: keeps a second task type or leaves the work without an owner.

import { HUMAN_ID } from '../../shared/ids.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import type { Attachment } from '../../shared/model/chat.ts';
import { ORIGINS } from '../../shared/model/origin.ts';
import type { CreateTaskInput, TaskView } from '../../shared/model/tasks.ts';
import type { QuickTaskParams, QuickTaskResult } from '../../shared/model/task-center.ts';
import type { RuntimeServices } from '../contracts.ts';
import { directChat } from '../people/direct-chat.ts';
import type { CreateOptions } from './create.ts';
import { TaskRepo } from './repo.ts';
import { quickDraft, restNotes } from './todo-draft.ts';

export const MAX_QUICK_TEXT = 8000;

type Deps = Pick<RuntimeServices, 'db' | 'clock' | 'chats' | 'tasks' | 'org'>;
type Input = Omit<CreateTaskInput, 'assigneeKind' | 'assigneeId'> & { createdBy: string };
type CreatingTasks = {
  create(input: CreateTaskInput & { createdBy: string }, options?: CreateOptions): TaskView;
  createTo(input: Input, to: string, options?: CreateOptions & { team?: string }): Promise<TaskView>;
};
/** The quick task as the service gets it: the files already resolved to stored attachments. */
export type QuickInput = Omit<QuickTaskParams, 'attachments'> & { attachments?: Attachment[] };

/** The files a quick task was posted with (its row's files; empty for any other task). */
export function quickFiles(db: Deps['db'], taskId: string): Attachment[] {
  try { return new TaskRepo(db).get(taskId)?.files ?? []; } catch { return []; }
}

/** tasks.quickCreate: one task from what the person (or an agent) typed. */
export async function quickCreate(s: Deps, input: QuickInput, createdBy: string): Promise<QuickTaskResult> {
  const text = input.text.trim();
  const attachments = input.attachments ?? [];
  if (!text && !attachments.length) throw new WorkforceError('bad_request', 'Type what should be done.');
  if (text.length > MAX_QUICK_TEXT) throw new WorkforceError('bad_request', 'That is too long for one task.');
  if (input.spaceId && !s.org.spaces().some((space) => space.id === input.spaceId)) {
    throw new WorkforceError('not_found', 'Space not found.', { details: { spaceId: input.spaceId } });
  }
  const tasks = s.tasks as unknown as CreatingTasks;
  const clientId = input.clientId ? `qt:${createdBy}:${input.clientId}` : undefined;
  const options = clientId ? { clientId } : {};
  const title = excerpt(text.split(/\r?\n/)[0].trim() || attachments[0]?.name || 'Files', 120);
  const fields = {
    title, notes: text ? restNotes(text, title) : '', createdBy,
    ...(input.priority !== undefined ? { priority: input.priority } : {}), ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
  };
  const target = input.target;
  if (target?.kind === 'person') {
    const person = target.id.trim();
    return { task: await tasks.createTo({ ...fields, conversationId: directChat(s, HUMAN_ID, person) }, person, { ...options, anchorWith: { authorId: HUMAN_ID, attachments } }) };
  }
  const own = { ...fields, origin: ORIGINS.intake, ...(input.spaceId ? { spaceId: input.spaceId } : {}), ...(attachments.length ? { files: attachments } : {}) };
  if (target?.kind === 'me') {
    return { task: tasks.create({ ...own, assigneeKind: 'human', widget: quickDraft(s, text || title).widget }, options) };
  }
  if (target?.kind === 'agent' || target?.kind === 'branch') {
    const agent = s.org.get(target.id);
    if (!agent || agent.archivedAt !== undefined) throw new WorkforceError('not_found', 'Agent not found.', { details: { agentId: target.id } });
    return { task: await tasks.createTo(own, agent.id, options) };
  }
  return { task: await tasks.createTo(own, 'team', { ...options, ...(target?.kind === 'team' ? { team: target.id } : {}) }) };
}
