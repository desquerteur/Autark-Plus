// B-080 (live 05.–08.11.2026: 19 loop-guard pauses, 169 of the 234 lines before them came from runs that wrote files,
// booked the ledger, sent mails or settled tasks): whether an agent's chat line carries work. It does when its run was
// started by something other than a reply – a task, a schedule, a retry, a hand-over, a child's result, an event …,
// any trigger but 'message' and 'review' – or when the run's journal holds a call that did something
// (agents/turn-types.ts effectful: chat.* is 'think' and never counts; a failed or refused call does not count; the
// subconscious's own lookups, journaled with the run, are not the turn's calls). Such a line is work, not
// back-and-forth: chat/delivery-route.ts counts it in the loop guard like an addressed line.
// Owns: that judgement. Never: changes the guard, the run or the chat.

import type { RuntimeServices } from '../contracts.ts';
import type { RunItem, WakeReason } from '../../shared/model/runs.ts';
import type { ActionCategory } from '../tools/types.ts';
import { effectful } from '../agents/turn-types.ts';

/** Runs that answer a line (a message wake, a quiet pickup or manager review): their lines carry work only by their calls. */
const REPLY_TRIGGERS: ReadonlySet<WakeReason> = new Set<WakeReason>(['message', 'review']);

/** True when the journal holds a tool call of the turn that did something (agents/turn-types.ts effectful) and did not fail. */
export function journalWorked(items: readonly RunItem[], categoryOf: (name: string) => ActionCategory | undefined): boolean {
  const failed = new Set(items.filter((item) => item.kind === 'tool_result' && item.data.ok === false).map((item) => item.data.callId));
  return items.some((item) => {
    if (item.kind !== 'tool_call' || !item.name || item.data.subconscious === true) return false;
    const native = item.data.own === true;
    const stored = typeof item.data.category === 'string' ? item.data.category as ActionCategory : undefined; // the registry journals it
    return effectful({
      name: item.name, native,
      category: native ? undefined : stored ?? categoryOf(item.name),
      ...(item.data.callId !== undefined && failed.has(item.data.callId) ? { ok: false } : {}),
    });
  });
}

/** Whether run `runId`'s lines carry work (see the header); false when the journal cannot say. Throws what the journal throws. */
export function runWorked(s: Partial<Pick<RuntimeServices, 'runs' | 'tools'>>, runId: string): boolean {
  const runs = s.runs;
  if (!runs) return false;
  const trigger = typeof runs.get === 'function' ? runs.get(runId)?.trigger : undefined;
  if (trigger !== undefined && !REPLY_TRIGGERS.has(trigger)) return true;
  if (typeof runs.items !== 'function') return false;
  const tools = s.tools;
  return journalWorked(runs.items(runId), (name) => (typeof tools?.get === 'function' ? tools.get(name)?.category : undefined));
}
