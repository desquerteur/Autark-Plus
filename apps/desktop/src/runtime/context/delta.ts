// delta(): the chat lines an agent has not seen yet, read straight from the canonical message
// store (no intermediate buffer). Up to 60 new lines within CHAT_DAYS before the newest of them (owner 13.11.2026: "ein kleines
// Limit von wie viel Kontext und ein Limit von wie alt … dahinter nicht mehr" – older ones are named with their range and
// chat.read finds them by date), each under its label (render.ts lineLabel: chat, author, time, #seq); the agent's own
// messages are skipped. Never a chat's history: what an agent knew of a chat is in its own record (agents/history-text.ts).
// The agent's own streaming draft never shows, nor a colleague's silent live row (a background run: it holds no text).
// D15: what the agent's live voice said in a call (its own call lines a realtime session or the talker wrote,
// render.ts liveVoiceLine) always shows – "(my live voice said: …)", the newest MAX_VOICE_LINES – so the
// agent knows what the person was told and promised.
// B-058 G10: the new lines carry image inputs (at most 8, render.ts); an image seen earlier is never attached again
// (media.view shows it; turn-prepare.ts normalizes those sent).
// Owns: windowing, the total size budget and lastSeq (never past a colleague's message that is
// still streaming – a silent live row of a background run aside, whose answer comes at the end – or one whose
// attachment text is still being extracted).
// Never: advances any cursor itself.

import type { RuntimeServices } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { Message } from '../../shared/model/chat.ts';
import { displayZone } from './time.ts';
import { humanLabel, liveVoiceLine, renderMessages, type RenderContext } from './render.ts';
import type { AttachmentTexts } from './attachments.ts';
import { CHAT_DAYS } from './ledger/window.ts';

export const DELTA_LIMIT = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** D15: at most this many of the agent's own live-voice lines in one delta (the newest). */
export const MAX_VOICE_LINES = 12;
const TOTAL_CHARS = 48_000;

export interface DeltaResult {
  text: string;
  images: Array<{ path: string; mime: string }>;
  lastSeq: number;
}

export function renderContext(services: RuntimeServices, agentId: string): RenderContext {
  let zone: string | undefined;
  try { zone = services.settings.get().profile.timezone; } catch { zone = undefined; }
  return { services, agentId, humanName: humanLabel(services), zone: displayZone(zone), now: services.clock.now() };
}

/** Keeps the newest lines within the character budget; says how many were left out. */
function budget(lines: string[], max: number): string[] {
  let used = 0;
  const kept: string[] = [];
  for (let index = lines.length - 1; index >= 0; index--) {
    used += lines[index].length + 1;
    if (used > max && kept.length) {
      kept.unshift(`(${index + 1} older line${index === 0 ? '' : 's'} left out for space; chat.read has them)`);
      break;
    }
    kept.unshift(lines[index]);
  }
  return kept;
}

export interface DeltaInput {
  agent: Agent;
  conversationId: string;
  sinceSeq: number;
}

export function buildDelta(services: RuntimeServices, texts: AttachmentTexts, input: DeltaInput): DeltaResult {
  const { agent, conversationId, sinceSeq } = input;
  const ctx = renderContext(services, agent.id);
  const newest = services.chats.messages(conversationId, { limit: DELTA_LIMIT });
  const unseen = newest.filter((message) => message.seq > sinceSeq);
  // The reach: lines older than CHAT_DAYS before the newest unseen one stay out (named below, read by date when they matter).
  const reach = (unseen.at(-1)?.createdAt ?? 0) - CHAT_DAYS * DAY_MS;
  const fresh = unseen.filter((message) => message.createdAt >= reach);
  let lastSeq = sinceSeq;
  for (const message of fresh) lastSeq = Math.max(lastSeq, message.seq);
  // A colleague's message that is still streaming is shown as it stands, but the cursor stops
  // before it: otherwise its final text would never reach this agent (its seq is already read).
  // A silent one (a background run's live row) holds no text: posted, its answer takes a new seq at the end.
  const streaming = fresh.find((message) => message.state === 'streaming' && message.authorId !== agent.id && !message.silent);
  if (streaming) lastSeq = Math.min(lastSeq, streaming.seq - 1);

  // More unseen lines than the window: say so instead of silently dropping them.
  let skippedNote: string | undefined;
  if (fresh.length) {
    const first = unseen.length < newest.length ? unseen[0] : services.chats.messages(conversationId, { afterSeq: sinceSeq, limit: 1 })[0];
    if (first && first.seq < fresh[0].seq) {
      skippedNote = `(Older unseen messages #${first.seq}–#${fresh[0].seq - 1} are not shown – more than the newest ${DELTA_LIMIT} or older than ${CHAT_DAYS} days before the newest; if they matter, I read them with chat.read.)`;
    }
  }

  const own = (message: Message) => message.authorId === agent.id;
  // The agent's own message that is still streaming is this run's draft, and a silent live row only says that someone
  // works in the background – neither is context.
  const settled = fresh.filter((message) => !(message.state === 'streaming' && (own(message) || message.silent)));
  // D15: the own lines the agent's live voice said in a call (the newest few) – what the person was told.
  const voiced = new Set(settled.filter((message) => own(message) && liveVoiceLine(message)).slice(-MAX_VOICE_LINES));
  const visible = settled.filter((message) => !own(message) || voiced.has(message));
  const freshLines = renderMessages(ctx, visible, { texts, images: true, suggestions: true }); // the person's suggestion rides on their new lines (render.ts suggestionTag)
  // Same for a message whose attached file text is still being extracted: the next delta
  // shows it again with the text (a native session would otherwise never receive it).
  if (freshLines.pendingSeq !== undefined) lastSeq = Math.min(lastSeq, freshLines.pendingSeq - 1);
  const newLines = skippedNote ? [skippedNote, ...freshLines.lines] : freshLines.lines;

  return { text: budget(newLines, TOTAL_CHARS).join('\n'), images: freshLines.images, lastSeq };
}

/** Attachments of the new lines delta() would render – the same newest-60 window (for AttachmentTexts.prepare). */
export function unseenAttachments(services: RuntimeServices, input: { agentId: string; conversationId: string; sinceSeq: number }): Message['attachments'] {
  return services.chats.messages(input.conversationId, { limit: DELTA_LIMIT })
    .filter((message) => message.seq > input.sinceSeq && message.authorId !== input.agentId)
    .flatMap((message) => message.attachments);
}
