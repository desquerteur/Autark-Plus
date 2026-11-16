// The feedback cell of a header row (feedback 16.11.2026, F15/F22: on the phone the cell was only on the tab roots –
// no feedback from a chat, an agent, a person, an agent's Work page or the "only My day" screen). One cell for every
// row: the FeedbackButton in a fixed 32 px slot, or – where this connection may not file feedback – an inert placeholder
// of the same box, so the row never shifts. The phone's frame row (shell/MobileShell.tsx) ends with it before Profile;
// every body that draws its own phone row appends phoneFeedbackCells() (on the computer the window frame has the cell).
// Owns: the cell. Never: the button's behaviour (FeedbackButton.tsx) or which other cells a row has.

import { can } from '../lib/session.ts';
import { isMobile } from '../lib/store.ts';
import type { HeaderCell } from '../lib/header.tsx';
import { FeedbackButton } from './FeedbackButton.tsx';

export const FEEDBACK_CELL_ID = 'feedback';

/** The cell: the button where this connection may file feedback (`allowed`), else its placeholder. */
export function feedbackCell(allowed: boolean = can('feedback.create')): HeaderCell {
  return allowed ? { id: FEEDBACK_CELL_ID, slot: <FeedbackButton iconSize={20} /> } : { id: FEEDBACK_CELL_ID, placeholder: true };
}

/** The last cells of a row a body draws itself: the feedback cell on the phone, none on the computer (the frame has it). */
export function phoneFeedbackCells(): HeaderCell[] {
  return isMobile.value ? [feedbackCell()] : [];
}
