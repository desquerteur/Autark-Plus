// B-055 Q4: the feedback host, mounted once by the shell's overlays and by the "only My day" screen (App.tsx, the PC
// unreachable). Feedback 16.11.2026 (F11, F13, F15): it draws the snapshot overlay (FeedbackOverlay.tsx – it replaced
// the menu popover and "Paint over"), the privacy details and the team's inbox, and installs once per page what
// feedback needs: the openings from anywhere (popover-state.ts watchFeedbackOpen: the snapshot first, then the overlay),
// the feedback cell's slot every open dialog draws at the cell's spot (lib/dialog.tsx setDialogSlot – the cell could
// not be pressed under a dialog), the shortcut from main (FeedbackButton.tsx listenFeedbackKey), the page's outbox
// (outbox.ts: the kept draft, the reports waiting for the PC) and the Android app's crash report (native-port.ts
// {t:'crash'}, once per report): it joins the draft and the overlay opens with "Crash report attached".
// Owns: the feedback host. Never: the overlay's or the form's content, or sending (FeedbackPanel.tsx).

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { setDialogSlot } from '../lib/dialog.tsx';
import { isMobile } from '../lib/store.ts';
import { consumeNative, onNative } from '../pwa/native-port.ts';
import { attachCrashReport } from './draft.ts';
import { FeedbackButton, listenFeedbackKey } from './FeedbackButton.tsx';
import { FeedbackInbox } from './FeedbackInbox.tsx';
import { FeedbackOverlay } from './FeedbackOverlay.tsx';
import { FeedbackPrivacyDialog } from './FeedbackPrivacy.tsx';
import { startFeedbackOutbox } from './outbox.ts';
import { cellSpot, closeFeedback, openFeedback, watchFeedbackOpen } from './popover-state.ts';

const inboxOpen = signal(false); // keep the dialog open when the shell changes to the phone layout

/** The cell's slot in every open dialog: the same button at the row cell's spot (the phone's rows draw it larger). */
const cellSlot = { place: cellSpot, render: () => <FeedbackButton slot iconSize={isMobile.value ? 20 : undefined} /> };

/** The Android app's crash report (the person tapped "Report"): into the draft once the kept one is back, then the form opens. */
function takeCrashReport(message: Record<string, unknown>): void {
  consumeNative('crash'); // taken once: a later host (the shell after "only My day") does not open it again
  const text = message.text;
  if (typeof text !== 'string' || !text.trim()) return;
  void startFeedbackOutbox().then(() => { attachCrashReport(text); openFeedback(); });
}

export function FeedbackMenu() {
  useEffect(() => watchFeedbackOpen(), []);
  useEffect(() => { void startFeedbackOutbox(); return onNative('crash', takeCrashReport); }, []);
  useEffect(() => setDialogSlot(cellSlot), []);
  useEffect(() => listenFeedbackKey(), []);
  return (
    <>
      <FeedbackOverlay onInbox={() => { closeFeedback(); inboxOpen.value = true; }} />
      <FeedbackPrivacyDialog />
      <FeedbackInbox open={inboxOpen.value} onClose={() => { inboxOpen.value = false; }} />
    </>
  );
}
