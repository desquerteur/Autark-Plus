// Chat membership tools (C2, F-28): agents shape the rooms they work in. Every write goes through
// ChatService with the agent as `by`, so the quiet lines say who did it.
//  - chat.add_members: agents and people of the organisation (per_…, B-050 K3: checked like
//    chat/members-change.ts – active, not revoked; they read from their join on). B-078 D7: never "human" –
//    the owner is reached in the agent's 1:1 with him or a group with him (chat.create), so an internal room
//    never pings him – and never into a 1:1 (chat/members-change.ts DIRECT_STAYS_TWO). A member may be named by
//    name (chat-joins.ts). B-050 K10:
//    colleagues only by the chat's starter and only with agents they may work with (chat-joins.ts).
//  - chat.remove_members: the chat's lead or creator, or a manager in a removed agent's chain;
//    the person only from a chat an agent started (never one they own or the runtime opened
//    for them, e.g. 'From <PC>' by SYSTEM_ID), by its lead or creator;
//    external members only by the lead. Another agent that still owns open work in the chat
//    stays until that work is handed on (its turns could not post there). Removing yourself is
//    leaving.
//  - chat.rename: the lead or the creator – never a name the person gave (settings.namedBy, else
//    a title given at creation by the person).
//  - chat.set_lead: only the current lead hands the lead to another agent member.
// Owns: these rules. Never: changes members, name or lead of app-owned chats (To-do, Customize),
// acts in a chat the agent is not a member of, or brings the person into a room.

import type { ToolContext, ToolDef } from '../types.ts';
import { CHAT_ID_PROPERTY, failure, json, text } from '../types.ts';
import { HUMAN_ID } from '../../../shared/ids.ts';
import type { Conversation, Member } from '../../../shared/model/chat.ts';
import type { TaskStatus } from '../../../shared/model/tasks.ts';
import { DIRECT_STAYS_TWO } from '../../chat/members-change.ts';
import { colleagueRefusal, namedMembers, scopeRefusal } from './chat-joins.ts';
import { authorName, defineTool, internal, memberIds, resolveChat } from './util.ts';

const IDS = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 30 };
const APP_CHAT = 'This chat belongs to the app: its members, name and lead stay as they are.';
const OPEN: TaskStatus[] = ['open', 'waiting'];

/** The person named the chat: they renamed it, or gave its title when they started it. */
export function personNamed(chat: Pick<Conversation, 'titleNamed' | 'createdBy' | 'settings'>): boolean {
  const by = chat.settings.namedBy;
  return by !== undefined ? by === HUMAN_ID : chat.titleNamed && chat.createdBy === HUMAN_ID;
}

/** The chat the call acts on (the agent must be a member of it). */
function chatOf(ctx: ToolContext, chatId: string | undefined): Conversation {
  return ctx.services.chats.get(resolveChat(ctx, chatId))!;
}

const activeIds = (members: Member[]) => members.filter((member) => !member.leftAt).map((member) => member.memberId);

function managerOf(ctx: ToolContext, managerId: string, agentId: string): boolean {
  try { return ctx.services.org.managers(agentId).some((agent) => agent.id === managerId); } catch { return false; }
}

/** Open tasks and steps `agentId` owns in the chat (their turns could not post there once it is out). */
function openWork(ctx: ToolContext, chatId: string, agentId: string): number {
  try {
    return ctx.services.tasks.list({ conversationId: chatId, assigneeKind: 'agent', assigneeId: agentId, status: OPEN, includeSteps: true, limit: 100 }).length;
  } catch { return 0; }
}

/** Why the caller may not remove `member`; undefined when it may. */
function refusal(ctx: ToolContext, chat: Conversation, member: Member, lead: string | undefined): string | undefined {
  const me = ctx.agent.id;
  if (member.memberId === me) return undefined;
  const leadOrCreator = lead === me || chat.createdBy === me;
  if (member.kind === 'human') { // the owner or a colleague (per_…)
    const who = member.memberId === HUMAN_ID ? 'the person' : authorName(ctx, member.memberId);
    const agentStarted = chat.createdBy !== HUMAN_ID && ctx.services.org.get(chat.createdBy) !== undefined;
    if (!agentStarted || member.role === 'owner') return `${who[0].toUpperCase()}${who.slice(1)} stays in this chat: only a chat an agent started can lose them.`;
    return leadOrCreator ? undefined : `Only this chat's lead or creator can take ${who} out.`;
  }
  if (member.kind === 'external') return lead === me ? undefined : "Only this chat's lead removes external members.";
  const name = authorName(ctx, member.memberId);
  if (!leadOrCreator && !managerOf(ctx, me, member.memberId)) return `Only this chat's lead or creator, or a manager of ${name}, can remove them.`;
  const open = openWork(ctx, chat.id, member.memberId);
  return open ? `${name} still owns ${open === 1 ? 'an open task' : `${open} open tasks`} here – hand ${open === 1 ? 'it' : 'them'} on first (tasks.give).` : undefined;
}

/** D7: the person is reached where they talk with me, never by joining a room of ours. */
export const NO_OWNER_INVITE = 'The person is not added to rooms: what they should know I tell them in my 1:1 with them, and a discussion with them I open as a group with chat.create (members: ["human", …]).';

