// Quiet in-window toasts (attention items and action errors). Max 3 at once (the oldest goes first); they expire,
// except one pushed with ttl 0 – a to-do or a blocker that has something to open – which stays until Open or Dismiss,
// or until the person reaches where Open leads or the to-do is finished another way (lib/store-events.ts). Feedback
// 16.11.2026 (F10): an important message (an agent's line, a mention, a link) leaves after NOTICE_ONLY_MS – it stays
// unread in its chat and the OS/phone push still goes. F25: a start notice saying an update did not install stays too.
// They show as lines of the status line (shell/StatusLine.tsx). B-082: a toast may carry one `action` (its button, e.g.
// a kept recording's "Transcribe again"); such a toast is the last one a newer toast pushes out.
// Owns: the toast queue. Never: OS notifications (main process), their look or persistent state.

import { signal } from '@preact/signals';
import type { EventMap } from '../../shared/api/events.ts';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  conversationId?: string;
  /** The to-do the attention item is about (Open goes to My day). */
  taskId?: string;
  tone?: 'info' | 'error';
  /** B-082: the toast's own button (it closes the toast). */
  action?: { label: string; run: () => void };
}

export const toasts = signal<Toast[]>([]);
let nextId = 1;

/** A toast; `ttlMs` 0 keeps it until Open or Dismiss (0, never Infinity: so long a timer fires at once). */
export function pushToast(toast: Omit<Toast, 'id'>, ttlMs = 6000): void {
  const id = nextId++;
  const list = [...toasts.value, { ...toast, id }];
  while (list.length > 3) { const plain = list.findIndex((entry) => !entry.action); list.splice(plain >= 0 ? plain : 0, 1); }
  toasts.value = list;
  if (ttlMs > 0) setTimeout(() => dismissToast(id), ttlMs);
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

/** Drops the toasts that `test` picks, e.g. those about a chat just opened (peek: an effect calling it does not follow the toasts). */
export function dismissToastsWhere(test: (toast: Toast) => boolean): void {
  const list = toasts.peek();
  const kept = list.filter((toast) => !test(toast));
  if (kept.length !== list.length) toasts.value = kept;
}

/** Kinds that ask something of the person: their toast stays until Open or Dismiss. */
const LASTING: ReadonlySet<EventMap['notify']['kind']> = new Set(['todo', 'blocker']);

/**
 * Feedback F09/F10 (16.11.2026): an important notice – an agent's message, a mention, "office-pc is now linked" – and
 * a to-do or blocker with nothing to open stay a while longer than a reply and then go by themselves.
 */
export const NOTICE_ONLY_MS = 20_000;

/** A runtime notification as a toast: to-dos and blockers stay (one with nothing to open expires late), important lines expire late, replies and results expire. */
export function toastNotification(note: EventMap['notify']): void {
  const toast = { title: note.title, body: note.body, conversationId: note.conversationId, ...(note.taskId ? { taskId: note.taskId } : {}) };
  const opens = Boolean(note.conversationId || note.taskId);
  pushToast(toast, LASTING.has(note.kind) ? (opens ? 0 : NOTICE_ONLY_MS) : note.kind === 'important' ? NOTICE_ONLY_MS : undefined);
}

/** RC1: the start notice ("Updated to X · …") as a toast; F25: one saying an update did not install stays until Dismiss. */
export function toastStartNotice(notice: { text: string; failed?: true }): void {
  if (notice.failed) pushToast({ title: notice.text, tone: 'error' }, 0);
  else pushToast({ title: notice.text });
}

/** Shows a short error toast for a failed action. */
export function toastError(error: unknown, title = 'Action failed'): void {
  const body = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  pushToast({ title, body, tone: 'error' });
}
