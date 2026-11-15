// What an agent writes into chats (13.11.2026, owner: "nur was die KI adressiert"): everything an agent writes is its
// thinking and stays in its run log; a block `<chat to="ID [ID…]" [push|quiet] [files="a, b"]>text</chat>` in any of its
// texts – mid-turn (a text stream or a commentary segment) or the final text – is posted into each chat it names, the moment
// its closing tag arrives. Level: none = a normal message (unread, in-app), `push` = priority 'important' (a notification
// on phone and PC; in a chat with other agents it reaches every agent's running turn – chat/delivery-route.ts), `quiet` =
// silent (history only, no unread, wakes nobody). @Name in the text reaches exactly that member (chat/mentions.ts,
// chat/delivery.ts). Ask blocks and ```app todo blocks in a posted text become to-dos as before (tasks.ingestBlocks).
// A block to a chat the agent is no member of is not posted; the run log notes it in one line and the agent's next turn
// reads it (its repair notes). A block posts once per run (by its addresses and text), however often it is seen again.
// Owns: the block format (chatBlocks), the outbox of one run (ChatOutbox) and what it posted. Never: decides who is woken
// or notified (delivery does), posts a block before its closing tag (but the final text's last open block, at the end).

import type { RuntimeServices } from '../contracts.ts';
import type { Message } from '../../shared/model/chat.ts';
import { appTodosOf, uiBlocksOf } from '../../shared/blocks/parse.ts';
import { importFiles } from '../media/outputs.ts';

export type ChatLevel = 'normal' | 'push' | 'quiet';

/** One addressed block: its chats, level, files (workspace paths, file ids or stored-at paths) and text. */
export interface ChatBlock { to: string[]; level: ChatLevel; files: string[]; body: string }

const OPEN = /<chat\b([^>]*)>/g;
const CLOSE = '</chat>';

