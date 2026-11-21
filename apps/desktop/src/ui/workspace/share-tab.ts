// A website handed on (owner 18.11.2026: "from one device you decide that it opens on another device", and people
// share tabs with each other): "Open on" opens its address in the pane of another of the person's PCs (side.open with
// `device` – linked-pcs.ts names them), "Share in chat" opens it as a tab of a chat's area (chat:<id>), which everyone
// in that chat sees – people on their devices, the agents with browser.tabs. Both are sections of the pane's menu
// (PaneMenu.tsx) for a website of this PC or of another one.
// Owns: these two sections and what they do. Never: which tabs exist (pages.ts) or who sees a chat's area (the runtime).

import { chatSpace } from '../../shared/api/workspace-browser.ts';
import type { ConversationSummary } from '../../shared/model/chat.ts';
import type { Device } from '../../shared/model/devices.ts';
import '../../shared/model/side-view.ts'; // side.open
import { chatTitle } from '../lib/chat-naming.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { setChatArea } from '../lib/shell-state.ts';
import { pushToast, toastError } from '../lib/toasts.ts';
import type { MenuSection } from '../lib/ui.tsx';
import { openCopy } from './pages.ts';

/** The chats "Share in chat" offers: the latest ones in the person's list. */
export const SHARE_CHATS = 6;

/** Opens `url` in a new tab of PC `pc`'s pane, shown there at once. */
export async function openOnPc(url: string, pc: Pick<Device, 'id' | 'name'>): Promise<void> {
  try {
    await rpc.call('side.open', { url, device: pc.id });
    pushToast({ title: `Opened on ${pc.name}`, tone: 'info' }, 2000);
  } catch (error) { toastError(error, `${pc.name} could not open that page`); }
}

/** Opens `url` as a tab of chat `chat`'s area and opens that area. */
export async function shareInChat(url: string, chat: ConversationSummary): Promise<void> {
  try {
    await openCopy(url, chatSpace(chat.id));
    setChatArea(chat.id, true);
    pushToast({ title: `Shared in ${chatTitle(chat)}`, tone: 'info' }, 2000);
  } catch (error) { toastError(error, 'Could not share that page'); }
}

/** The chats a page can be shared in, newest first: listed ones (no app-owned or hidden chat), not `except`'s. */
export function shareChats(chats: readonly ConversationSummary[], except?: string): ConversationSummary[] {
  return chats.filter((chat) => chat.id !== except && chat.archivedAt === undefined && !chat.settings.system && !chat.settings.hiddenFromList)
    .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt)).slice(0, SHARE_CHATS);
}

/** "Open on" (the person's other PCs, not `on` – the PC the page runs on) and "Share in chat" for a page at `url` shown in `space`. */
export function shareSections(url: string, space: string, on: string | undefined, pcs: readonly Device[], chats: readonly ConversationSummary[]): MenuSection[] {
  if (!url) return [];
  const others = can('side.open') ? pcs.filter((pc) => pc.id !== on) : [];
  const targets = shareChats(chats, space.startsWith('chat:') ? space.slice(5) : undefined);
  return [
    ...(others.length ? [{ title: 'Open on', items: others.map((pc) => ({ label: pc.name, hint: pc.status === 'online' ? undefined : 'Offline', onSelect: () => void openOnPc(url, pc) })) }] : []),
    ...(targets.length ? [{ title: 'Share in chat', items: targets.map((chat) => ({ label: chatTitle(chat), onSelect: () => void shareInChat(url, chat) })) }] : []),
  ];
}
