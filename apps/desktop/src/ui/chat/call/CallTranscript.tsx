// A call as one bubble in the chat log (its row's meta.call, runtime/calls/call-log.ts – the same on every device).
// B-085: the bubble is a compact card – a round phone mark (green while it rings or runs), "Call with Ava" / B-081's
// "Call from Ava", "21:24 · 3 lines", on the right "Ringing / Missed / Declined / Running" or how long it ran
// (call-card-model.ts), and a "Transcript" caret under it that opens the whole transcript, both sides (open from the
// start while the call runs). The card's accessible name is callTitle ("Call from Ava · 21:24 · missed"). The rows its
// lines name are folded into it (message-rows.ts) and show here as themselves – in full, with files and their run line
// – in the lines' order; a line whose row this device has not loaded shows the words the call row keeps (callEntries).
// Owns: the card, the disclosure and the transcript's order. Never: loads or copies a second log; renders a message
// itself (MessageItem).

import { useState } from 'preact/hooks';
import { callLength, callRecord, callState, type CallRecord } from '../../../shared/model/call.ts';
import type { Message } from '../../../shared/model/chat.ts';
import { Icon } from '../../lib/ui.tsx';
import { time } from '../../lib/format.ts';
import { chatTitle } from '../../lib/chat-naming.ts';
import { agentMap, conversationMap, knownAgentMap } from '../../lib/store.ts';
import { MessageItem } from '../MessageItem.tsx';
import { callEntries } from '../message-rows.ts';
import { callEnd, callHeading, callMeta } from './call-card-model.ts';

/** "Call · 21:24 · 4:42" or "Call · 21:24 · running"; an agent's call "Call from Ava · 21:24 · ringing / missed / declined". */
export function callTitle(call: Pick<CallRecord, 'startedAt' | 'endedAt' | 'ring'>, now = Date.now(), agentName?: string): string {
  const state = callState(call, now);
  const end = state === 'ringing' || state === 'missed' || state === 'declined' ? state
    : call.endedAt === undefined ? 'running' : callLength(call.endedAt - (call.ring?.answeredAt ?? call.startedAt));
  return `${call.ring ? `Call from ${agentName ?? 'an agent'}` : 'Call'} · ${time(call.startedAt)} · ${end}`;
}

const nameOf = (agentId: string) => knownAgentMap.value.get(agentId)?.name;

/**
 * `messages`: the call's row first, then the rows folded into it.
 */
export function CallTranscript(props: { messages: Message[] }) {
  const row = props.messages[0];
  const call = row ? callRecord(row) : undefined;
  const [open, setOpen] = useState(call?.endedAt === undefined);
  if (!row || !call) return null;
  const now = Date.now();
  const state = callState(call, now);
  const live = state === 'ringing' || state === 'running';
  const chat = conversationMap.value.get(row.conversationId);
  const entries = callEntries(props.messages);
  return (
    <section class="call-transcript" data-message-id={row.id} data-state={state}
      aria-label={callTitle(call, now, call.ring ? agentMap.value.get(call.ring.by)?.name : undefined)}>
      <div class="call-row-card">
        <div class="call-row">
          <span class={`call-row-mark${live ? ' live' : ''}`} aria-hidden="true"><Icon name={live ? 'phone' : 'phone-disconnect'} size={18} /></span>
          <span class="call-row-words">
            <span class="call-row-title">{callHeading(call, nameOf, chat ? chatTitle(chat) : undefined)}</span>
            <span class="call-row-meta tabular">{callMeta(call, now)}</span>
          </span>
          <span class={`call-row-end tabular${live ? ' live' : ''}`}>{callEnd(call, now)}</span>
        </div>
        <button type="button" class="call-transcript-toggle" aria-expanded={open} title={call.name} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'caret-down' : 'caret-right'} size={11} /><span>Transcript</span>
        </button>
      </div>
      {open && <div class="call-transcript-body">
        {!entries.length && <p class="muted">Nothing said yet.</p>}
        {entries.map(({ line, message }, index) => (message
          ? <MessageItem key={message.id} message={message} />
          : <p key={line.messageId ?? index} class="call-line" data-from={line.from.startsWith('agent:') ? 'agent' : 'person'}>
            <strong>{line.name}</strong> <time class="muted tabular">{time(line.at)}</time><br />{line.text}
          </p>))}
      </div>}
    </section>
  );
}
