// Chat text size on the desktop (17.11.2026, Theo for the owner's portrait product videos: "Der Chattext lässt sich nicht
// vergrößern … Ctrl+= wirkt nicht"): Ctrl and + / = (with or without Shift, the numpad's too) makes a chat's messages,
// its live line and its composer larger, Ctrl and − smaller, Ctrl+0 back to 100 % – as in Chrome, kept on this PC. Only
// the chat's own column grows (CSS zoom through --chat-zoom, chat.css); the chat's tab area, the sidebar and the side
// browser stay as they are, so no native page moves. A website tab with the keyboard in it keeps its own zoom
// (workspace/pane-shortcuts.ts takes the key first). In a browser (the PWA) the browser's own zoom does this.
// Owns: the steps, the stored size and the root property. Never: zooms the whole window or any native view.

import { signal } from '@preact/signals';

export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const KEY = 'wf.chatZoom';

/** The chat text size now (1 = 100 %). */
export const chatZoom = signal(1);

/** The next step from `now` (`dir` 1 larger, −1 smaller, 0 back to 100 %); stays inside the steps. */
export function nextZoom(now: number, dir: -1 | 0 | 1): number {
  if (dir === 0) return 1;
  if (dir > 0) return ZOOM_STEPS.find((step) => step > now + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return [...ZOOM_STEPS].reverse().find((step) => step < now - 0.001) ?? ZOOM_STEPS[0];
}

/** A stored value read back: a known step, else 100 %. */
export function parseZoom(raw: string | null | undefined): number {
  const value = Number(raw);
  return (ZOOM_STEPS as readonly number[]).includes(value) ? value : 1;
}

/** Which way a key press zooms (undefined: not a zoom key). `mod` is Ctrl (Cmd on macOS), no Alt. */
export function zoomKey(event: { key: string; mod: boolean; alt: boolean }): -1 | 0 | 1 | undefined {
  if (!event.mod || event.alt) return undefined;
  if (event.key === '+' || event.key === '=') return 1;
  if (event.key === '-' || event.key === '_') return -1;
  if (event.key === '0') return 0;
  return undefined;
}

function apply(value: number): void {
  chatZoom.value = value;
  const root = document.documentElement;
  if (value === 1) root.style.removeProperty('--chat-zoom'); else root.style.setProperty('--chat-zoom', String(value));
}

/** Sets the size, stores it and says it in a short toast (`say`). */
export function setChatZoom(value: number, say?: (percent: number) => void): void {
  apply(value);
  try { if (value === 1) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(value)); } catch { /* storage blocked: this page only */ }
  say?.(Math.round(value * 100));
}

/** Reads the stored size at start (idempotent). */
export function restoreChatZoom(): void {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* none */ }
  apply(parseZoom(raw));
}
