// The ONE menu of a task (Work rows, the open task's name dropdown, the task bubble in a chat): Open · Open in chat ·
// Give to… (me, "Team – Autark picks", the agents and – in the owner's session – the people; tasks.give) · Resume ·
// Done · Reopen · Drop · Delete. Text only.
// Owns: which items a task offers and what each one sends. Never: draws the menu (lib/context-menu.tsx) or settles agent
// work as verified.

import type { MenuSection } from '../lib/popover.tsx';
import type { TaskView } from '../../shared/model/tasks.ts';
import { newId } from '../../shared/ids.ts';
import { confirm } from '../lib/dialog.tsx';
import { rpc } from '../lib/rpc.ts';
import { agents, removeById, tasks, todos } from '../lib/store.ts';
import { toastError } from '../lib/toasts.ts';
import { recipientGroups } from './center-model.ts';
import { recipientPeople } from './RecipientMenu.tsx';
import { canOpenChat, closeTask, openTaskDetail, openTaskInChat, selectedTaskId } from './jump.ts';
import { isFinished, ownerOf } from './model.ts';
import { putTask } from './task-cache.ts';
import { canResume } from './waiting.ts';

async function run(call: () => Promise<TaskView | void>, failTitle: string): Promise<void> {
  try {
    const view = await call();
    if (view) putTask(view);
  } catch (error) {
    toastError(error, failTitle);
  }
}

async function dropTask(task: TaskView): Promise<void> {
  if (!(await confirm({ title: 'Drop this task?', body: task.title, confirmLabel: 'Drop task' }))) return;
  await run(() => rpc.call('tasks.finish', { id: task.id, status: 'dropped' }), 'Could not drop it');
}

async function deleteTask(task: TaskView): Promise<void> {
  if (!(await confirm({ title: 'Delete this task?', body: task.conversationId ? 'The task message and its steps are removed from the chat.' : 'The task and its steps are removed.', confirmLabel: 'Delete', danger: true }))) return;
  await run(async () => {
    await rpc.call('tasks.delete', { id: task.id });
    removeById(tasks, task.id);
    removeById(todos, task.id);
    if (selectedTaskId.peek() === task.id) closeTask();
  }, 'Could not delete');
}

const give = (task: TaskView, to: string) => run(() => rpc.call('tasks.give', { id: task.id, to }), 'Could not give it');

/**
 * "Give to…" for every unfinished task: me, "Team – Autark picks" one owner now, then the agents and – in the owner's
 * session – the active people; the current owner is left out.
 */
function giveTo(task: TaskView): MenuSection[] {
  if (isFinished(task.status)) return [];
  const owner = ownerOf(task);
  const mine = owner.kind === 'human';
  const groups = recipientGroups(agents.value, recipientPeople(true));
  const current = (id: string) => 'id' in owner && owner.id === id;
  const pick = (list: ReadonlyArray<{ label: string; hint?: string; target: { kind: string; id: string } }>) => list
    .filter((recipient) => recipient.target.kind === 'agent' || recipient.target.kind === 'person')
    .filter((recipient) => !current(recipient.target.id))
    .map((recipient) => ({ label: recipient.label, hint: recipient.hint, onSelect: () => void give(task, recipient.target.id) }));
  const sections: MenuSection[] = [
    { title: 'Give to…', items: [
      ...(mine ? [] : [{ label: 'Me', onSelect: () => void give(task, 'human') }]),
      { label: 'Team – Autark picks', onSelect: () => void give(task, 'team') },
      ...pick(groups.agents),
    ] },
    { title: 'People', items: pick(groups.people) },
  ];
  return sections.filter((section) => section.items.length > 0);
}

export function taskMenu(task: TaskView): MenuSection[] {
  const finished = isFinished(task.status);
  const mine = ownerOf(task).kind === 'human';
  return [
    { items: [
      { label: 'Open', onSelect: () => openTaskDetail(task.id) },
      ...(canOpenChat(task.conversationId) ? [{ label: 'Open in chat', onSelect: () => openTaskInChat(task) }] : []),
    ] },
    ...giveTo(task),
    { items: [
      ...(canResume(task) ? [{ label: 'Resume', onSelect: () => void run(() => rpc.call('tasks.update', { id: task.id, patch: { status: 'open' } }), 'Could not resume') }] : []),
      ...(!finished && mine && !task.widget ? [{ label: 'Done', onSelect: () => void run(() => rpc.call('tasks.finish', { id: task.id, clientId: newId('up') }), 'Could not complete') }] : []),
      ...(finished ? [{ label: 'Reopen', onSelect: () => void run(() => rpc.call('tasks.update', { id: task.id, patch: { status: 'open' } }), 'Could not reopen') }] : [{ label: 'Drop', onSelect: () => void dropTask(task) }]),
      { label: 'Delete', danger: true, onSelect: () => void deleteTask(task) },
    ] },
  ];
}
