// #34: My day actions belong to the exact reminder occurrence, not the schedule's latest run.
// Observe the existing task flow; never complete or snooze work on the person's behalf.
// Owns: bounded per-occurrence action history and restart reconciliation. Never: task mutations or timing.
import { SNOOZED_REASON } from '../../shared/model/todo-later.ts';
import type { TaskView, ScheduleRun } from '../../shared/model/tasks.ts';
import type { SchedulerDeps } from './scheduler.ts';
import type { ScheduleRepo } from './repo.ts';

type Action = NonNullable<ScheduleRun['personActions']>[number];

export function watchPersonReminders(s: SchedulerDeps, repo: ScheduleRepo): Array<() => void> {
  const sync = (id?: string, removed = false, scheduleId?: string) => {
    const schedules = scheduleId ? [repo.get(scheduleId)].filter((entry): entry is NonNullable<typeof entry> => !!entry) : repo.list({ ownerId: 'human' });
    for (const schedule of schedules) {
      if (schedule.ownerId !== 'human' || schedule.kind !== 'timer' || schedule.taskId) continue;
      let changed = false;
      for (const run of schedule.history ?? []) {
        if (!run.taskId || (id && run.taskId !== id)) continue;
        const task = s.tasks.get(run.taskId);
        if (task && (task.assigneeKind !== 'human' || task.origin?.source !== `schedule:${schedule.id}`)) continue;
        const previous = run.personActions?.at(-1);
        // Removing an already completed item (or later retention cleanup) must not rewrite Done as Skip.
        if (!task && previous?.state === 'done') continue;
        const action = actionOf(task, removed || !task, s.clock.now());
        if (previous?.state === action.state && previous?.until === action.until) continue;
        run.personActions = [...(run.personActions ?? []), action].slice(-10);
        changed = true;
      }
      if (changed) {
        repo.save(schedule);
        s.bus.emit('schedule.upserted', schedule);
      }
    }
  };
  const offs = [
    s.bus.on('task.upserted', task => {
      if (task.assigneeKind === 'human' && task.origin?.source.startsWith('schedule:')) sync(task.id, false, task.origin.source.slice(9));
    }),
    s.bus.on('task.removed', ({ id }) => sync(id, true)),
  ];
  sync();
  return offs;
}

function actionOf(task: TaskView | undefined, removed: boolean, at: number): Action {
  if (removed || task?.status === 'dropped') return { state: 'skipped', at };
  if (task?.status === 'done') return { state: 'done', at };
  if (task?.status === 'waiting' && task.waitingOn?.why === SNOOZED_REASON) return { state: 'snoozed', at, until: task.waitingOn.until };
  return { state: 'pending', at };
}
