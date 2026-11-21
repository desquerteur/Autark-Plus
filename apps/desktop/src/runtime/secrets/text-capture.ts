// Keys and tokens typed or pasted into a chat go into the secrets catalog (owner 16.11.2026: "dass irgendwie sogar Token
// erkennt … und dann die KI noch bessere Möglichkeit hat, das in Secrets einzubandeln … einfach markieren"). A person's
// message – messages.send and messages.edit from the PC, the phone or the iPhone web app (addKeysSaved) – has every key
// that shows itself by its shape (shared/secrets/token-patterns.ts findKeys) stored before the message is: a key the
// vault already holds becomes its handle, a new one a new secret (directly, no ask – owner 29.10.2026), and the message
// carries secret://<id> in its place, so no chat line, linked PC or agent holds the value. A message that still holds a
// value – one from before, an agent's, a piece the person marks – gets it through secrets.fromMessage (the message's
// "Save as secret"); an agent's own find through secrets.save with that message's seq (tools/builtin/secrets.ts,
// showHandleIn): stored, then its handle stands there instead – the message's author edits it, so agents that read it
// before get the edit notice. The label is the words before the key on its line ("OpenAI key: sk-…" → "OpenAI key"),
// else the key's kind ("API key"); the description is that line with the handle. Captures run one at a time, so a send
// retried while the first one still stores finds the key stored and stores nothing twice. An ```app fence keeps its
// text as written (its page needs it), a marked piece of a secret:// handle is stored already, and an edit that
// chat/message-edits.ts refuses (not the person's own text message) stores nothing.
// Owns: that capture, the replacement in a message and secrets.fromMessage. Never: logs or returns a value, or changes a
// colleague's message (only they change their words).

import { WorkforceError } from '../../shared/errors.ts';
import { HUMAN_ID } from '../../shared/ids.ts';
import type { Message } from '../../shared/model/chat.ts';
import { personalText } from '../../shared/model/message-changes.ts';
import { isPersonId } from '../../shared/model/people.ts';
import type { SecretInfo } from '../../shared/model/security.ts';
import { appRanges, findKeys, inHandle } from '../../shared/secrets/token-patterns.ts';
import type { RuntimeServices } from '../contracts.ts';
import { id, input, onlyKeys, optText } from '../rpc/params.ts';
import type { Handler, HandlerTable, ScopeRule } from '../rpc/table.ts';
import { secretKind } from './capture.ts';
import { newEntryId } from './entry-id.ts';

type Services = Pick<RuntimeServices, 'secrets' | 'chats'>;
interface Piece { value: string; name: string; kind: SecretInfo['kind'] }

let queue: Promise<unknown> = Promise.resolve();

/** One capture at a time (see the header). */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

const HANDLE = /secret:\/\/[A-Za-z0-9_-]+/g;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordy = (char: string | undefined) => char !== undefined && /[A-Za-z0-9_]/.test(char);

/** Every place `value` stands on its own in a text (never inside a longer word). */
function placesOf(value: string): RegExp {
  return new RegExp(`${wordy(value[0]) ? '(?<![A-Za-z0-9_])' : ''}${escape(value)}${wordy(value.at(-1)) ? '(?![A-Za-z0-9_])' : ''}`, 'g');
}

/** Those places outside an app's fence – where a handle goes. */
function places(text: string, value: string): number[] {
  const apps = appRanges(text);
  return [...text.matchAll(placesOf(value))].map((match) => match.index ?? 0).filter((at) => !apps.some(([from, to]) => at >= from && at < to));
}

/** `text` with `handle` in each of those places. */
function withHandle(text: string, value: string, handle: string): string {
  const free = new Set(places(text, value));
  return text.replace(placesOf(value), (match: string, at: number) => (free.has(at) ? handle : match));
}

/** The line of `text` at `at`. */
function lineAt(text: string, at: number): { from: number; line: string } {
  const from = text.lastIndexOf('\n', at - 1) + 1;
  const to = text.indexOf('\n', at);
  return { from, line: text.slice(from, to < 0 ? text.length : to) };
}

