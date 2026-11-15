// What a call of the subconscious is told about the chat: as much of it as the main AI's own call asked for, or its recent
// lines before a turn's routing call (route-turn.ts). All of it redacted, every line whole (B-080, live 07.11.2026: a cut at
// 1,500 characters hid 35% of the owner's words); the window keeps the newest agent lines within its cap and every line of
// the person's. The person's lines carry a neutral label: a name in front of every line read as something the message names
// and went into the queries (live 02.11.2026: 14 of 23).
// Owns: which lines go along and their form. Never: changes a message or calls a model.

import type { RuntimeServices } from '../contracts.ts';
import type { Message } from '../../shared/model/chat.ts';
import { HUMAN_ID } from '../../shared/ids.ts';
import { fromPerson } from '../agents/publishing.ts';

const RECENT_CHARS = 6000;
const RECENT_LINES = 12;
const CHAT_LINES = 60;
const CHAT_CHARS = 12_000;
const PERSON = 'The person';

/** How much of the chat goes along with the main AI's own call. */
export type AskContext = 'none' | 'recent' | 'chat';

function redactor(services: RuntimeServices): (text: string) => string {
  return (text) => (services.secrets ? services.secrets.redact(text) : text);
}

function nameOf(services: RuntimeServices, authorId: string): string {
  try {
    if (authorId === HUMAN_ID) return PERSON;
    return services.org.get(authorId)?.name ?? services.people?.nameOf(authorId) ?? 'Contact';
  } catch {
    return PERSON;
  }
}

/** "Name: text" lines, each whole: the newest agent lines within `max` characters, every line of the person's (B-080). */
function linesOf(services: RuntimeServices, messages: readonly Message[], max: number, agentId: string): string[] {
  const redact = redactor(services);
  const lines: string[] = [];
  let used = 0;
  for (const message of [...messages].reverse()) {
    if (message.kind === 'status' || !message.body.trim()) continue;
    const line = `${nameOf(services, message.authorId)}: ${redact(message.body).trim()}`;
    const full = lines.length > 0 && used + line.length > max;
    if (full && !fromPerson(message, agentId)) continue;
    lines.unshift(line);
    used += line.length;
  }
  return lines;
}

/** The chat that goes along with the main AI's own call ('recent' also before a turn's routing call). */
export function askContext(services: RuntimeServices, input: { agentId: string; conversationId?: string; context?: AskContext }): string {
  const context = input.context ?? 'recent';
  if (context === 'none' || !input.conversationId) return '';
  const limit = context === 'chat' ? CHAT_LINES : RECENT_LINES;
  const lines = linesOf(services, services.chats.messages(input.conversationId, { limit }), context === 'chat' ? CHAT_CHARS : RECENT_CHARS, input.agentId);
  return lines.join('\n');
}
