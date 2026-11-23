// B-084 (decision 10) "Share to Autark" from another Android app: the app sends `share {text?, files}` over the native
// port (native-port.ts) and keeps the shared files. One fixed card over the chat list says "Pick a chat for …" with
// Cancel (the phone's Back cancels too); opening a chat puts the text into that chat's draft, and for files the card's
// "Attach" – a tap of the person's own – opens the composer's file input, which the app answers with the shared files
// (PhoneChrome) instead of its picker. The card lies over the page and moves nothing under it.
// Owns: the pending share and its card. Never: reads or uploads the files itself (the composer does), saves drafts
// (chat/composer/draft.ts does).

import { effect, untracked } from '@preact/signals';
import { updateDraft, draftFor } from '../chat/composer/draft.ts';
import { addBackLayer } from '../lib/back-layers.ts';
import { navigate, route } from '../lib/router.ts';
import { onNative } from './native-port.ts';

interface PendingShare { text: string; files: number; chat?: string }

let pending: PendingShare | null = null;
let card: HTMLElement | null = null;

/** The share message as data: up to 20 000 characters of text, 0–100 files; null when there is nothing. */
export function parseShare(msg: Record<string, unknown>): PendingShare | null {
  const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 20_000) : '';
  const files = typeof msg.files === 'number' && Number.isFinite(msg.files) ? Math.max(0, Math.min(100, Math.floor(msg.files))) : 0;
  return text || files ? { text, files } : null;
}

/** What the card names: "2 files", "the file", "the text". */
export function shareWhat(share: Pick<PendingShare, 'text' | 'files'>): string {
  if (share.files > 1) return `${share.files} files`;
  return share.files === 1 ? 'the file' : 'the text';
}

/** The draft's text with the shared text after it (a blank line between). */
export function withShared(draft: string, shared: string): string {
  if (!shared) return draft;
  return draft.trim() ? `${draft.replace(/\s+$/, '')}\n\n${shared}` : shared;
}

function close(): void {
  pending = null;
  card?.remove();
  card = null;
}

function button(label: string, kind: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `button ${kind}`;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

/** The one card: a line and its buttons, over the page under the top row. */
function show(line: string, primary?: HTMLButtonElement): void {
  card?.remove();
  card = document.createElement('div');
  card.className = 'share-pick';
  card.setAttribute('role', 'status');
  card.style.cssText = 'position:fixed;z-index:60;left:12px;right:12px;top:calc(env(safe-area-inset-top) + var(--header-h, 48px) + 8px);display:flex;align-items:center;gap:8px;padding:8px 8px 8px 14px;border:1px solid var(--line);border-radius:12px;background:var(--elevated);color:var(--text);box-shadow:var(--shadow-popover);font-size:14px';
  const label = document.createElement('span');
  label.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  label.textContent = line;
  card.append(label, ...(primary ? [primary] : []), button('Cancel', 'ghost', close));
  document.body.append(card);
}

/** The composer's general file input (not the photos-only one) of the open chat. */
function composerFileInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('.composer-area > input[type=file]:not([accept])');
}

function chatOpened(id: string): void {
  const share = pending;
  if (!share || share.chat === id) return;
  share.chat = id;
  if (share.text) updateDraft(id, { text: withShared(draftFor(id).peek().text, share.text) });
  share.text = ''; // placed once: another chat opened before Attach gets the files only
  if (!share.files) { close(); return; }
  show(`Attach ${shareWhat(share)} here`, button('Attach', 'secondary', () => {
    const input = composerFileInput();
    close();
    input?.click(); // inside this tap: the app answers the chooser with the shared files
  }));
}

let started = false;
/** Listens for the app's shares (phone-companies.ts startPhoneShell, once). */
export function startShare(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  addBackLayer({ open: () => card !== null, close });
  onNative('share', (msg) => {
    const share = parseShare(msg);
    if (!share) return;
    pending = share;
    navigate({ view: 'chats' });
    show(`Pick a chat for ${shareWhat(share)}`);
  });
  effect(() => {
    const at = route.value;
    if (at.view === 'chat') { const id = at.id; untracked(() => chatOpened(id)); } // only the route counts, not the draft it writes
  });
}
