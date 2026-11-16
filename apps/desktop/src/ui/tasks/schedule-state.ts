// The one state rule of a schedule, as every list of schedules says it (B-080; owner F06, 15.11.2026): active with its
// next run ("next"), active without one known here ("none"), paused by someone ("paused" – pausedBy names who), or
// stopped by itself because its runs are used up ("ended" – a one-shot reminder that fired, an until or maxRuns
// reached). Plus the agent page's split of an agent's schedules: the active ones by their next run, the paused ones
// apart (folded under "Paused (n)" there); the ended ones are left out – their job is done, and the chat's Scheduled
// list still shows them as "Ended". Used by ui/team/AgentDetails.tsx and ui/chat/details/Schedules.tsx.
// Owns: that rule and that split. Never: imports the store, rpc or the DOM.

import type { Schedule } from '../../shared/model/tasks.ts';

export type ScheduleState = 'next' | 'none' | 'paused' | 'ended';

type Stated = Pick<Schedule, 'active' | 'nextAt' | 'pausedBy'>;
type Ordered = Pick<Schedule, 'nextAt' | 'createdAt'>;

export function scheduleState(item: Stated): ScheduleState {
  if (item.active) return item.nextAt !== undefined ? 'next' : 'none';
  return item.pausedBy ? 'paused' : 'ended';
}

/** By the next run, then by creation – one without a next run after every one with. */
export function byNextRun(a: Ordered, b: Ordered): number {
  return (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.createdAt - b.createdAt;
}

/** An agent's schedules for its page: the active ones by their next run, the paused ones the newest first. */
export function agentSchedules<S extends Stated & Ordered & Pick<Schedule, 'ownerId'>>(list: readonly S[], agentId: string): { active: S[]; paused: S[] } {
  const own = list.filter((item) => item.ownerId === agentId);
  return {
    active: own.filter((item) => item.active).sort(byNextRun),
    paused: own.filter((item) => scheduleState(item) === 'paused').sort((a, b) => b.createdAt - a.createdAt),
  };
}
