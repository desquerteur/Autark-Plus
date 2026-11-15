// The main AI's own call of the subconscious (owner 15.10.2026: "dass sie selbst einen Aufruf als Unterbewusstsein mit
// einer Frage stellen kann"): the subconscious's flow (subconscious/flow.ts – since v1, 14.11.2026, its only run; nothing of it
// runs in the background), with `ask` as the task and as much of the chat as `context` says; the answer comes back as this
// tool's output. A core tool, offered in every mode.
// Owns: the definition and its short spec. Never: decides anything itself or waits beyond the flow's own budget.

import type { ToolDef } from '../types.ts';
import { failure, text } from '../types.ts';
import { clip, defineTool, internal, readChat } from './util.ts';

export const SUBCONSCIOUS_TOOL = 'subconscious';

const subconscious = defineTool<{ ask: string; context?: 'none' | 'recent' | 'chat' }>({
  name: SUBCONSCIOUS_TOOL,
  description: 'Asks my subconscious – a cheap model with my memory and knowledge at hand – anything. Its answer is the output.',
  inputSchema: {
    type: 'object',
    properties: { ask: { type: 'string', minLength: 1, maxLength: 4000 }, context: { type: 'string', enum: ['none', 'recent', 'chat'], description: 'How much of this chat goes along; default recent.' } },
    required: ['ask'], additionalProperties: false,
  },
  category: 'think',
  anyMode: true,
  describe: (args) => internal(`Ask the subconscious: ${clip(args.ask, 80)}`),
  async run(args, ctx) {
    const ask = ctx.services.subconscious.ask;
    if (!ask) return failure('The subconscious is not available here.');
    return text(await ask.call(ctx.services.subconscious, { agent: ctx.agent, conversationId: readChat(ctx), taskId: ctx.taskId, mode: ctx.mode, ask: args.ask, context: args.context, signal: ctx.signal }));
  },
});

export const subconsciousTools: ToolDef[] = [subconscious];
