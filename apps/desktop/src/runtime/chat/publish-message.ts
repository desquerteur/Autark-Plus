// A run's answer reaching the chat (B-047 D4), split from chat/service.ts (B-050, to make room there): posted at the
// end of the chat as a plain message carrying its runId (13.11.2026: a run is no row in the history – who works shows in
// the chat's live bar, chat/live.ts). `state` 'failed' or 'stopped' marks a run that ended so (its error in meta.error).
// A quiet answer stays quiet unless it @mentions the person (the owner or a person of the organisation, a bridged
// contact) – a colleague it mentions is still reached (chat/delivery.ts). B-050 K4: an answer the agent marked
// [[important]] (agents/publishing.ts) carries priority 'important' – delivery's brake still applies to it. A quiet answer
// leaves the chat's place in the list alone (nextSeq quiet, as ChatService.send).
// Owns: that write and its announcement. Never: decides the answer's visibility or level (agents/turn-finish.ts does) or
// who is woken or notified (chat/delivery.ts).

import { newId } from '../../shared/ids.ts';
import { WorkforceError } from '../../shared/errors.ts';
import type { Message, MessageMeta } from '../../shared/model/chat.ts';
import type { EngineFile } from '../engines/types.ts';
import { publish, type ChatCore } from './lifecycle.ts';
import { isPersonMention } from './mentions.ts';

/** What a run's answer carries (ChatService.postAgentMessage). */
export interface AnswerFinal { body: string; meta?: MessageMeta; files?: EngineFile[]; silent?: boolean; priority?: Message['priority']; state?: 'final' | 'failed' | 'stopped' }

/** B-047 D4: a quiet agent message stays quiet unless it @mentions a person (the owner, a person of the organisation, a bridged contact). */
export function quietUnlessPerson(silent: boolean | undefined, mentions: readonly string[]): boolean {
  return Boolean(silent) && !mentions.some(isPersonMention);
}

/** Posts a run's answer at the end of the chat; only an active member may. `mentions`: who its body @mentions. */
export function postAgentMessage(core: ChatCore, conversationId: string, agentId: string, runId: string, final: AnswerFinal, mentions: string[]): Message {
  if (!core.convs.members(conversationId).some(m => m.memberId === agentId && !m.leftAt)) {
    throw new WorkforceError('forbidden', 'Only members can post in this chat.', { details: { conversationId } });
  }
  const now = core.s.clock.now();
  const state = final.state ?? 'final';
  const message: Message = {
    id: newId('msg', now), conversationId, seq: 0, authorId: agentId, authorKind: 'agent', kind: 'text', body: final.body,
    attachments: [], mentions, priority: final.priority ?? 'normal', runId, state, silent: quietUnlessPerson(final.silent, mentions), meta: final.meta ?? {}, createdAt: now,
  };
  core.s.db.tx(() => {
    message.seq = core.convs.nextSeq(conversationId, now, { quiet: message.silent }); // a line that draws no one moves no row
    core.msgs.insert(message);
    core.convs.advanceReadIfCaughtUp(conversationId, agentId, message.seq);
  });
  publish(core, message, 'message.created', { deliver: state === 'final' && Boolean(message.body.trim()), files: final.files });
  return message;
}
