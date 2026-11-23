// Keys in a message's text (owner 16.11.2026: "wenn es ein Token gibt … Willst du das sehen wirklich?", "einfach
// markieren"). The runtime stores a key the person sends before the message is stored (runtime/secrets/text-capture.ts),
// so the message carries its handle and one notice in the status line says so. A message that still holds a key – one
// from before, an agent's, a colleague's – shows each masked (shared/secrets/token-patterns.ts maskKey) with one quiet
// line under its text: Show (seeing it is the person's own choice; Hide masks it again) and Save as secret, which stores
// every key there and puts its handle in its place (secrets.fromMessage). A piece the person marks with the mouse is
// saved the same way from the message's menu (MessageActions.tsx "Save as secret").
// Owns: which keys a message shows masked, the masked text, these calls and their notices. Never: renders (MessageItem.tsx)
// or keeps a value anywhere – only secrets.fromMessage gets one.

import type { Message } from '../../shared/model/chat.ts';
import { isPersonId } from '../../shared/model/people.ts';
import { findKeys, handleCount, inHandle, maskKey, type FoundKey } from '../../shared/secrets/token-patterns.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { pushToast, toastError } from '../lib/toasts.ts';

/** The keys a message's text holds (a status line or a task card has none to show). */
export function keysIn(message: Pick<Message, 'kind' | 'body'>): FoundKey[] {
  return message.kind === 'status' || message.kind === 'task' ? [] : findKeys(message.body);
}

/** The text with each key masked. */
export function maskedBody(body: string, keys: readonly FoundKey[]): string {
  let out = '';
  let at = 0;
  for (const key of keys) { out += body.slice(at, key.start) + maskKey(key); at = key.end; }
  return out + body.slice(at);
}

/** The words of the line under a text with keys. */
export const keysLine = (count: number): string => (count === 1 ? 'A key is hidden here' : `${count} keys are hidden here`);

/** Whether this connection may store a value of `message` and put the handle there: never a colleague's words, nothing still being written. */
export function canSaveFrom(message: Pick<Message, 'authorId' | 'authorKind' | 'kind' | 'state'>): boolean {
  return can('secrets.fromMessage') && message.state === 'final' && !isPersonId(message.authorId) && (message.authorKind !== 'human' || message.kind === 'text');
}

/** The marked piece the menu offers to save ('' when there is none, it is not this message's own text, or a piece of a handle). */
export function markedSecret(message: Message, selected: string): string {
  const piece = selected.trim();
  return piece && message.body.includes(piece) && !inHandle(message.body, piece) && canSaveFrom(message) ? piece : '';
}

/** Stores `value` of the message (absent: every key it holds) and puts the handle there; false when it failed (a notice says why). */
export async function saveAsSecret(message: Pick<Message, 'id'>, value?: string): Promise<boolean> {
  try {
    const { ids } = await rpc.call('secrets.fromMessage', { messageId: message.id, ...(value ? { value } : {}) });
    pushToast({ title: ids.length === 1 ? 'Saved in Secrets' : `Saved ${ids.length} keys in Secrets`, body: 'The message shows the handle now; agents use it, never the value.', tone: 'info' }, 4000);
    return true;
  } catch (error) {
    toastError(error, 'Not saved as secret');
    return false;
  }
}

/** After a send: one notice when the runtime stored keys of the text (`sent`) and the message carries their handles (`stored`). */
export function noteSavedKeys(sent: string, stored: string): void {
  const added = handleCount(stored) - handleCount(sent);
  if (added > 0) pushToast({ title: added === 1 ? 'Saved 1 key in Secrets' : `Saved ${added} keys in Secrets`, body: 'Your message carries its handle; agents never see the value.', tone: 'info' }, 4000);
}
