// Sending the composer's draft (split from Composer.tsx): Send, and /important or /silent with text
// (composer/slash.ts) and the Plus menu's levels send the whole draft – the text (or the command's text), its
// files, secret handles, how it was dictated (SM8) and its hidden marks (B-082 `marks`, only when it has some) and the message it replies to – at one level.
// B-083 (owner 08.11.: "Die soll es einfach selbst erkennen"): no Ultra hint any more – the agent splits itself when it pays.
// The field empties at once and the draft is fresh for the next message (level back to normal); a failed
// send gives everything back, the text as it was typed.
// The composer sends `silent: true` only for a silent message, never `silent: false`.
// 16.11.2026: a key in the text is stored by the runtime before the message (runtime/secrets/text-capture.ts); the
// message comes back with its handle, and one notice in the status line says so (message-keys.ts noteSavedKeys).
// Owns: that one send path. Never: parses commands (slash.ts), or renders.

import { newId } from '../../../shared/ids.ts';
import type { MessageLevel } from '../../../shared/model/chat.ts';
import { rpc } from '../../lib/rpc.ts';
import { toastError } from '../../lib/toasts.ts';
import { clearDraft, draftFor, updateDraft } from './draft.ts';
import { takeDraftSpeech } from './draft-speech.ts';
import { marksFor } from './draft-marks.ts';
import { heldKey } from '../../lib/take-store.ts';
import { noteSavedKeys } from '../message-keys.ts';

export interface DraftSend {
  conversationId: string;
  /** The text to send: the draft's, or a level command's text. */
  body: string;
  level: MessageLevel;
  /** The agents the sent text @mentions (composer/target.ts mentionsIn). */
  mentions: (body: string) => string[];
}

/** B-082: true (with a notice) while the draft still holds a recording that waits in this page for the connection –
 *  it is no file yet, so the draft stays as it is until it has uploaded. */
export function heldWaiting(conversationId: string): boolean {
  if (!draftFor(conversationId).peek().attachments.some((a) => heldKey(a.fileId))) return false;
  toastError(new Error('A recording is still waiting for the connection.'), 'Not sent yet');
  return true;
}

/** Sends the chat's draft as `body` at `level`; false when it failed (a notice says why, the draft is back). */
export async function sendDraft(send: DraftSend): Promise<boolean> {
  const { conversationId, level } = send;
  if (heldWaiting(conversationId)) return false;
  const saved = draftFor(conversationId).peek();
  const spoken = takeDraftSpeech(conversationId);
  clearDraft(conversationId); // optimistic: the field empties at once, restored on error (with its speech)
  const body = send.body.trim();
  const attachments = saved.attachments;
  const marks = marksFor(saved.text, saved.marks, body); // B-082: hidden beside the plain body; back with the draft on failure
  try {
    const sent = await rpc.call('messages.send', {
      conversationId, body,
      attachments: attachments.length ? attachments : undefined,
      secrets: saved.secrets?.length ? saved.secrets : undefined,
      mentions: send.mentions(body),
      priority: level === 'important' ? 'important' : 'normal', ...(level === 'silent' ? { silent: true } : {}),
      clientId: newId('req'), replyTo: saved.replyTo,
      ...(spoken.speech ? { speech: spoken.speech } : {}),
      ...(marks ? { marks } : {}),
    });
    noteSavedKeys(body, sent?.body ?? body);
    return true;
  } catch (error) {
    toastError(error, 'Message not sent');
    updateDraft(conversationId, saved); // saved again (clearDraft persisted the empty draft)
    spoken.restore();
    return false;
  }
}
