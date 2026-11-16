// F22 (owner 16.11.2026: what the person picks in the composer chip right before they send is meant; a value that only
// stayed must not make the AI think it has to take that model). The chat's suggestion per agent (settings.modelHints /
// models / efforts / temperatures, routing/policies.ts chatChoice) gets a server stamp: settings.suggestedAt[agentId], the
// time of its last change. The stamp is set whenever one of those four values of that agent changes (chats.update,
// models.setPolicy, a message's model/effort – chat/sticky-model.ts), goes with the agent's last value, and no client
// sets it (rpc/handlers/chats.ts SETTINGS_KEYS leaves it out; ChatService.update drops one sent along).
// A person's line is 'now' when the stamp lies after that person's previous line in the chat and no later than this
// line – picked for this message; 'after' when it was set after this line (changed since, without a new line); else,
// and in older chats without a stamp, 'earlier' – a value that stayed from before.
// Read by: context/render.ts suggestionTag (the person's line), subconscious/route-turn.ts turnFacts and thoughts.ts.
// Owns: the stamp rule and that reading. Never: routes (the suggestion is information) or writes rows itself.

import type { ConversationSettings, Message } from '../../shared/model/chat.ts';
import type { RuntimeServices } from '../contracts.ts';
import '../../shared/model/model-guide.ts';

/** When the person's suggestion was set, seen from one of their lines. */
export type SuggestionWhen = 'now' | 'after' | 'earlier';

const KEYS = ['models', 'modelHints', 'efforts', 'temperatures'] as const;
const PAGE = 50;
const PAGES = 4; // at most 200 lines back between the pick and the line; longer reads as 'earlier'

/** One agent's raw choice in the chat, comparable as text; '' without one ('auto' counts as none). */
function choiceOf(settings: ConversationSettings, agentId: string): string {
  const values = KEYS.map((key) => {
    const value = (settings[key] as Record<string, unknown> | undefined)?.[agentId];
    return value === undefined || value === 'auto' ? null : value;
  });
  return values.some((value) => value !== null) ? JSON.stringify(values) : '';
}

/**
 * `after` with suggestedAt set by the rule above: agents whose choice changed against `before` are stamped `now` (or lose
 * their stamp with their last value); any suggestedAt `after` brings along is ignored – only this rule writes it.
 */
export function stampSuggestions(before: ConversationSettings, after: ConversationSettings, now: number): ConversationSettings {
  const stamps: Record<string, number> = { ...(before.suggestedAt ?? {}) };
  const agents = new Set<string>(Object.keys(stamps));
  for (const settings of [before, after]) for (const key of KEYS) for (const id of Object.keys((settings[key] as object | undefined) ?? {})) agents.add(id);
  for (const id of agents) {
    const choice = choiceOf(after, id);
    if (!choice) delete stamps[id];
    else if (choice !== choiceOf(before, id)) stamps[id] = now;
  }
  const { suggestedAt: _sent, ...rest } = after;
  return Object.keys(stamps).length ? { ...rest, suggestedAt: stamps } : rest;
}

/** The stamp of the person's suggestion for one agent in one chat; undefined without one (an older chat, or none). */
export function suggestedAt(services: Pick<RuntimeServices, 'chats'>, conversationId: string | undefined, agentId: string): number | undefined {
  if (!conversationId) return undefined;
  const at = services.chats.get(conversationId)?.settings.suggestedAt?.[agentId];
  return typeof at === 'number' && Number.isFinite(at) ? at : undefined;
}

const isLine = (message: Pick<Message, 'kind'>): boolean => message.kind === 'text' || message.kind === 'answer';

/** Whether a stamp `at` was set for `line` (see the header); 'earlier' when unknown or unreadable. */
export function suggestionWhen(services: Pick<RuntimeServices, 'chats'>, at: number | undefined, line: Pick<Message, 'conversationId' | 'seq' | 'createdAt' | 'authorId'>): SuggestionWhen {
  if (at === undefined) return 'earlier';
  if (at > line.createdAt) return 'after';
  try {
    let before = line.seq;
    for (let page = 0; page < PAGES; page += 1) {
      const lines = services.chats.messages(line.conversationId, { beforeSeq: before, limit: PAGE });
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const earlier = lines[i];
        if (earlier.createdAt < at) return 'now'; // reached the time before the pick: no line of theirs in between
        if (earlier.authorKind === 'human' && earlier.authorId === line.authorId && isLine(earlier)) return 'earlier';
      }
      if (lines.length < PAGE) return 'now';
      before = lines[0].seq;
    }
  } catch { /* the history cannot be read: the weaker reading */ }
  return 'earlier';
}

/** The newest line of a person in a chat (text or answer), for a turn that has no line of its own in hand. */
export function newestPersonLine(services: Pick<RuntimeServices, 'chats'>, conversationId: string | undefined): Message | undefined {
  if (!conversationId) return undefined;
  try {
    let before: number | undefined;
    for (let page = 0; page < PAGES; page += 1) {
      const lines = services.chats.messages(conversationId, { ...(before !== undefined ? { beforeSeq: before } : {}), limit: PAGE });
      for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i].authorKind === 'human' && isLine(lines[i])) return lines[i];
      if (lines.length < PAGE) return undefined;
      before = lines[0].seq;
    }
  } catch { /* no history: none */ }
  return undefined;
}

/**
 * Whether the person's suggestion for `agentId` in this chat is meant for what is going on now – set since their line before
 * their newest one ('now', or 'after' it or without a line of theirs) – or stayed from before ('earlier', also without a stamp).
 */
export function suggestionNow(services: Pick<RuntimeServices, 'chats'>, conversationId: string | undefined, agentId: string): SuggestionWhen {
  const at = suggestedAt(services, conversationId, agentId);
  if (at === undefined) return 'earlier';
  const line = newestPersonLine(services, conversationId);
  return line ? suggestionWhen(services, at, line) : 'after'; // set, and no line of theirs since or before it
}
