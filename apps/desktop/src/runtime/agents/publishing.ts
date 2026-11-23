// What an agent's turn leaves in its run journal, and who counts as a person (13.11.2026: the chat is not the agent –
// what it writes is its thinking; only <chat to="…"> blocks reach a chat, agents/chat-out.ts).
// - The final text is journaled as run item(s) kind 'note', name 'Answer', data {answer: true, text, visibility,
//   messageId?} – redacted, split into parts of ≤ ANSWER_PART_CHARS (data.part / data.parts from 2 parts on, at most
//   ANSWER_MAX_PARTS) within the journal's limits. `visibility` 'internal': nothing of it reached a chat (the recap of a
//   new session reads those, context/recent-actions.ts).
// - A person's line: the owner, a person of the organisation, a bridged contact – never the agent's own, a status line,
//   a task anchor or an external agent's (C8); awaitsAnswer: not a quiet one, unless said in a call.
// Owns: those rules and the person's name for runtime texts. Never: posts messages or decides who is woken.

import { HUMAN_ID } from '../../shared/ids.ts';
import type { AnswerVisibility, Message } from '../../shared/model/chat.ts';
import { isExternalAgent } from '../../shared/model/external-agents.ts';
import { isPersonId } from '../../shared/model/people.ts';
import type { RuntimeServices } from '../contracts.ts';
import '../contracts/people.ts';

export const ANSWER_ITEM = 'Answer';
export const ANSWER_PART_CHARS = 4000;
export const ANSWER_MAX_PARTS = 8;

/** A line of a person (see the header). */
export function fromPerson(message: Pick<Message, 'authorId' | 'authorKind' | 'kind'>, agentId: string): boolean {
  return message.authorId !== agentId && (message.kind === 'text' || message.kind === 'answer')
    && (message.authorKind === 'human' || (message.authorKind === 'external' && !isExternalAgent(message.authorId)));
}

/** A person's line that expects an answer: not a quiet one, unless it was said in a call (stored quiet for the talker, calls/talker.ts). */
export function awaitsAnswer(message: Pick<Message, 'authorId' | 'authorKind' | 'kind' | 'silent'> & { meta?: Pick<Message['meta'], 'call'> }, agentId: string): boolean {
  return fromPerson(message, agentId) && (!message.silent || message.meta?.call != null);
}

/** The final text as run item(s) 'Answer' (redacted, split within the journal's limits); never fails the turn. */
export function journalAnswer(services: Pick<RuntimeServices, 'runs' | 'secrets' | 'log'>, runId: string, text: string, visibility: AnswerVisibility, messageId?: string): void {
  if (!text.trim()) return;
  let clean = text;
  try { clean = services.secrets.redact(text); } catch { /* the chat holds the same text; the journal is local */ }
  const parts = splitAnswer(clean);
  try {
    parts.forEach((part, index) => services.runs.item(runId, {
      kind: 'note', name: ANSWER_ITEM, effectStatus: 'none',
      data: { answer: true, text: part, visibility, ...(messageId ? { messageId } : {}), ...(parts.length > 1 ? { part: index + 1, parts: parts.length } : {}) },
    }));
  } catch (error) {
    services.log?.warn('journaling the final answer failed', { runId, error: String(error) });
  }
}

/** Parts of at most ANSWER_PART_CHARS, at most ANSWER_MAX_PARTS (the last one says how much was left out). */
export function splitAnswer(text: string): string[] {
  const parts: string[] = [];
  for (let at = 0; at < text.length && parts.length < ANSWER_MAX_PARTS; at += ANSWER_PART_CHARS) parts.push(text.slice(at, at + ANSWER_PART_CHARS));
  const left = text.length - ANSWER_PART_CHARS * ANSWER_MAX_PARTS;
  if (left > 0) {
    const note = `… [${left} more chars]`;
    parts[parts.length - 1] = `${parts[parts.length - 1].slice(0, ANSWER_PART_CHARS - note.length)}${note}`;
  }
  return parts;
}

/** A name for the person: the owner's profile name, a person's name, a bridged contact's label. */
export function personName(services: Pick<RuntimeServices, 'settings'> & Partial<Pick<RuntimeServices, 'people'>>, id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (id === HUMAN_ID) {
    try { return services.settings.get().profile?.name?.trim() || 'the person'; } catch { return 'the person'; }
  }
  if (isPersonId(id)) return services.people?.nameOf(id) ?? 'my colleague';
  if (id.startsWith('ext:')) return id.split(':').pop() || 'the contact';
  return undefined;
}
