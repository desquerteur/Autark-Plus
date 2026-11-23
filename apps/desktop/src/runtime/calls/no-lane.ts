// The program's own line in a call that no model can answer (KI-Runde 17.11.2026: the one call of company-2 ended in
// silence): when the call voice's ask finds no lane at all (the router has no model that can run now – 'unavailable'),
// the call hears that at once. It is a system line of the call, not an agent's: the device reads a system line of its own
// call aloud (shared/voice/conversation.ts), in the profile's language (German or English). It goes out without delivery,
// so it wakes nobody, and it is said once per call – every further line that finds no lane adds nothing. The person's
// line still goes to the agent's delivery (talker.ts), so the answer follows once a model is free.
// Owns: when a failure means "no lane" and that line. Never: speaks as an agent, wakes anyone, or retries.

import { WorkforceError } from '../../shared/errors.ts';
import { SYSTEM_ID } from '../../shared/ids.ts';
import type { RuntimeServices } from '../contracts.ts';

export const NO_LANE_LINE = {
  en: 'No model can answer right now. What you said is in the chat, and the answer follows as soon as a model is free.',
  de: 'Gerade kann kein Modell antworten. Was du gesagt hast, steht im Chat, und die Antwort kommt, sobald ein Modell frei ist.',
} as const;

/** The failure says that no model can run now (the router found none), not that one answer went wrong. */
export function noLane(error: unknown): boolean {
  return error instanceof WorkforceError && error.code === 'unavailable';
}

/** The rows of the call looked at to see whether it has already heard the line. */
const ROWS = 40;

/** The line in the call `callId` of the chat, read aloud by the device – once per call, delivered to nobody (never throws). */
export function sayNoLane(s: Pick<RuntimeServices, 'chats' | 'settings' | 'log'>, conversationId: string, callId: string | undefined): void {
  if (!callId) return;
  let said = false;
  try { said = s.chats.messages(conversationId, { limit: ROWS }).some((row) => row.authorKind === 'system' && row.kind === 'text' && row.meta.call?.id === callId); } catch { said = false; }
  if (said) return; // this call has heard it: the next line that finds no lane says nothing more
  let language = '';
  try { language = s.settings.get().profile?.language?.trim().toLowerCase() ?? ''; } catch { language = ''; }
  try {
    s.chats.send({
      conversationId, body: language.startsWith('de') ? NO_LANE_LINE.de : NO_LANE_LINE.en, authorId: SYSTEM_ID, authorKind: 'system', mentions: [],
      meta: { call: { id: callId, participant: 'system', name: 'Autark' } }, deliver: false,
    });
  } catch (error) {
    s.log.warn('no-lane call line not stored', { conversationId, error: String(error) });
  }
}
