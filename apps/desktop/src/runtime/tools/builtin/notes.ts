// Shared chat notes for agents: chat.notes.read and chat.notes.write on the Markdown notes every member of a chat
// edits (runtime/notes/store.ts) – the current chat by default, another chat when the agent is a member. A whole
// write replaces the text (last write wins); append adds at the end atomically, so several writers lose nothing.
// Named chat.notes.* so every mode offering chat.* offers them.
// Owns: these tools and their wording. Never: posts a chat message.

import { NOTES_MAX_CHARS } from '../../../shared/model/notes.ts';
import { isPersonId } from '../../../shared/model/people.ts';
import '../../contracts/people.ts';
import { appendNotes, getNotes, saveNotes } from '../../notes/store.ts';
import type { ToolContext } from '../types.ts';
import { CHAT_ID_PROPERTY, failure, json, text } from '../types.ts';
import { authorName, defineTool, internal, iso, resolveChat } from './util.ts';

/** Who wrote last: the person, a person of the organisation or an agent. */
const writer = (ctx: ToolContext, id: string | undefined): string => (!id ? 'someone' : isPersonId(id) ? ctx.services.people?.nameOf(id) ?? 'a colleague' : authorName(ctx, id));

const readNotes = defineTool<{ chatId?: string }>({
  name: 'chat.notes.read',
  description: "Reads a chat's shared notes, a Markdown document every member edits.",
  inputSchema: { type: 'object', properties: { chatId: CHAT_ID_PROPERTY }, additionalProperties: false },
  category: 'read',
  describe: (args, ctx) => internal('Read chat notes', args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const chatId = resolveChat(ctx, args.chatId, { read: true });
    const notes = getNotes(ctx.services, chatId);
    if (notes.version === 0) return text(`Notes of chat ${chatId}: empty. Add to them with chat.notes.write (append).`);
    return text(`Notes of chat ${chatId} · last changed by ${writer(ctx, notes.updatedBy)} at ${iso(notes.updatedAt) ?? '?'}.\n\n${notes.text}`);
  },
});

const writeTool = defineTool<{ chatId?: string; text: string; append?: boolean }>({
  name: 'chat.notes.write',
  description: "Writes a chat's shared notes, whole or appended at the end. A whole write replaces what others wrote too; an append loses nothing.",
  inputSchema: {
    type: 'object',
    properties: { chatId: CHAT_ID_PROPERTY, text: { type: 'string', maxLength: NOTES_MAX_CHARS }, append: { type: 'boolean', description: 'true: adds the text at the end.' } },
    required: ['text'], additionalProperties: false,
  },
  category: 'think',
  describe: (args, ctx) => internal(`${args.append ? 'Add to' : 'Rewrite'} the notes of chat ${args.chatId ?? ctx.conversationId ?? '?'}`, args.chatId ?? ctx.conversationId),
  async run(args, ctx) {
    const chatId = resolveChat(ctx, args.chatId, { read: true });
    if (args.append && !args.text.trim()) return failure('Nothing to add: the text is empty.');
    const notes = args.append ? appendNotes(ctx.services, chatId, args.text, ctx.agent.id) : saveNotes(ctx.services, chatId, args.text, ctx.agent.id);
    return json({ ok: true, chatId, version: notes.version });
  },
});

export const notesTools = [readNotes, writeTool];
