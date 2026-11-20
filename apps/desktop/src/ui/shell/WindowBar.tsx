// The frame's own header controls: the rail's sidebar toggle, and at the far right of the header row the one Browser
// cell (globe). In a chat it is the chat's own browser – Chat tabs, the chat's area above the messages (ChatArea.tsx),
// pressed while open, a dot while an agent's new tab waits there; elsewhere it shows and hides the global pane, a dot
// while a new tab waits in the closed pane (workspace/attention.ts). One browser button, not two. After it, right before the caption controls (shell.css), the feedback cell. Both lie
// over the end of the pane's tab strip, which keeps their room free; fixed 32 px cells in both states, so nothing
// beside them moves.
// Owns: sidebar/workspace toggles, the workspace and feedback cells. Never: view content, the pane itself or
// the feedback menu.

import { FeedbackButton } from '../feedback/FeedbackButton.tsx';
import { IconButton } from '../lib/ui.tsx';
import { preferences, updatePreferences } from '../lib/store.ts';
import { comboLabel } from '../lib/hotkeys.ts';
import { toastError } from '../lib/toasts.ts';
import { chatAttention, workspaceAttention } from '../workspace/attention.ts';
import { activeConversationId } from '../lib/store.ts';
import { chatAreaOpen, toggleChatArea } from '../lib/shell-state.ts';

export function toggleSidebar(): void {
  updatePreferences({ sidebarOpen: !preferences.value.sidebarOpen }).catch((error) => toastError(error));
}

export function toggleWorkspace(): void {
  updatePreferences({ workspaceOpen: !preferences.value.workspaceOpen }).catch((error) => toastError(error));
}

export function SidebarToggle() {
  const shown = preferences.value.sidebarOpen;
  return <IconButton icon="sidebar-simple" label={`${shown ? 'Hide' : 'Show'} sidebar (${comboLabel('mod+b')})`} iconSize={18}
    aria-expanded={shown} onClick={toggleSidebar} />;
}

/** The frame's one browser cell (desktop, a child of the frame; shell.css positions it): in a chat the chat's tabs,
 *  elsewhere – and while the global pane is open – the global pane. */
export function WorkspaceCell() {
  const chatId = activeConversationId.value;
  if (chatId && !preferences.value.workspaceOpen) { // a global pane opened elsewhere stays closable here
    const open = chatAreaOpen.value;
    return (
      <span class="frame-header-cell frame-workspace-cell" data-cell="browser">
        <IconButton icon="globe" label="Chat tabs" iconSize={18} pressed={open} class="frame-header-button"
          aria-expanded={open} onClick={() => toggleChatArea(chatId)} />
        {!open && chatAttention.value === chatId && <span class="frame-header-badge dot" aria-hidden="true" />}
      </span>
    );
  }
  const open = preferences.value.workspaceOpen;
  const dot = workspaceAttention.value && !open;
  return (
    <span class="frame-header-cell frame-workspace-cell" data-cell="workspace">
      <IconButton icon="globe" label="Browser" title={open ? 'Hide browser' : 'Show browser'} iconSize={18}
        pressed={open} class="frame-header-button" aria-controls="workspace" aria-expanded={open} onClick={toggleWorkspace} />
      {dot && <span class="frame-header-badge dot" aria-hidden="true" />}
    </span>
  );
}

/** The frame's feedback cell (desktop, a child of the frame at the row's far right; shell.css positions it). */
export function FeedbackCell() {
  return (
    <span class="frame-header-cell frame-feedback-cell" data-cell="feedback">
      <FeedbackButton />
    </span>
  );
}
