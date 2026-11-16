// The quiet line a task's work leaves when it pauses for an outage: "Paused: … – continues by itself", once per outage –
// not again while it lasts (the task's newest line in its chat says it already) – instead of a failed agent bubble on
// every retry. The one implementation, for turns
// that fail before the engine (agents/turn.ts) and engine outages (agents/turn-finish.ts).
// B-054: a chat-free task writes no status line (its history is its ledger and its runs).
// B-059 #86: the line carries meta.fromRun – the run that met the outage – so the chat can fold it under that run.
// B-080 wave 3 (T06 for chat turns): pausedLine is the line itself – a chat turn the platform re-delivers by itself
// (agents/redelivery.ts) writes it on its first attempt, as the agent (a group shows whose turn paused).
// Owns: that line and its dedupe. Never: decides what an outage is (agents/outages.ts isOutage),
// plans a retry, posts an agent message or writes into a chat the task does not have.

import type { RuntimeServices } from '../contracts.ts';
import type { TaskView } from '../../shared/model/tasks.ts';
import { SYSTEM_ID } from '../../shared/ids.ts';
import { excerpt } from '../../shared/text/chat-names.ts';

/**
 * Feedback 16.11.2026 (F24): with other PCs linked, the PC whose accounts are out – the person reads the line on another
 * PC whose own quota rail may show plenty left, so "every account is limited" read as wrong. One PC alone: no name.
 */
export function pausedWhere(services: Partial<Pick<RuntimeServices, 'devices'>>): string | undefined {
  try {
    const devices = services.devices;
    if (!devices) return undefined;
    const others = devices.list().some((device) => !device.self && device.kind === 'pc' && device.status !== 'revoked');
    const name = devices.self().name.trim();
    return others && name ? excerpt(name, 40) : undefined;
  } catch { return undefined; }
}

/** `runId`: the run that met the outage (meta.fromRun). */
export function outageLine(services: Pick<RuntimeServices, 'chats'> & Partial<Pick<RuntimeServices, 'devices'>>, task: Pick<TaskView, 'id' | 'conversationId'>, reason: string | undefined, runId?: string): void {
  if (!task.conversationId) return; // no chat, no status line
  let said = false;
  try {
    const last = services.chats.messages(task.conversationId, { limit: 30 }).filter((message) => message.taskId === task.id && message.kind !== 'task').at(-1);
    said = last?.kind === 'status' && Boolean((last.meta.status?.details as { outage?: boolean } | undefined)?.outage);
  } catch { said = false; }
  if (said) return; // this outage was said already
  pausedLine(services, task.conversationId, reason, { taskId: task.id, ...(runId ? { runId } : {}) });
}

/**
 * B-080 wave 3: one quiet "Paused: <reason> – continues by itself" status line in `conversationId` – by the system for a
 * task (outageLine), by `authorId` (the agent) for a chat turn; `runId` becomes meta.fromRun. Never throws (cosmetic).
 */
export function pausedLine(services: Pick<RuntimeServices, 'chats'> & Partial<Pick<RuntimeServices, 'devices'>>, conversationId: string, reason: string | undefined, of: { taskId?: string; runId?: string; authorId?: string }): void {
  try {
    const where = pausedWhere(services);
    services.chats.status(conversationId, {
      type: 'note', text: `Paused${where ? ` on ${where}` : ''}: ${excerpt(reason ?? 'no model could be reached', 90)} – continues by itself`, details: { ...(of.taskId ? { taskId: of.taskId } : {}), outage: true },
    }, { authorId: of.authorId ?? SYSTEM_ID, ...(of.taskId ? { taskId: of.taskId } : {}), ...(of.runId ? { fromRun: of.runId } : {}) });
  } catch { /* cosmetic */ }
}
