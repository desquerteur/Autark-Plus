// RPC contract part: My day – the person's own input, planning, the morning briefing and what the person gave others
// (handing an own to-do on is tasks.give). Handlers: runtime/rpc/handlers/day.ts, delegating to services.day
// ('unavailable' while it is missing). Tier 'todo' (a To-do-only phone runs its day). Merged into Methods by module augmentation.
// Owns: these method shapes. Never: behaviour.

import type { Briefing, DayPlanResult } from '../model/calendar.ts';
import type { TaskView } from '../model/tasks.ts';

declare module '../api/methods.ts' {
  interface Methods {
    /** 'todo': My day input – always the person's own; one plain to-do per line. `date` (YYYY-MM-DD): the day shown – typed
     *  while a later day is shown, the to-dos are for that day (Task.window.date). */
    'day.add': { params: { text: string; private?: boolean; clientId?: string; date?: string }; result: { tasks: TaskView[] } };
    /** 'todo': plans `date` (YYYY-MM-DD, profile zone); 'replan' moves only planner blocks not started yet. */
    'day.plan': { params: { date: string; mode: 'plan' | 'replan' }; result: DayPlanResult };
    /** 'todo': the morning briefing of `date`, or null when there is none. */
    'day.briefing': { params: { date: string }; result: Briefing | null };
    /** 'todo': open and recently done tasks the person gave that others own ("Given by me"). */
    'day.handedOff': { params: { since?: number }; result: TaskView[] };
  }
}
