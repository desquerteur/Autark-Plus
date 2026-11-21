// A chat's voice mode in the chat header: one fixed 32×32 call cell (lib/header.tsx), rendered for every chat that
// may talk (else an inert placeholder of the same size). Tap while voice or realtime voice runs in this chat → it
// stops (phone-disconnect, danger tint). Otherwise it starts: with settings.voice.realtime 'auto' realtime voice first
// (the audio output is made inside the tap – prepareRealtimeOutput); when that cannot start, or ends by itself, the
// chat's voice conversation takes over (composer/voice.ts startVoice). With 'off' the voice conversation directly.
// Both are this device's one call in the chat (its bubble, runtime/calls/call-log.ts): the voice conversation joins the call
// a realtime session opened, and End ends it. Only its icon, label and tone change – nothing beside it moves.
// AF-015: a start opens the call view (call-session.ts openCall: full size, start signal) before the engine starts, End
// is the view's hang-up; the cell carries data-tour="call-button". With the mock engine asked for on this device
// (call-session.ts mockRequested: tests and demos) the mock carries the call instead – no microphone, no key.
// B-081: answerCall takes a call – an agent's ring (the status line's Accept, call-notices.ts) or a call on another
// device (Take over); the cell does the same while this chat's call rings or runs elsewhere. A part that ends because
// another device took the call over (TAKEN_OVER) ends quietly: no fallback, no error.
// Autark-Plus: upstream's floating call card (B-085, CallCard.tsx) is not mounted – the call view is this device's call
// UI, and it carries B-085's Mute (mute.ts), Camera and Screen (call-view.ts, CallShare.tsx).
// Owner 18.11.2026: a call asked for by the floating to-do button (lib/router.ts callRequest) starts once the cell shows.
// Owns: the cell's states and what a tap starts. Never: the voice loop (voice.ts) or realtime audio (realtime-call.ts).

import { useEffect, useState } from 'preact/hooks';
import { TAKEN_OVER } from '../../../shared/model/call.ts';
import type { ConversationSummary } from '../../../shared/model/chat.ts';
import type { HeaderCell } from '../../lib/header.tsx';
import { callRequest } from '../../lib/router.ts';
import { voiceSessions } from '../../lib/shell-state.ts';
import { settings } from '../../lib/store.ts';
import { toastError } from '../../lib/toasts.ts';
import { conversationAvailable, startVoice, stopVoice } from '../composer/voice.ts';
import { liveCalls } from './call-notices.ts';
import { discardRealtimeOutput, prepareRealtimeOutput, realtimeChat, startRealtime, stopRealtime } from './realtime-call.ts';
import { callFailed, callOpenIn, callUi, engineStarting, hangUp, mockRequested, openCall } from './call-session.ts';

/** The call cell's id (`.frame-header [data-cell="call"]`). */
export const CALL_CELL = 'call';

/** This chat may talk on this connection (no system chats). */
export function callable(chat: ConversationSummary): boolean {
  return !chat.settings.system && conversationAvailable();
}

/** Voice or realtime voice runs in this chat on this device. */
export function talking(conversationId: string): boolean {
  return realtimeChat.value === conversationId || voiceSessions.value.some((chat) => chat.conversationId === conversationId)
    || (callUi.value?.mock === true && callUi.value.conversationId === conversationId);
}

/** Starts the chat's voice mode from the tap (AF-015: the call view opens first); `callId`: the call it takes (B-081). */
async function startCall(conversationId: string, callId?: string): Promise<void> {
  if (mockRequested()) { openCall(conversationId, { mock: true }); return; }
  openCall(conversationId); // inside the tap: the start signal plays now
  const started = await engineStarting(startEngine(conversationId, callId)).catch(() => false);
  if (!started) callFailed(conversationId);
}

/** The engine: realtime voice when it is on (falling back to the voice conversation), else the voice conversation. */
async function startEngine(conversationId: string, callId?: string): Promise<boolean> {
  if (settings.peek()?.voice?.realtime !== 'auto') return startVoice(conversationId, callId);
  const output = prepareRealtimeOutput(); // inside the tap: mobile browsers keep a later one suspended
  try {
    await startRealtime(conversationId, (reason) => {
      if (reason === TAKEN_OVER) return; // B-081: the call goes on on another device
      if (reason) toastError(new Error(reason), 'Realtime voice ended');
      void engineStarting(startVoice(conversationId)); // the call goes on in the chat's voice conversation
    }, undefined, output, callId);
    return true;
  } catch {
    discardRealtimeOutput(output);
    return startVoice(conversationId, callId); // no realtime model here (or it failed): the voice conversation
  }
}

/** B-081: takes the call `callId` on this device – answers a ring or takes it over from another device. Call from the tap. */
export function answerCall(conversationId: string, callId: string): Promise<void> {
  return startCall(conversationId, callId).catch((error: unknown) => toastError(error, 'Call not taken'));
}

/** Ends the chat's voice mode on this device. */
function endCall(conversationId: string): void {
  if (callOpenIn(conversationId)) { hangUp(); return; } // the view's hang-up: the end signal, the view closes
  if (realtimeChat.peek() === conversationId) stopRealtime();
  void stopVoice(conversationId);
}

/** The header's call cell: Talk → End in the same box (busy while it starts); Answer / Take over while this chat's call rings or runs elsewhere. */
export function useCallCell(chat: ConversationSummary): HeaderCell {
  const [busy, setBusy] = useState(false);
  // Owner 18.11.2026: the floating to-do button's Call opens this chat with its call asked for (lib/router.ts callRequest)
  const asked = callRequest.value === chat.id;
  useEffect(() => {
    if (!asked) return;
    callRequest.value = null;
    if (!callable(chat) || talking(chat.id)) return;
    setBusy(true);
    void startCall(chat.id).catch((error: unknown) => toastError(error)).finally(() => setBusy(false));
  }, [asked, chat.id]);
  if (!callable(chat)) return { id: CALL_CELL, placeholder: true };
  if (talking(chat.id)) {
    // AF-015: the call itself shows in the call view (CallOverlay.tsx – also camera and screen, B-085); the cell is its End
    return { id: CALL_CELL, icon: 'phone-disconnect', label: 'End voice', tone: 'danger', class: 'call-cell call-leave', tour: 'call-button', onClick: () => endCall(chat.id) };
  }
  const live = liveCalls.value.find((call) => call.conversationId === chat.id && (call.state === 'running' || (call.until ?? 0) > Date.now()));
  const start = () => {
    setBusy(true);
    void startCall(chat.id, live?.callId).catch((error: unknown) => toastError(error)).finally(() => setBusy(false));
  };
  const label = live ? (live.state === 'ringing' ? 'Answer' : 'Take over') : 'Talk';
  return { id: CALL_CELL, icon: 'phone', label, busy, class: 'call-cell call-start', tour: 'call-button', onClick: start };
}
