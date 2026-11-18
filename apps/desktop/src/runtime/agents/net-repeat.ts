// Doppelnachrichten (BEFUND-RUNTIME-JAN §2, 17.11.2026): the safety net (turn-finish.ts) posts an unaddressed final text
// into the chat of the person who woke the turn. It did so also when the same run had already answered there – by
// `wf send` (messages.send with the run's id, rpc/handlers/chats.ts) or a tool – so the person read the answer twice
// (35 times between 13. and 17.11.; the owner, 17.11.: „Dieselbe Nachricht schicke ich nie zweimal“).
// The rule, per chat (an answer only into another chat leaves the person's chat without one, so the net still answers):
// the final text stays in the run log when this run already posted a text message into that chat and either the final
// text repeats it (word overlap ≥ 0.3) or the run did no real work after it (< 3 tool calls and ≤ 120 s). Measured on
// workforce.db 13.–17.11. (workspace\laufzeit-fixes-20261117\messung\dupes_rule2.py): 30 of 35 suppressed; the 5 kept
// each came after 10–49 tool calls with news of their own.
// Owns: that judgement. Never: posts, or touches the outbox rule (out.addressed).

import type { RuntimeServices } from '../contracts.ts';
import { imitatedCall } from '../engines/rebuild-text.ts';

/** BEFUND §3: a final text that only imitates a call ("[ran Write: {…}]") is never posted; the next turn reads this note. */
export const onlyCallRecords = imitatedCall;
export const MIMICKED_NOTE = 'My last turn ended with a written imitation of a tool call ("[ran …]"). Nothing of it ran: a tool runs only as a real tool call.';

const SAME_WORDS = 0.3;
const WORK_CALLS = 3;
const WORK_MS = 120_000;

const words = (text: string): Set<string> => new Set((text.toLowerCase().match(/[\p{L}\p{N}_]{4,}/gu) ?? []));

/** Share of distinct words (4+ letters) two texts have in common, 0–1. */
export function wordOverlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.max(1, left.size + right.size - shared);
}

/** Whether `body`, the run's final text, would repeat what this run already told `chatId` (see the header). */
export function answeredAlready(services: Pick<RuntimeServices, 'db' | 'clock'>, input: { runId: string; agentId: string; chatId: string; body: string }): boolean {
  let before: Array<{ body: string; created_at: number }>;
  try {
    before = services.db.all<{ body: string; created_at: number }>(
      `SELECT body, created_at FROM messages WHERE run_id = ? AND author_id = ? AND conversation_id = ? AND kind = 'text' ORDER BY created_at`,
      [input.runId, input.agentId, input.chatId],
    );
  } catch { return false; }
  if (!before.length) return false;
  if (before.some((message) => wordOverlap(message.body ?? '', input.body) >= SAME_WORDS)) return true;
  const last = before[before.length - 1]!.created_at;
  if (services.clock.now() - last > WORK_MS) return false;
  let calls = 0;
  try {
    calls = services.db.get<{ n: number }>(`SELECT count(*) AS n FROM run_items WHERE run_id = ? AND kind = 'tool_call' AND created_at > ?`, [input.runId, last])?.n ?? 0;
  } catch { return false; }
  return calls < WORK_CALLS;
}
