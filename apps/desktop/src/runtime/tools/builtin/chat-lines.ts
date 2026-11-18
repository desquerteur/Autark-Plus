// Chat lines of the read tools (B-050 K5): chat.read and chat.search show a message exactly as the agent's context
// does – context/render.ts renderMessages: its label (chat, author, time, #seq), level, task link, reply, the Telegram
// note, files – each message on its own, plus the file ids a <chat files="…"> block can attach again. An edit or delete notice is left out where the context leaves
// it out (render.ts changeNotice over the whole page). One message asked for by seq comes whole, once – its line with
// the full body (render.ts cuts a long body elsewhere and points to chat.read for the rest).
// Owns: that framing. Never: a line format of its own (render.ts owns it), or images.

import type { Message } from '../../../shared/model/chat.ts';
import type { ToolContext } from '../types.ts';
import { renderContext } from '../../context/delta.ts';
import { changeNotice, lineIndex, renderMessages, type RenderContext } from '../../context/render.ts';
import { clip } from './util.ts';

const fileIds = (message: Message) => (message.attachments.length ? `[files: ${message.attachments.map((file) => `${file.name} (${file.fileId})`).join(', ')}]` : '');

/** One message as the context renders it ('' when the context shows nothing for it); `whole`: its body uncut. */
function rendered(rctx: RenderContext, message: Message, whole = false): string {
  return renderMessages(rctx, [message], { images: false, whole }).lines.join('\n');
}

/** chat.read: the page in seq order; `full`: each message with its whole body (chat.read of one line by its seq). */
export function readLines(ctx: ToolContext, messages: Message[], options: { full?: boolean } = {}): string[] {
  const rctx = renderContext(ctx.services, ctx.agent.id);
  const { byId, latest } = lineIndex(messages);
  const out: string[] = [];
  for (const message of messages) {
    if (message.kind === 'status' && changeNotice(rctx, message, byId, latest) === null) continue; // as in the context
    const line = rendered(rctx, message, options.full === true);
    if (!line) continue;
    out.push([line, fileIds(message)].filter(Boolean).join('\n'));
  }
  return out;
}

/** chat.search: each hit as its line (its label names chat and #seq) with the matching snippet for the body. */
export function hitLines(ctx: ToolContext, hits: Array<{ message: Message; snippet: string }>): string[] {
  const rctx = renderContext(ctx.services, ctx.agent.id);
  return hits.map(({ message, snippet }) => {
    const line = rendered(rctx, { ...message, body: clip(snippet, 400), attachments: [], meta: { ...message.meta, marks: undefined } }); // B-082: marks fit only the whole body
    return line || `${message.conversationId} #${message.seq} ${clip(snippet, 400)}`;
  });
}
