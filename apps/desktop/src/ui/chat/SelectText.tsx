// "Select text" from a message's long-press menu on touch (F30, owner 16.11.2026: "wenn man auf Nachricht draufdrückt,
// auch speziellen Text kopieren kann"): a small sheet with the message's text as plain, selectable text. Our long-press
// menu owns the press on a message, so the phone's own selection handles and copy bar work here instead – nothing of
// ours listens inside the sheet. The text is the one Copy copies (the message's raw text). The sheet is portalled to
// the page's body by the message that opened it (MessageItem.tsx keeps it open); the phone's Back closes it first.
// Owns: the sheet. Never: writes the clipboard (the phone's own copy bar does) or changes the message.

import { createPortal } from 'preact/compat';
import { useEffect } from 'preact/hooks';
import type { Message } from '../../shared/model/chat.ts';
import { addBackLayer } from '../lib/back-layers.ts';
import { Dialog } from '../lib/dialog.tsx';

/** How the open sheet closes (the phone's Back reaches it through the back layers); null while none is open. */
let closeOpen: (() => void) | null = null;
addBackLayer({ open: () => closeOpen !== null, close: () => closeOpen?.() });

export function SelectText(props: { message: Message; onClose: () => void }) {
  const { onClose } = props;
  useEffect(() => {
    closeOpen = onClose;
    return () => { if (closeOpen === onClose) closeOpen = null; };
  }, [onClose]);
  return createPortal(
    <Dialog open onClose={onClose} title="Select text" width={560} class="select-text">
      <div class="select-text-body">{props.message.body}</div>
    </Dialog>,
    document.body,
  );
}