function attributes(raw: string): Pick<ChatBlock, 'to' | 'level' | 'files'> {
  const value = (name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(raw)?.[1] ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`).exec(raw)?.[1];
  const bare = raw.replace(/\b\w+\s*=\s*("[^"]*"|'[^']*')/g, ' ');
  const level: ChatLevel = /\bpush\b/.test(bare) ? 'push' : /\bquiet\b/.test(bare) ? 'quiet' : 'normal';
  const to = [...new Set((value('to') ?? '').split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))];
  const files = (value('files') ?? '').split(',').map((file) => file.trim()).filter(Boolean);
  return { to, level, files };
}

/**
 * The complete blocks in `text`, in order, and `rest` – the text outside them. `final`: an open block at the end counts as
 * closed there (the turn is over, nothing more comes); otherwise it stays out of `blocks` and `open` is true.
 */
export function chatBlocks(text: string, options: { final?: boolean } = {}): { blocks: ChatBlock[]; rest: string; open: boolean } {
  const blocks: ChatBlock[] = [];
  const outside: string[] = [];
  let at = 0;
  let open = false;
  OPEN.lastIndex = 0;
  for (let match = OPEN.exec(text); match; match = OPEN.exec(text)) {
    const start = match.index + match[0].length;
    const end = text.indexOf(CLOSE, start);
    if (end < 0 && !options.final) { open = true; break; }
    outside.push(text.slice(at, match.index));
    blocks.push({ ...attributes(match[1]), body: text.slice(start, end < 0 ? text.length : end).trim() });
    at = end < 0 ? text.length : end + CLOSE.length;
    OPEN.lastIndex = at;
  }
  outside.push(text.slice(at));
  return { blocks, rest: outside.join('').replace(/\n{3,}/g, '\n\n').trim(), open };
}

/** The repair note of a block to a chat I am no member of (the agent's next turn reads it). */
export const notMemberNote = (id: string) => `My <chat to="${id}"> block was not posted: I am no member of a chat ${id} (chat.list shows mine).`;

/** The outbox of one run: posts each block once, as soon as it is complete. */
export class ChatOutbox {
  /** Chats this run posted into, in order (the safety net and the run log read it). */
  readonly posted: string[] = [];
  /** One-line notes about blocks that were not posted. */
  readonly notes: string[] = [];
  private readonly seen = new Set<string>();
  private buffer = '';
  private queue: Promise<void> = Promise.resolve();
  private readonly services: RuntimeServices;
  private readonly agentId: string;
  private readonly runId: string;
  /** A call's chat: its blocks are spoken with the call's answer at the end, never posted on their own. */
  private readonly skip?: string;

  constructor(services: RuntimeServices, input: { agentId: string; runId: string; skip?: string }) {
    this.services = services;
    this.agentId = input.agentId;
    this.runId = input.runId;
    this.skip = input.skip;
  }

  /** Whether the run addressed any chat (posted, or tried to). */
  get addressed(): boolean {
    return this.posted.length > 0 || this.notes.length > 0;
  }

  /** A streamed text delta: complete blocks post now, an open one waits for its closing tag. */
  text(delta: string): void {
    this.buffer += delta;
    const end = this.buffer.lastIndexOf(CLOSE);
    if (end < 0) return;
    this.take(this.buffer.slice(0, end + CLOSE.length));
    this.buffer = this.buffer.slice(end + CLOSE.length);
  }

  /** A whole text (a commentary segment, the final text): its complete blocks post; `final` closes an open one at its end. */
  segment(text: string, final = false): ChatBlock[] {
    if (final) this.buffer = '';
    return this.take(text, final);
  }

  /** Waits for every post started so far. */
  async done(): Promise<void> {
    await this.queue;
  }

  private take(text: string, final = false): ChatBlock[] {
    const { blocks } = chatBlocks(text, { final });
    for (const block of blocks) {
      const key = `${block.level}|${block.to.join(',')}|${block.body}`;
      if (!block.body || !block.to.length || this.seen.has(key)) continue;
      this.seen.add(key);
      this.queue = this.queue.then(() => this.post(block)).catch((error) => this.services.log.warn('chat block not posted', { runId: this.runId, error: String(error) }));
    }
    return blocks;
  }

  private member(conversationId: string): boolean {
    try { return this.services.chats.members(conversationId).some((member) => member.memberId === this.agentId && !member.leftAt); } catch { return false; }
  }

  private async post(block: ChatBlock): Promise<void> {
    for (const conversationId of block.to) {
      if (conversationId === this.skip) continue;
      if (!this.member(conversationId)) { this.note(notMemberNote(conversationId)); continue; }
      const files = block.files.length ? await importFiles(this.services, this.agentId, block.files, conversationId) : undefined;
      if (files?.errors.length) this.note(`Files of my block to ${conversationId}: ${files.errors.join(' ')}`);
      const message = this.services.chats.send({
        conversationId, body: block.body, authorId: this.agentId, authorKind: 'agent', runId: this.runId,
        priority: block.level === 'push' ? 'important' : 'normal', silent: block.level === 'quiet',
        ...(files?.attachments.length ? { attachments: files.attachments } : {}),
      });
      this.posted.push(conversationId);
      todos(this.services, message);
    }
  }

  private note(line: string): void {
    this.notes.push(line);
    try { this.services.runs.item(this.runId, { kind: 'note', data: { chatOut: line }, effectStatus: 'none' }); } catch { /* the log line below stays */ }
    this.services.log.info('chat block not posted', { runId: this.runId, note: line });
  }
}

/** Ask blocks and ```app todo blocks of a posted message become the person's to-dos, in their own savepoint (a failing one is logged). */
export function todos(services: RuntimeServices, message: Message): void {
  const blocks = uiBlocksOf(message.body);
  if (!blocks.length && !appTodosOf(message.body).length) return;
  try {
    services.db.tx(() => services.tasks.ingestBlocks(message, blocks.map((item) => item.block), blocks.map((item) => item.index)));
  } catch (error) {
    services.log?.warn('chat block to-dos failed', { messageId: message.id, error: String(error) });
  }
}
