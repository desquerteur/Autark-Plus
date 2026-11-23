// What others did to the person's own to-dos in the last 24 hours, under "Next" on My day (17.11.2026, package 2): "Ida closed "Release the memory"" with
// "Undo", which takes the change back through tasks.undo (the task comes back as it was; its owner hears why). Read from the change log of the to-dos in the
// list and of those finished in the last day (day-changes.ts); a line goes when it is undone, taken over by a later change, or 24 hours old.
// Owns: this block. Never: writes anything but that one undo, or shows the person's own changes.

import { useState } from 'preact/hooks';
import { excerpt } from '../../shared/text/chat-names.ts';
import type { TaskView } from '../../shared/model/tasks.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { agentName, todos } from '../lib/store.ts';
import { toastError } from '../lib/toasts.ts';
import { useAsync } from '../settings/controls.tsx';
import { todoLabel } from '../tasks/todo-model.ts';
import { agentChanges } from './day-changes.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const SHOWN = 2;
const TITLE_CHARS = 50;

export function DayChanges(props: { now: number }) {
  const { now } = props;
  const mayList = can('tasks.list');
  const mayUndo = can('tasks.undo');
  const listed = todos.value.map((task) => task.id).join(' '); // a to-do reopened here leaves the finished list: read again
  const closed = useAsync<TaskView[]>(
    () => (mayList ? rpc.call('tasks.list', { assigneeKind: 'human', status: ['done', 'dropped'], includeSteps: true, completedSince: now - DAY_MS, limit: 50 }) : Promise.resolve([])),
    [Math.floor(now / 60_000 / 10), mayList, listed], // every ten minutes and when the list changes
  );
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const rows = agentChanges([...todos.value, ...(closed.data ?? [])], now);
  if (!rows.length || !mayUndo) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const undo = async (id: string, changeId: string) => {
    setBusy(id);
    try { await rpc.call('tasks.undo', { id, changeId }); } catch (error) { toastError(error, 'Could not undo'); } finally { setBusy(undefined); }
  };
  return (
    <div class="day-changes" role="group" aria-label="Changed by others">
      {shown.map(({ task, change, verb }) => (
        <p key={task.id} class="day-change">
          <span class="day-change-text">{agentName(change.by)} {verb} "{excerpt(todoLabel(task as TaskView), TITLE_CHARS)}"</span>
          <button type="button" class="text-button day-change-undo" disabled={busy === task.id} onClick={() => void undo(task.id, change.id)}>Undo</button>
        </p>
      ))}
      {rows.length > SHOWN && <button type="button" class="text-button day-next-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all (${rows.length})`}</button>}
    </div>
  );
}
