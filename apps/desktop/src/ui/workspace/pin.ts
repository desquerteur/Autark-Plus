// B-081: where a pin from the browser's Pin button goes (shared/model/page-pick.ts pickText) – where the person's words
// go: the chat of the tab's chat area, else a chat that talks on this device (the open one first), else the open chat.
// In a voice conversation it is a line of the call (addToCall: the agent's live voice answers it like speech); in a
// realtime call a typed line of the chat (the session takes typed lines as context); otherwise it is appended to that
// chat's draft on a line of its own, the keyboard staying where it is. With no chat, a short notice says so.
// Owns: that routing. Never: reads the page, or sends anything but the pin's lines.

import { newId } from '../../shared/ids.ts';
import { pickText, type PagePick } from '../../shared/model/page-pick.ts';
import { realtimeChat } from '../chat/call/realtime-call.ts';
import { draftFor, updateDraft } from '../chat/composer/draft.ts';
import { addToCall } from '../chat/composer/voice.ts';
import { rpc } from '../lib/rpc.ts';
import { voiceSessions } from '../lib/shell-state.ts';
import { activeConversationId } from '../lib/store.ts';
import { pushToast, toastError } from '../lib/toasts.ts';
import { browserPages } from './pages.ts';
import { withLine } from './send-page.ts';

/** What talks on this device and which chat is open. */
export interface PinState { open?: string | null; talking: readonly string[]; realtime?: string | null }
export interface PinRoute { chatId: string; via: 'call' | 'realtime' | 'draft' }

/** The chat a pin from a tab of `tab.space` goes to and how (pure); null without any chat. */
export function pinTarget(tab: { space?: string }, state: PinState): PinRoute | null {
  const area = tab.space?.startsWith('chat:') ? tab.space.slice('chat:'.length) : undefined;
  const live = [...state.talking, ...(state.realtime ? [state.realtime] : [])];
  const chatId = area || (state.open && live.includes(state.open) ? state.open : live[0]) || state.open;
  if (!chatId) return null;
  return { chatId, via: state.realtime === chatId ? 'realtime' : state.talking.includes(chatId) ? 'call' : 'draft' };
}

/** A pin from tab `tabId` into its chat (see the header). */
export function pinToChat(tabId: string, pick: PagePick): void {
  const space = browserPages.peek().find((page) => page.id === tabId)?.space;
  const route = pinTarget({ space }, { open: activeConversationId.peek(), talking: voiceSessions.peek().map((chat) => chat.conversationId), realtime: realtimeChat.peek() });
  if (!route) { pushToast({ title: 'Open a chat to pin into', tone: 'info' }); return; }
  const text = pickText(pick);
  if (route.via === 'call' && addToCall(route.chatId, text)) return;
  if (route.via === 'realtime') {
    void rpc.call('messages.send', { conversationId: route.chatId, body: text, clientId: newId('req') }).catch((error: unknown) => toastError(error, 'Pin not sent'));
    return;
  }
  const draft = draftFor(route.chatId).peek();
  updateDraft(route.chatId, { text: withLine(draft.text.replace(/[ \t]+$/, ''), text) }); // every pin on a line of its own
}
