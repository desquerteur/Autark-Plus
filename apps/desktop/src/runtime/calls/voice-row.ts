// The call voice's own chat row while it is still writing (KI-Runde 17.11.2026, decision 7.3: "each finished sentence goes
// to the reader at once"): the row is opened with the voice's first words as 'streaming', grows with every piece the model
// writes, and is final when the answer ends – the device reads each finished sentence of such a row as it completes
// (shared/voice/conversation.ts). It is the agent's line in the call, as the one-go line was: author the agent, meta.call
// with voice 'talker', the model that said it. An answer that says nothing opens no row, and one that ends saying nothing
// (FIXES-3 E1: its silence written out before the tag) removes the row it had opened.
// Owns: that row's life (open, grow, final) and its announcement. Never: decides what is said (talker.ts), reads it aloud
// (the device does), or touches another author's row.

import { newId } from '../../shared/ids.ts';
import type { Message } from '../../shared/model/chat.ts';
import type { RuntimeServices } from '../contracts.ts';
import { ConversationRepo } from '../chat/conversation-repo.ts';
import { MessageRepo } from '../chat/message-repo.ts';

/** Who says it where: the agent of the call, in which chat and in which call. */
export interface VoiceRowInput { conversationId: string; agentId: string; callId: string; name: string }

export class VoiceRow {
  private readonly services: () => RuntimeServices;
  private input: VoiceRowInput;
  private row: Message | undefined;

  constructor(services: () => RuntimeServices, input: VoiceRowInput) {
    this.services = services;
    this.input = input;
  }

  /** The row as it stands, or undefined while nothing has been said. */
  get message(): Message | undefined { return this.row; }

  /** Who speaks this answer (a team call's `<as …>`); once the row stands its author is fixed. */
  speaks(agentId: string, name: string): void {
    if (!this.row) this.input = { ...this.input, agentId, name };
  }

  /** The words so far: opens the row at the first of them and grows it. */
  write(text: string): void {
    const words = this.said(text);
    if (!words) return;
    if (!this.row) { this.open(words, 'streaming'); return; }
    if (this.row.body === words) return;
    this.save({ ...this.row, body: words });
  }

  /** The whole answer: the row is final (or written in one go), with the model that said it; nothing said leaves no row. */
  close(text: string, model?: string): Message | undefined {
    const words = this.said(text);
    if (!words) {
      if (this.row) this.services().chats.removeMessage(this.row.id, this.row.authorId);
      this.row = undefined;
      return undefined;
    }
    if (this.row) this.save({ ...this.row, body: words, state: 'final', meta: model ? { ...this.row.meta, model } : this.row.meta });
    else this.open(words, 'final', model);
    const final = this.row!;
    this.announce(final);
    return final;
  }

  /** The words as they are stored: no secret value of this company among them. */
  private said(text: string): string {
    const words = text.trim();
    if (!words) return '';
    const s = this.services();
    try { return s.secrets.redact(words); } catch { return words; }
  }

  private open(body: string, state: Message['state'], model?: string): Message {
    const s = this.services();
    const now = s.clock.now();
    const message: Message = {
      id: newId('msg', now), conversationId: this.input.conversationId, seq: 0, authorId: this.input.agentId, authorKind: 'agent',
      kind: 'text', body, attachments: [], mentions: [], priority: 'normal', state, silent: false, createdAt: now,
      meta: { via: 'voice', ...(model ? { model } : {}), call: { id: this.input.callId, participant: `agent:${this.input.agentId}`, name: this.input.name, voice: 'talker' } },
    };
    const convs = new ConversationRepo(s.db);
    s.db.tx(() => {
      message.seq = convs.nextSeq(this.input.conversationId, now);
      new MessageRepo(s.db).insert(message);
      convs.advanceReadIfCaughtUp(this.input.conversationId, this.input.agentId, message.seq);
    });
    this.row = message;
    s.bus.emit('message.created', message);
    return message;
  }

  private save(message: Message): void {
    const s = this.services();
    new MessageRepo(s.db).update(message);
    this.row = message;
    s.bus.emit('message.updated', message);
  }

  /** The finished line reaches the chat list and the delivery, as a line posted in one go does. */
  private announce(message: Message): void {
    const s = this.services();
    try { s.bus.emit('conversation.upserted', s.chats.summary(message.conversationId)); } catch { /* the list catches up by itself */ }
    try { s.delivery.onMessage(message); } catch (error) { s.log.warn('call voice line not delivered', { conversationId: message.conversationId, error: String(error) }); }
  }
}
