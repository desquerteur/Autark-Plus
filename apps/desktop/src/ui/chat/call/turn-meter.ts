// One log line per call turn (KI-Runde 17.11.2026, B14: no call turn was ever measured end to end). This page sees a
// call turn from the end of the person's speech to the answer going to the reading voice: when the take ended (the
// capture, conversation-audio.ts spoke), when it was heard and by which way (voice.transcribe's `by`), when the
// answer's first row arrived – its first word: a row that streams, or a finished one – and who answered it (the talker
// with its model, the agent's turn with its model, or the program's own line), and when the answer went to the reading
// voice. Once per turn it sends these as numbers in ms after the end of speech (calls.turn); the runtime writes the one
// line. Words said before the line went out (held while it was heard) belong to the same turn; a turn that was not heard
// or sent, or not in a call, sends nothing.
// Owns: a turn's times and its one note. Never: words, a second note for a turn, or a note outside a call.

import type { Message } from '../../../shared/model/chat.ts';

/** What calls.turn carries: ms after the end of speech, and who heard and answered. */
export interface TurnNote { callId: string; heardMs: number; answerMs: number; speakMs: number; heardBy: string; answeredBy: 'talker' | 'turn' | 'program'; model?: string }

interface Turn {
  ended: number;
  heard?: number;
  heardBy?: string;
  conversationId?: string;
  seq?: number;
  callId?: string;
  answer?: number;
  answeredBy?: TurnNote['answeredBy'];
  model?: string;
}

export class TurnMeter {
  private turn: Turn | null = null;
  private readonly now: () => number;
  private readonly send: (note: TurnNote) => void;

  constructor(now: () => number, send: (note: TurnNote) => void) {
    this.now = now;
    this.send = send;
  }

  /** A take's speech ended at `at`: a new turn, unless the turn before has not gone out yet (then this is part of it). */
  spoke(at: number): void {
    if (this.turn && this.turn.seq === undefined) return;
    this.turn = { ended: at };
  }

  /** The loop's RPC answered: voice.transcribe (heard) and the live messages.send (the line went out in its call). */
  answered(method: string, params: unknown, result: unknown): void {
    const turn = this.turn;
    if (!turn) return;
    if (method === 'voice.transcribe' && turn.heard === undefined) {
      const by = (result as { by?: unknown } | undefined)?.by;
      turn.heard = this.now();
      turn.heardBy = typeof by === 'string' ? by : 'unknown';
      return;
    }
    const sent = params as { conversationId?: unknown; speech?: { live?: unknown } } | undefined;
    if (method !== 'messages.send' || sent?.speech?.live !== true || turn.seq !== undefined) return;
    const message = result as { seq?: unknown; meta?: { call?: { id?: unknown } } } | undefined;
    const callId = message?.meta?.call?.id;
    if (turn.heard === undefined || typeof callId !== 'string' || typeof message?.seq !== 'number' || typeof sent.conversationId !== 'string') { this.turn = null; return; }
    Object.assign(turn, { conversationId: sent.conversationId, seq: message.seq, callId });
  }

  /** A row of the chat: the first answer after the line (an agent's, or the program's line in this call). */
  seen(message: Message): void {
    const turn = this.turn;
    if (!turn || turn.seq === undefined || turn.answer !== undefined || message.conversationId !== turn.conversationId || message.seq <= turn.seq) return;
    if (message.kind === 'status' || message.silent) return;
    const program = message.authorKind === 'system' && message.meta.call?.id === turn.callId;
    if (message.authorKind !== 'agent' && !program) return;
    turn.answer = this.now();
    turn.answeredBy = program ? 'program' : message.meta.call?.voice === 'talker' ? 'talker' : 'turn';
    if (typeof message.meta.model === 'string' && message.meta.model) turn.model = message.meta.model.slice(0, 80);
  }

  /** An answer went to the reading voice: the turn's note goes out once. */
  spoken(): void {
    const turn = this.turn;
    if (!turn || turn.answer === undefined || turn.heard === undefined || !turn.callId || !turn.answeredBy) return;
    this.turn = null;
    const after = (at: number) => Math.max(0, Math.round(at - turn.ended));
    this.send({
      callId: turn.callId, heardMs: after(turn.heard), answerMs: after(turn.answer), speakMs: after(this.now()),
      heardBy: turn.heardBy ?? 'unknown', answeredBy: turn.answeredBy, ...(turn.model ? { model: turn.model } : {}),
    });
  }
}