/** The words before `at` on its line, after any handle there, without the joining marks ("OpenAI key: " → "OpenAI key"). */
function wordsBefore(text: string, at: number): string {
  const { from } = lineAt(text, at);
  const words = (text.slice(from, at).split(HANDLE).pop() ?? '').replace(/[\s:=>"'`*_#([{-]+$/, '').replace(/^[\s>*#-]+/, '').trim();
  return words.length > 60 ? words.slice(-60).replace(/^\S*\s+/, '') : words;
}

/** A piece's name: the words before it when they say something (four letters or more – "and" does not), else `fallback`. */
function labelAt(text: string, at: number, fallback: string): string {
  const words = wordsBefore(text, at);
  return (words.replace(/[^\p{L}]/gu, '').length >= 4 ? words : fallback).slice(0, 120);
}

/** What a marked piece of text is: a key by its shape, else what the words before it say (a card, a token … a password). */
function markedPiece(text: string, value: string): Piece {
  if (inHandle(text, value)) throw new WorkforceError('bad_request', 'That is a secret handle – its value is stored already.');
  const [at] = places(text, value);
  if (at === undefined) throw new WorkforceError('bad_request', "The marked text is not in this message as a whole (an app's code keeps its own) – mark the value itself.");
  const [key] = findKeys(value);
  if (key && key.value === value) return { value, name: key.name, kind: key.kind };
  return { value, name: 'Secret from chat', kind: secretKind({ label: wordsBefore(text, at) }, value) };
}

/** `text` with each piece stored (or found stored) and replaced by its handle; the ids in order. */
async function capture(s: Services, text: string, pieces: Piece[], conversationId?: string): Promise<{ text: string; ids: string[] }> {
  const ids: string[] = [];
  const fresh: Array<Piece & { id: string }> = [];
  const taken = s.secrets.list().map((info) => ({ id: info.id }));
  for (const piece of pieces) {
    if (pieces.findIndex((other) => other.value === piece.value) !== pieces.indexOf(piece)) continue;
    const known = /^secret:\/\/([A-Za-z0-9_-]+)$/.exec(s.secrets.redact(piece.value))?.[1];
    const pieceId = known ?? newEntryId(taken, s.secrets.groups(), labelAt(text, places(text, piece.value)[0] ?? 0, piece.name));
    if (!known) { taken.push({ id: pieceId }); fresh.push({ ...piece, id: pieceId }); }
    ids.push(pieceId);
    text = withHandle(text, piece.value, `secret://${pieceId}`);
  }
  for (const piece of fresh) {
    const handle = `secret://${piece.id}`;
    const at = text.indexOf(handle);
    const line = lineAt(text, at).line.trim();
    await s.secrets.save({
      id: piece.id, label: labelAt(text, at, piece.name), kind: piece.kind, value: piece.value,
      ...(line !== handle ? { description: line.slice(0, 1000) } : {}), ...(conversationId ? { conversationId } : {}),
    });
  }
  return { text, ids };
}

/** The keys `text` holds stored, and the text with their handles (see the header). */
export function saveKeysIn(s: Services, text: string, conversationId?: string): Promise<{ text: string; ids: string[] }> {
  return inTurn(() => capture(s, text, findKeys(text).map(({ value, name, kind }) => ({ value, name, kind })), conversationId));
}

/** Whether `message` may get a handle in place of a value: no colleague's words, nothing still being written. */
function changeable(message: Message): void {
  if (isPersonId(message.authorId)) throw new WorkforceError('forbidden', 'Only the person who wrote this message can change it.');
  if (message.state === 'streaming') throw new WorkforceError('conflict', 'This message is still being written.');
  if (message.authorKind === 'human' && message.kind !== 'text') throw new WorkforceError('bad_request', 'Only a text message can change.');
}

/** The message with `body`, edited as its own author (see the header). */
function rewrite(s: Services, message: Message, body: string): void {
  if (body !== message.body) s.chats.edit(message.id, body, message.authorId);
}

/** secrets.fromMessage: the marked piece `value`, else every key the message holds, stored and replaced there by its handle. */
export function saveFromMessage(s: Services, messageId: string, value?: string): Promise<string[]> {
  return inTurn(async () => {
    const message = s.chats.message(messageId);
    if (!message) throw new WorkforceError('not_found', 'Message not found.');
    changeable(message);
    const marked = value?.trim();
    const pieces = marked ? [markedPiece(message.body, marked)] : findKeys(message.body).map(({ value: key, name, kind }) => ({ value: key, name, kind }));
    if (!pieces.length) throw new WorkforceError('bad_request', 'This message holds no key.');
    const saved = await capture(s, message.body, pieces, message.conversationId);
    rewrite(s, message, saved.text);
    return saved.ids;
  });
}

/** An agent's secrets.save with a message: the stored value's handle stands there instead; false when the value is not in it. */
export function showHandleIn(s: Services, message: Message, value: string, secretId: string): boolean {
  changeable(message);
  const body = withHandle(message.body, value, `secret://${secretId}`);
  rewrite(s, message, body);
  return body !== message.body;
}

/**
 * Registers messages.send or messages.edit (rpc/handlers/chats.ts) so the person's text has its keys stored first (see the
 * header); an agent's own wf posts as that agent and keeps its words, and an edit of anything but the person's own text
 * message goes straight to the handler, which refuses it. Dictation marks name places in the old text, so a changed text
 * goes without them.
 */
export function addKeysSaved<M extends 'messages.send' | 'messages.edit'>(table: HandlerTable, method: M, handler: Handler<M>, scope: ScopeRule): void {
  table.add(method, (params, ctx) => {
    const o = (params ?? {}) as unknown as { body?: unknown; conversationId?: unknown; id?: unknown; marks?: unknown };
    const agents = ctx.scope.kind === 'owner' && ctx.scope.agentId !== undefined;
    if (agents || typeof o.body !== 'string' || !findKeys(o.body).length) return handler(params, ctx);
    const edited = method === 'messages.edit' && typeof o.id === 'string' ? ctx.services.chats.message(o.id) : undefined;
    if (method === 'messages.edit' && !(edited && personalText(edited) && edited.authorId === HUMAN_ID)) return handler(params, ctx);
    const conversationId = edited?.conversationId ?? (typeof o.conversationId === 'string' ? o.conversationId : undefined);
    if (!conversationId || !ctx.services.chats.get(conversationId)) return handler(params, ctx);
    return saveKeysIn(ctx.services, o.body, conversationId).then(({ text }) => {
      const { marks: _marks, ...rest } = o;
      return handler({ ...rest, body: text } as unknown as Parameters<typeof handler>[0], ctx);
    });
  }, scope);
}

/** secrets.fromMessage (the owner, and a phone with 'chat' over a secure link – like secrets.capture). */
export function registerTextCapture(table: HandlerTable): void {
  table.add('secrets.fromMessage', async (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['messageId', 'value']);
    return { ids: await saveFromMessage(ctx.services, id(o, 'messageId'), optText(o, 'value', { max: 16_384, multiline: true })) };
  }, { capability: 'chat', secure: true });
}