const addMembers = defineTool<{ chatId?: string; members?: string[] }>({
  name: 'chat.add_members',
  description: 'Adds agents or colleagues to a group chat I am in; they read along from then on. A 1:1 stays two, so for more of us I open a group with chat.create; the person I reach in my 1:1 or a group with them.',
  inputSchema: { type: 'object', properties: { chatId: CHAT_ID_PROPERTY, members: { ...IDS, description: 'Agent ids, per_… ids, or names.' } }, additionalProperties: false },
  category: 'think',
  describe: (args, ctx) => internal(`Add ${memberIds(args).length} member(s)`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const chat = chatOf(ctx, args.chatId);
    if (chat.settings.system) return failure(APP_CHAT);
    const ids = namedMembers(ctx, memberIds(args));
    if (typeof ids === 'string') return failure(ids);
    if (!ids.length) return failure('Name the members to add.');
    const present = activeIds(ctx.services.chats.members(chat.id));
    const joining = ids.filter((id) => !present.includes(id));
    if (joining.includes(HUMAN_ID)) return failure(`Nothing was changed. ${NO_OWNER_INVITE}`);
    if (joining.length && chat.settings.direct) return failure(`Nothing was changed. ${DIRECT_STAYS_TWO}`);
    const why = colleagueRefusal(ctx, chat, joining) ?? scopeRefusal(ctx, present, joining);
    if (why) return failure(`Nothing was changed. ${why}`);
    const members = ctx.services.chats.setMembers(chat.id, { add: ids }, ctx.agent.id);
    return json({ ok: true, members: activeIds(members) });
  },
});

const removeMembers = defineTool<{ chatId?: string; members?: string[] }>({
  name: 'chat.remove_members',
  description: 'Removes agents, the person, colleagues or outside members from a chat I am in.',
  inputSchema: { type: 'object', properties: { chatId: CHAT_ID_PROPERTY, members: { ...IDS, description: 'Agent ids, "human", per_… or external member ids.' } }, additionalProperties: false },
  category: 'think',
  describe: (args, ctx) => internal(`Remove ${memberIds(args).length} member(s)`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const chat = chatOf(ctx, args.chatId);
    if (chat.settings.system) return failure(APP_CHAT);
    const ids = memberIds(args);
    if (!ids.length) return failure('Name the members to remove.');
    const members = ctx.services.chats.members(chat.id);
    const lead = ctx.services.chats.lead(chat.id);
    for (const id of ids) {
      const member = members.find((item) => item.memberId === id && !item.leftAt);
      if (!member) return failure(`Nothing was changed: ${id} is not a member of this chat.`);
      const why = refusal(ctx, chat, member, lead);
      if (why) return failure(`Nothing was changed. ${why}`);
    }
    return json({ ok: true, members: activeIds(ctx.services.chats.setMembers(chat.id, { remove: ids }, ctx.agent.id)) });
  },
});

const renameChat = defineTool<{ chatId?: string; title: string }>({
  name: 'chat.rename',
  description: 'Renames a chat I lead or created.',
  inputSchema: { type: 'object', properties: { chatId: CHAT_ID_PROPERTY, title: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['title'], additionalProperties: false },
  category: 'think',
  describe: (args, ctx) => internal(`Rename chat to "${args.title}"`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const chat = chatOf(ctx, args.chatId);
    if (chat.settings.system) return failure(APP_CHAT);
    const me = ctx.agent.id;
    if (ctx.services.chats.lead(chat.id) !== me && chat.createdBy !== me) return failure("Only this chat's lead or creator can rename it.");
    if (personNamed(chat)) return failure('The person named this chat; only they rename it.');
    const title = args.title.trim();
    if (!title) return failure('Give the chat a name.');
    if (title === chat.title) return text('The chat already has this name.');
    const updated = ctx.services.chats.update(chat.id, { title }, me);
    return json({ ok: true, chatId: updated.id, title: updated.title });
  },
});

const setLead = defineTool<{ chatId?: string; agentId: string }>({
  name: 'chat.set_lead',
  description: 'Hands the lead of a chat to another agent in it. The lead answers messages addressed to nobody and picks owners for its team tasks.',
  inputSchema: { type: 'object', properties: { chatId: CHAT_ID_PROPERTY, agentId: { type: 'string', minLength: 1, description: 'The new lead.' } }, required: ['agentId'], additionalProperties: false },
  category: 'think',
  describe: (args, ctx) => internal(`Make ${args.agentId} the chat's lead`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const chat = chatOf(ctx, args.chatId);
    if (chat.settings.system) return failure(APP_CHAT);
    const me = ctx.agent.id;
    if (ctx.services.chats.lead(chat.id) !== me) return failure("Only this chat's current lead can hand the lead on.");
    if (args.agentId === me) return text('I lead this chat already.');
    if (!ctx.services.chats.members(chat.id).some((m) => m.memberId === args.agentId && m.kind === 'agent' && !m.leftAt)) {
      return failure(`${args.agentId} is not an agent in this chat. Add them first (chat.add_members).`);
    }
    ctx.services.chats.setMembers(chat.id, { lead: args.agentId }, me);
    return json({ ok: true, lead: args.agentId });
  },
});

export const chatMemberTools: ToolDef[] = [addMembers, removeMembers, renameChat, setLead];
