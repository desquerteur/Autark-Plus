// chat.call (B-081, owner 08.11.2026: "dass die KI den User auch noch anrufen kann … wenn sie jetzt eine wichtige Sache
// hat … und die KI kann sich vorstellen, dass der User gerade Zeit hat"): I ring the person – on every PC window and
// every phone of theirs for 45 s (calls/ring.ts). The call is a row of a chat: the run's chat when the person is in it,
// chatId, else my default 1:1 with the person (chat/direct.ts). `with` brings agents of that chat into the call from the
// start; the chat's other agents listen and speak when a line concerns their work (calls/talker.ts; such a team call goes
// to the device's voice conversation, not realtime voice). A call that already rings or runs in that chat (running: its
// PC reachable) is returned, not rung again. The result says how many of their PCs and phones it reaches now.
// Registered in tools/builtin/index.ts (wave 3); found through tools.find.
// Owns: the arguments and the chat choice. Never: rings without a chat with the person, or speaks in the call itself.

import { HUMAN_ID } from '../../../shared/ids.ts';
import { RING_MS } from '../../../shared/model/call.ts';
import { findOrCreateDirect } from '../../chat/direct.ts';
import { ringsOf } from '../../calls/wiring.ts';
import type { ToolContext, ToolDef } from '../types.ts';
import { failure, json } from '../types.ts';
import { chatIfAny, clip, defineTool, internal, iso } from './util.ts';

const WHY_MAX = 200;
const SAY_MAX = 600;
const WITH_MAX = 5;

/** My note in the result: what happens now (an option, in my words). */
export const CALL_NOTE = `It rings on all their devices for ${RING_MS / 1000} s. When they pick up, my live voice opens with my first sentence (say, else why) and carries the talk; their words reach me as their lines in this chat. A decline or no answer comes back to me as a turn.`;
export const RINGING_NOTE = 'My call already rings in this chat; when they pick up, my live voice opens with my first sentence. What I write there in a <chat> block now they read in the chat.';
/** Added when the call rings in my 1:1 although another chat was meant: the person is not a member there. */
export const MOVED_NOTE = 'It rings in my 1:1 with them, as they are not in that chat.';
export const ALREADY_NOTE = 'A call already runs in this chat: what I write there in a <chat> block is read aloud to them.';

/** The chat the call rings in: the run's chat (or chatId) when the person is in it, else my default 1:1 with them. */
function callChat(ctx: ToolContext, chatId: string | undefined): { id: string; moved: boolean } {
  const s = ctx.services;
  const chat = chatIfAny(ctx, chatId);
  const withPerson = chat && s.chats.members(chat).some((member) => member.memberId === HUMAN_ID && member.leftAt === undefined);
  if (withPerson) return { id: chat, moved: false };
  const id = findOrCreateDirect(s, ctx.agent.id, HUMAN_ID, { createdBy: ctx.agent.id });
  return { id, moved: Boolean(chat) && chat !== id };
}

/** The agents named in `with` (ids or names), each an active agent of the chat other than me; an error text otherwise. */
function brought(ctx: ToolContext, conversationId: string, names: readonly string[]): string[] | string {
  const s = ctx.services;
  const agents = s.chats.members(conversationId).filter((member) => member.kind === 'agent' && member.leftAt === undefined && member.memberId !== ctx.agent.id)
    .map((member) => s.org.get(member.memberId)).filter((agent) => agent && agent.archivedAt === undefined).map((agent) => agent!);
  const out: string[] = [];
  for (const name of names) {
    const wanted = name.trim().toLowerCase();
    const agent = agents.find((one) => one.id.toLowerCase() === wanted || one.name.toLowerCase() === wanted);
    if (!agent) return `${name} is no agent of this chat besides me. with takes agents of the chat the call rings in.`;
    if (!out.includes(agent.id)) out.push(agent.id);
  }
  return out;
}

const callPerson = defineTool<{ why: string; say?: string; with?: string[]; chatId?: string }>({
  name: 'chat.call',
  description: 'Rings the person on all their PCs and phones and talks with them in my live voice. For what a talk settles faster than messages, when they likely have time; a decline or no answer comes back to me as a turn.',
  inputSchema: {
    type: 'object',
    properties: {
      why: { type: 'string', minLength: 1, maxLength: WHY_MAX, description: 'Shows while it rings.' },
      say: { type: 'string', maxLength: SAY_MAX, description: 'My first sentence; default why.' },
      with: { type: 'array', items: { type: 'string' }, maxItems: WITH_MAX, description: 'Agents of the chat in the call from the start.' },
      chatId: { type: 'string', description: 'Default this chat when the person is in it, else my 1:1 with them.' },
    },
    required: ['why'], additionalProperties: false,
  },
  category: 'think',
  describe: (args, ctx) => internal(`Call the person: ${clip(String(args.why ?? ''), 80)}`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const why = String(args.why ?? '').replace(/\s+/g, ' ').trim();
    if (!why) return failure('why says what the call is about (1-200 characters).');
    const rings = ringsOf(ctx.services);
    if (!rings) return failure('Calls are not available in this runtime.');
    let conversationId: string;
    let moved = false;
    try { ({ id: conversationId, moved } = callChat(ctx, args.chatId)); } catch (error) { return failure((error as Error).message); }
    const agents = brought(ctx, conversationId, (args.with ?? []).slice(0, WITH_MAX));
    if (typeof agents === 'string') return failure(agents);
    const running = rings.current(conversationId);
    if (running) return json({ ok: true, already: running.state, callId: running.callId, chatId: conversationId, note: running.state === 'ringing' ? RINGING_NOTE : ALREADY_NOTE });
    const say = args.say?.replace(/\s+/g, ' ').trim();
    const rung = await rings.ring({ conversationId, agentId: ctx.agent.id, why: why.slice(0, WHY_MAX), ...(say ? { say: say.slice(0, SAY_MAX) } : {}), agents });
    return json({ ok: true, callId: rung.callId, chatId: conversationId, until: iso(rung.until), online: rung.online, note: moved ? `${CALL_NOTE} ${MOVED_NOTE}` : CALL_NOTE });
  },
});

export const callTools: ToolDef[] = [callPerson];
