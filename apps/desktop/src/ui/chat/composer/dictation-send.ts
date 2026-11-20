// AF-017 (desquerteur/Autark-Plus#18): dictate and send. A take ends one of three ways – ✓ (the mic cell: the words go
// into the field), ➤ (the send cell while a take runs: the words are sent once transcribed) or the release of a held
// mic (hold-to-talk: the mic held, or Ctrl+Shift+Space held in the field; let go = send). After ✓ the preference
// `dictationSend` decides: 'off' keeps the words in the field, 'on' sends them, 'countdown' sends them after
// COUNTDOWN_MS unless the person cancels (the chip's Cancel, Esc, or typing). "Send" is the composer's own send, so
// while an agent works it follows the send choice (AF-016, preferences.whileWorking) – exactly what Enter would do.
// Owns: that decision, the countdowns and the talk key. Never: records, transcribes or sends itself.

import { signal } from '@preact/signals';
import type { DictationSend } from '../../../shared/model/dictation-send.ts';

/** How long the countdown waits before a dictated draft goes out. */
export const COUNTDOWN_MS = 2000;

/** How the person ended the take: ✓, ➤, or the release of a hold. */
export type TakeEnd = 'done' | 'send' | 'release';

/** What follows a transcribed take: nothing (the words stay in the field), a send, or a countdown to one. */
export function afterTake(end: TakeEnd, preference: DictationSend | undefined): 'keep' | 'send' | 'countdown' {
  if (end !== 'done') return 'send';
  if (preference === 'on') return 'send';
  return preference === 'countdown' ? 'countdown' : 'keep';
}

export interface Countdown { conversationId: string; endsAt: number }

/** The running countdowns, one per chat at most (the composer shows "Sending in 2 s · Cancel"). */
export const countdowns = signal<ReadonlyMap<string, Countdown>>(new Map());
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function set(conversationId: string, value: Countdown | null): void {
  const next = new Map(countdowns.peek());
  if (value) next.set(conversationId, value); else next.delete(conversationId);
  countdowns.value = next;
}

/** Starts the countdown of `conversationId`'s draft: `send` runs after `ms` unless cancelled first. */
export function startCountdown(conversationId: string, send: () => void, ms = COUNTDOWN_MS, now = Date.now()): void {
  cancelCountdown(conversationId);
  set(conversationId, { conversationId, endsAt: now + ms });
  timers.set(conversationId, setTimeout(() => {
    timers.delete(conversationId);
    set(conversationId, null);
    send();
  }, ms));
}

/** Cancels the chat's countdown (the words stay in the field); false when none ran. */
export function cancelCountdown(conversationId: string): boolean {
  const timer = timers.get(conversationId);
  if (timer === undefined) return false;
  clearTimeout(timer);
  timers.delete(conversationId);
  set(conversationId, null);
  return true;
}

/** Whole seconds left of a countdown, at least 1 while it runs. */
export function secondsLeft(countdown: Countdown, now = Date.now()): number {
  return Math.max(1, Math.ceil((countdown.endsAt - now) / 1000));
}

/** The composer's push-to-talk key: Ctrl+Shift+Space (Cmd+Shift+Space on a Mac). */
export function isTalkKey(event: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): boolean {
  const space = event.key === ' ' || event.code === 'Space';
  return space && event.shiftKey && !event.altKey && (mac ? event.metaKey : event.ctrlKey);
}
