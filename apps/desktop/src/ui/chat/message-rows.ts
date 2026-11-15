// The message list's rows (split from MessageList.tsx): consecutive status lines form one burst,
// which StatusGroup (MessageItem.tsx) renders as one expandable line under the id of its newest
// line the person sees – agents' edit and delete notices are hidden there (C6). 13.11.2026: only
// real messages – who works shows in the live bar (LiveBar.tsx). A call is one bubble at its row (meta.call with its lines,
// runtime/calls/call-log.ts): the rows its lines name fold into it, wherever they stand, and show there in full
// (callEntries); every other row – an answer that came after the call ended too – stays a row, so nothing is hidden.
// Owns: the grouping, which rendered line a message is found under and a call bubble's entries. Never: renders, scrolls or reads the DOM (MessageList.tsx looks the line up).

import { callRecord, type CallLine } from '../../shared/model/call.ts';
import type { Message } from '../../shared/model/chat.ts';
import { isAgentNotice } from '../../shared/model/message-changes.ts';

export type Row = { kind: 'message'; message: Message } | { kind: 'status'; messages: Message[] } | { kind: 'call'; callId: string; messages: Message[] };

type CallRow = Extract<Row, { kind: 'call' }>;

/** Rows in order; a call's row first in its bubble's messages, then the rows its lines name. */
export function groupRows(list: readonly Message[]): Row[] {
  const rows: Row[] = [];
  const calls = new Map<string, CallRow>(); // call row id → its bubble
  const folded = new Map<string, CallRow>(); // a line's message id → the bubble it folds into
  for (const message of list) {
    const call = callRecord(message);
    if (!call) continue;
    const row: CallRow = { kind: 'call', callId: call.id, messages: [message] };
    calls.set(message.id, row);
    for (const line of call.lines) if (line.messageId) folded.set(line.messageId, row);
  }
  for (const message of list) {
    const call = calls.get(message.id);
    if (call) { rows.push(call); continue; }
    const into = folded.get(message.id);
    if (into) { into.messages.push(message); continue; }
    const last = rows[rows.length - 1];
    if (message.kind === 'status') {
      if (last?.kind === 'status') last.messages.push(message);
      else rows.push({ kind: 'status', messages: [message] });
    } else rows.push({ kind: 'message', message });
  }
  return rows;
}

/**
 * A call bubble's transcript (CallTranscript.tsx): each of its lines with its row when this device has it loaded – shown
 * as the message itself, in full, with files and markdown – else only the line's stored words (a row not loaded here).
 */
export function callEntries(messages: readonly Message[]): Array<{ line: CallLine; message?: Message }> {
  const call = messages[0] ? callRecord(messages[0]) : undefined;
  const rows = new Map(messages.slice(1).map((message) => [message.id, message]));
  return (call?.lines ?? []).map((line) => {
    const message = line.messageId ? rows.get(line.messageId) : undefined;
    return message ? { line, message } : { line };
  });
}

export function rowHas(row: Row, messageId: string): boolean {
  return row.kind === 'message' ? row.message.id === messageId : row.messages.some((message) => message.id === messageId);
}

/**
 * The line a message of a collapsed status burst is found under: the burst's newest line the
 * person sees (C4 jumps). Undefined when no burst holds the message or the burst shows nothing
 * (only agents' notices).
 */
export function burstLineFor(rows: readonly Row[], messageId: string): string | undefined {
  const call = rows.find(row => row.kind === 'call' && rowHas(row, messageId));
  if (call?.kind === 'call') return call.messages[0]?.id;
  const burst = rows.find((row) => row.kind === 'status' && rowHas(row, messageId));
  if (burst?.kind !== 'status') return undefined;
  const shown = burst.messages.filter((message) => !isAgentNotice(message));
  return shown[shown.length - 1]?.id;
}
