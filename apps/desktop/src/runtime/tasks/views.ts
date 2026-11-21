// TaskView building (split out of tasks/service.ts): the steps and progress of every task – B-080: a step's or
// delegated sub-task's own steps too, so its detail and the agent's task text show them –, the chat's title as
// the owner sees it (B-050 K2: `titleOf`, so a default 1:1 is named after its agent; '' for a chat-free task), whether
// a turn runs for the task.
// Owns: Task → TaskView. Never: writes rows or emits events.

import type { Task, TaskView } from '../../shared/model/tasks.ts';
import type { TaskRepo } from './repo.ts';

export function taskViews(
  repo: TaskRepo, titleOf: (conversationId?: string) => string, running: (taskId: string) => boolean, tasks: Task[],
): TaskView[] {
  const steps = repo.childrenOf(tasks.map(t => t.id));
  const titles = new Map<string, string>();
  return tasks.map(task => {
    const own = steps.get(task.id) ?? [];
    const chat = task.conversationId;
    if (chat && !titles.has(chat)) titles.set(chat, titleOf(chat));
    return {
      ...task, steps: own,
      progress: { done: own.filter(step => step.status === 'done').length, total: own.length },
      conversationTitle: chat ? titles.get(chat) ?? '' : '',
      running: running(task.id),
    };
  });
}
