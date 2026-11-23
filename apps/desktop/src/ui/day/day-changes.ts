// What others changed on the person's own to-dos in the last 24 hours (17.11.2026, "My day" package 2): an agent closed one, moved its time or gave it on –
// read from the task's change log (shared/model/tasks.ts ledger.changes, runtime/tasks/changes.ts), each with the line My day shows ("Ida closed …") and the
// entry "Undo" takes back (tasks.undo). The person's own changes and undone ones are not listed; the latest listed entry of a task is the one offered.
// Owns: this selection and its wording (unit-tested in test/unit/day-ui/day-changes.test.ts). Never: imports the store, rpc or the DOM, or reads a clock.

import { HUMAN_ID, SYSTEM_ID } from '../../shared/ids.ts';
import type { Task, TaskChange } from '../../shared/model/tasks.ts';

export interface AgentChange { task: Pick<Task, 'id' | 'title' | 'status'>; change: TaskChange; verb: string }

/** How long an entry can be undone (runtime/tasks/changes.ts UNDO_WINDOW_MS, which the runtime enforces). */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** The words after the name: "closed", "moved", "gave on". Undefined: the change is not one the person needs to hear about. */
export function changeVerb(change: Pick<TaskChange, 'after' | 'kind'>): string | undefined {
  const status = change.after.status;
  if (status === 'done') return 'closed';
  if (status === 'dropped') return 'closed as not needed';
  if ('dueAt' in change.after && !('status' in change.after)) return 'moved the time of';
  if (change.kind === 'give' && ('assigneeId' in change.after || 'assigneeKind' in change.after)) return 'gave on';
  return undefined;
}

/** Changes by others (agents, colleagues) within 24 hours that are not undone yet, the latest per task, newest first. */
export function agentChanges(tasks: ReadonlyArray<Pick<Task, 'id' | 'title' | 'status' | 'ledger'>>, now: number): AgentChange[] {
  const out: AgentChange[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const latest = (task.ledger.changes ?? []).filter((entry) => entry.undone === undefined && now - entry.at < WINDOW_MS).at(-1);
    if (!latest || latest.by === HUMAN_ID || latest.by === SYSTEM_ID) continue;
    const verb = changeVerb(latest);
    if (verb) out.push({ task, change: latest, verb });
  }
  return out.sort((a, b) => b.change.at - a.change.at);
}
