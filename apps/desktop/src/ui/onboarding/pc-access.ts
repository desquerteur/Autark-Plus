// The team's access to this PC (settings.profile.pcAccess), changed after the first run: B-085 "Give full access" (the
// careful-access notice in ai-notice.ts; the spotlight tour points at it) and, owner 16.11.2026, Settings › Security in
// both directions. One app line goes to the Manager's first chat as the person's message, so the Manager rewrites the PC
// line in its own SYSTEM.md and tells the team, so each agent rewrites its own (agents.update takes a SYSTEM.md only from
// its agent) – this function never edits an agent's text. Then the setting is written (new hires follow at once). The
// line goes first: when it fails, the setting stays as it was and the person tries again; one clientId per direction
// and try until it worked, so a double click or a retry after a failed settings write posts the line once.
// Owns: the two levels' words, those lines and that settings write. Never: edits SYSTEM.md, writes a line anywhere
// else, or asks to confirm.

import { newId } from '../../shared/ids.ts';
import { managerAgent, managerFirstChat } from '../../shared/text/manager-chat.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { agents, conversations, updateSettings } from '../lib/store.ts';
import type { PcAccess } from './first-run-model.ts';

/** The two levels as the About card and Settings › Security name them, one sentence each. */
export const ACCESS_LEVELS: ReadonlyArray<{ id: PcAccess; title: string; text: string }> = [
  { id: 'whole', title: 'Full access', text: 'The team works anywhere on this PC.' },
  { id: 'careful', title: 'Careful', text: 'The team works freely in its own folders and checks with you before changes elsewhere.' },
];

/** The lines the Manager receives, in the person's voice like the start text. */
export const FULL_ACCESS_LINE = 'Automatic message from the app, not typed by me: I gave the team full access to this PC from now on. Please change the PC line under "What I have here" in your own SYSTEM.md to the whole PC and let the team know, so each changes theirs.';
export const CAREFUL_ACCESS_LINE = 'Automatic message from the app, not typed by me: from now on the team works freely in its own folders on this PC and checks with me before changes elsewhere. Please change the PC line under "What I have here" in your own SYSTEM.md to that and let the team know, so each changes theirs.';
const LINES: Readonly<Record<PcAccess, string>> = { whole: FULL_ACCESS_LINE, careful: CAREFUL_ACCESS_LINE };

/** The double-send guard of each line (chat service: one message per clientId); a new one once a try went through. */
const clientIds: Record<PcAccess, string> = { whole: newId('req'), careful: newId('req') };

/** The access from now on: its line to the Manager (its first chat, else its default 1:1), then the setting. */
export async function setPcAccess(to: PcAccess): Promise<void> {
  const manager = managerAgent(agents.value);
  if (manager && can('messages.send')) {
    const chatId = managerFirstChat(conversations.value, manager.id)?.id ?? (await rpc.call('chats.direct', { memberId: manager.id })).id;
    await rpc.call('messages.send', { conversationId: chatId, body: LINES[to], mentions: [manager.id], clientId: clientIds[to] });
  }
  await updateSettings({ profile: { pcAccess: to } });
  clientIds[to] = newId('req');
}
