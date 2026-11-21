// "## My chats" of the live part (owner 13.11.2026: "wo sie einfach die ganzen Chats sieht"): every chat the agent is in,
// one stable line each – `ch_… · <title as I see it>` (archived ones marked; KI-Runde 17.11.2026: a chat a person is in
// marked ` · <their name> reads here`, so the list says at a glance where my lines reach someone), in a fixed order
// (newest chat first), so the section changes only on a join, a leave or a rename. A chat with lines I have not seen yet (after my cursor in it,
// never a line of mine, no status line) gets ` · N new · newest <author> <time>: "<preview>"`; the chat whose new lines
// come in this very input gets no mark. At most MAX_CHATS lines – chats with news always among them.
// Every line the agent receives carries the same chat id (context/render.ts lineLabel); a <chat to="…"> block names it.
// Owns: that section's lines and caps. Never: message text beyond the one preview line, or chats the agent is not in.

import type { RuntimeServices } from '../contracts.ts';
import type { ConversationSummary } from '../../shared/model/chat.ts';
import { chatTitleFor, memberName } from '../chat/titles.ts';
import { dueText, profileZone } from './time.ts';

export const MAX_CHATS = 40;
export const PREVIEW_CHARS = 100;
/** Unseen lines counted per chat (beyond: "N+ new"). */
const MAX_COUNTED = 50;

/** One preview line: whitespace folded, cut at `max` characters with "…". */
export function oneLine(text: string, max = PREVIEW_CHARS): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

type Services = Pick<RuntimeServices, 'chats' | 'org' | 'settings'> & Partial<Pick<RuntimeServices, 'people' | 'clock'>>;

/** " · 3 new · newest Jonas Thu 12 Nov 19:31: "…"" for lines after my cursor in `chat` ('' when none). */
export function newsMark(services: Services, chat: ConversationSummary, agentId: string): string {
  const cursor = chat.members.find((member) => member.memberId === agentId && !member.leftAt)?.readSeq ?? 0;
  const lines = services.chats.messages(chat.id, { afterSeq: cursor, limit: MAX_COUNTED })
    .filter((message) => message.authorId !== agentId && message.kind !== 'status' && message.state !== 'streaming');
  const newest = lines.at(-1);
  if (!newest) return '';
  const zone = profileZone(services);
  const now = services.clock?.now() ?? Date.now();
  const count = lines.length >= MAX_COUNTED ? `${MAX_COUNTED}+` : String(lines.length);
  const author = memberName(services, newest.authorId) ?? 'someone';
  return ` · ${count} new · newest ${author} ${dueText(newest.createdAt, zone, now)}: "${oneLine(newest.body) || '(no text)'}"`;
}

/** " · Gerd reads here" for the people in the chat – the owner, a person of the organisation ('' for a room of agents). */
export function readerMark(services: Services, chat: Pick<ConversationSummary, 'members'>): string {
  const names = chat.members.filter((member) => member.kind === 'human' && !member.leftAt).map((member) => memberName(services, member.memberId) ?? 'a person');
  return names.length ? ` · ${names.join(', ')} ${names.length === 1 ? 'reads' : 'read'} here` : '';
}

/** The stable line of one chat for `agentId`. */
export function overviewLine(services: Services, chat: ConversationSummary, agentId: string): string {
  const title = oneLine(chatTitleFor(services, chat.id, agentId) || 'Untitled chat', 80);
  return `${chat.id} · ${title}${readerMark(services, chat)}${chat.archivedAt !== undefined ? ' · archived' : ''}`;
}

/** The section, '' when the agent is in no chat. `current`: the chat whose new lines this input carries (no mark). */
export function chatOverview(services: Services, agentId: string, current?: string): string {
  const chats = services.chats.list({ forMember: agentId, includeHidden: true })
    .filter((chat) => chat.members.some((member) => member.memberId === agentId && !member.leftAt))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  if (!chats.length) return '';
  const marks = new Map(chats.map((chat) => [chat.id, chat.id === current ? '' : newsMark(services, chat, agentId)]));
  const withNews = chats.filter((chat) => marks.get(chat.id));
  const room = Math.max(0, MAX_CHATS - withNews.length);
  const shown = new Set([...withNews.slice(0, MAX_CHATS), ...chats.filter((chat) => !marks.get(chat.id)).slice(0, room)].map((chat) => chat.id));
  const lines = chats.filter((chat) => shown.has(chat.id)).map((chat) => `${overviewLine(services, chat, agentId)}${marks.get(chat.id)}`);
  if (chats.length > shown.size) lines.push(`(+${chats.length - shown.size} more – chat.list)`);
  return ['## My chats', ...lines].join('\n');
}
