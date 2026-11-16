// Origin (B-054, owner 29.10.2026 "Läufe und To-dos gehören keinem Chat"): why a wake, a run or a task exists.
// A chat is only one possible origin; a task, a mail, a schedule, a connector or the To-do area are others, and
// nothing downstream asks "which chat?" – a new event source needs no special code.
// Owns: the Origin shape, the well-known source keys and the thread key (13.11.2026: one context per agent – the
// main thread; a split's part has its own). Never: written by an agent – runtime code sets the origin; never a person, a secret or message text.

import { splitThread } from './splits.ts'; // B-057: a split's own thread

/** Why a wake, run or task exists. Always written by runtime code, never by an agent. */
export interface Origin {
  /** 'app:<appId>' | 'schedule:<id>' | 'news' | 'approvals' | 'todo-list' | 'intake' | 'system' (open: new sources add keys). */
  source: string;
  /** Short human label ("New mail in office@…", "To-do area", "Routine \"Morning check\""). */
  label: string;
  /** A scoped mail run's identity of before 16.11.2026; nothing issues it since a run a mail started works fully (rows read back as they are). */
  mailScope?: { appId: string; generation?: string; messageIds: string[] };
  /** Durable mail event identity, not an execution capability. Empty ids mean untrusted/legacy mail. */
  mailProvenance?: { appId: string; generation?: string; messageIds: string[] };
}

/** Well-known origins with a fixed label. Keyed sources (app:, schedule:) are built by their owners. */
export const ORIGINS = {
  todoList: { source: 'todo-list', label: 'To-do area' },
  intake: { source: 'intake', label: 'Quick task' },
  news: { source: 'news', label: 'Task news' },
  approvals: { source: 'approvals', label: 'Approval to review' },
  system: { source: 'system', label: 'System' },
} as const satisfies Record<string, Origin>;

/** The source key of a connected app ('app:<appId>'). */
export const appSource = (appId: string): string => `app:${appId}`;
/** The source key of a schedule ('schedule:<id>'). */
export const scheduleSource = (scheduleId: string): string => `schedule:${scheduleId}`;

/** Longest stored label; longer labels are cut (labels are UI lines, not content). */
export const ORIGIN_LABEL_MAX = 120;

/** A clean origin (trimmed, label cut), or undefined when the source is empty. */
export function cleanOrigin(origin: Origin | undefined): Origin | undefined {
  const source = origin?.source?.trim();
  if (!source) return undefined;
  const label = (origin?.label ?? '').trim().slice(0, ORIGIN_LABEL_MAX) || source;
  const out: Origin = { source, label };
  for (const key of ['mailProvenance', 'mailScope'] as const) {
    const value = origin?.[key];
    if (!value) continue;
    const appId = typeof value.appId === 'string' ? value.appId : '';
    const ids = Array.isArray(value.messageIds) ? value.messageIds : [];
    // Invalid identities lose authority, not their mail-origin marker. No partial widening.
    const valid = source === appSource(appId) && ids.length <= 50 && ids.every(id =>
      typeof id === 'string' && /^INBOX\/[1-9]\d{0,9}\/[1-9]\d{0,9}$/.test(id));
    const generation = typeof value.generation === 'string' && /^[0-9a-f-]{36}$/.test(value.generation) ? value.generation : undefined;
    out[key] = { appId, ...(generation ? { generation } : {}), messageIds: valid ? [...new Set(ids)].sort() : [] };
  }
  return out;
}

/** Exact scope partition, also used when a caller supplies an explicit coalesce key. */
export function mailOriginKey(origin: Origin | undefined): string {
  if (!origin?.mailProvenance && !origin?.mailScope) return '';
  return JSON.stringify([origin.source, origin.mailProvenance ?? null, origin.mailScope ?? null]);
}

/** The thread of an agent's own turns: wherever a wake comes from (a chat, a task, a mail), it is one context. */
export const MAIN_THREAD = 'main';

/**
 * The thread a turn belongs to: its native session, turn state and context ledger are keyed by it. A split's part
 * (`split`: its split id, or a SplitTurn – ToolContext.split) has `split:<splitId>`; every other turn is MAIN_THREAD.
 */
export function threadKey(p: { split?: string | { splitId: string } }): string {
  return p.split ? splitThread(typeof p.split === 'string' ? p.split : p.split.splitId) : MAIN_THREAD;
}
