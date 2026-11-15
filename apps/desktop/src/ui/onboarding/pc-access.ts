// B-085: "Give full access" (the careful-access notice in ai-notice.ts; the spotlight tour points at it): the person
// turns careful PC access into the whole PC. One app line goes to the Manager's first chat as the person's message, so
// the Manager rewrites the PC line in its own SYSTEM.md and tells the team, so each agent rewrites its own (agents.update
// takes a SYSTEM.md only from its agent) – this function never edits an agent's text.
// Then settings.profile.pcAccess becomes 'whole' (new hires and every agent's "PC reach" line follow at once). The line
// goes first: when it fails, the setting stays careful and the notice stays for another try; one clientId per try
// until it worked, so a double click or a retry after a failed settings write posts the line once.
// Owns: that one line and that settings write. Never: edits SYSTEM.md, writes a line anywhere else, or asks to confirm.

import { newId } from '../../shared/ids.ts';
import { managerAgent, managerFirstChat } from '../../shared/text/manager-chat.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { agents, conversations, updateSettings } from '../lib/store.ts';

/** The line the Manager receives, in the person's voice like the start text. */
export const FULL_ACCESS_LINE = 'Automatic message from the app, not typed by me: I gave the team full access to this PC from now on. Please change the PC line under "What I have here" in your own SYSTEM.md to the whole PC and let the team know, so each changes theirs.';

/** The double-send guard of this line (chat service: one message per clientId); a new one once a try went through. */
let clientId = newId('req');

/** Whole PC from now on: the line to the Manager (its first chat, else its default 1:1), then the setting. */
export async function giveFullAccess(): Promise<void> {
  const manager = managerAgent(agents.value);
  if (manager && can('messages.send')) {
    const chatId = managerFirstChat(conversations.value, manager.id)?.id ?? (await rpc.call('chats.direct', { memberId: manager.id })).id;
    await rpc.call('messages.send', { conversationId: chatId, body: FULL_ACCESS_LINE, mentions: [manager.id], clientId });
  }
  await updateSettings({ profile: { pcAccess: 'whole' } });
  clientId = newId('req');
}
