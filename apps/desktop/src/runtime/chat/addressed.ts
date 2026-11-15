// Which person's lines reached an agent as its own (15.11.2026, privacy fix after the installed 0.3.6): delivery marks, per
// agent and chat, the seq of each person's line it woke, folded or steered that agent with – a 1:1, an @mention, the picked
// responder or the lead's fallback, a task waiting on the writer, an important line into a running turn, an answer to the
// agent's ask. The safety net (agents/turn-finish.ts personChat) answers only such a line: a line the agent merely read
// (written before it joined, to the manager, to another responder) never makes its closing text public.
// Owns: the mark (kv ns 'addressed', the newest MAX_MARKS seqs per agent and chat) and its read.
// Never: decides who is addressed (chat/delivery-route.ts, tasks/answer-receipt.ts do) or stores text or names.

import type { RuntimeServices } from '../contracts.ts';
import type { Message } from '../../shared/model/chat.ts';
import { isExternalAgent } from '../bridges/external-agents.ts';
import { KvRepo } from '../store/kv.ts';

const NS = 'addressed';
/** Seqs kept per agent and chat: far more person's lines than wait unanswered in one chat. */
export const MAX_MARKS = 64;

const keyOf = (agentId: string, conversationId: string) => `${agentId}\u0000${conversationId}`;

/** A line of a person (the owner, a colleague, a bridged contact) – no agent's, no external agent's. */
export function personLine(message: Pick<Message, 'authorKind' | 'authorId'>): boolean {
  return message.authorKind === 'human' || (message.authorKind === 'external' && !isExternalAgent(message.authorId));
}

/** Marks a person's line as reaching these agents as their own; a missing database (tests without one) marks nothing. */
export function markAddressed(s: Partial<Pick<RuntimeServices, 'db' | 'log' | 'clock'>>, message: Pick<Message, 'conversationId' | 'seq' | 'authorKind' | 'authorId'>, agentIds: readonly string[]): void {
  if (!s.db || !agentIds.length || !personLine(message) || !(message.seq > 0)) return;
  try {
    const kv = new KvRepo(s.db);
    for (const agentId of agentIds) {
      if (agentId === message.authorId) continue;
      const key = keyOf(agentId, message.conversationId);
      const seqs = kv.get<number[]>(NS, key) ?? [];
      if (seqs.includes(message.seq)) continue;
      kv.set(NS, key, [...seqs, message.seq].sort((a, b) => a - b).slice(-MAX_MARKS), s.clock?.now() ?? Date.now());
    }
  } catch (error) {
    s.log?.warn('addressed mark failed', { conversationId: message.conversationId, error: String(error) });
  }
}

/** The seqs of person's lines in this chat that reached the agent as its own. */
export function addressedSeqs(s: Pick<RuntimeServices, 'db'>, agentId: string, conversationId: string): ReadonlySet<number> {
  try {
    const seqs = new KvRepo(s.db).get<number[]>(NS, keyOf(agentId, conversationId));
    return new Set(Array.isArray(seqs) ? seqs.filter((seq) => Number.isInteger(seq)) : []);
  } catch {
    return new Set();
  }
}
