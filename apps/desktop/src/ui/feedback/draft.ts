// B-055 Q4: the one feedback draft of this window – the text, the window screenshot taken when the
// header cell was pressed, its marks ("Paint over") with their flattened image, and the
// "Screenshot" checkbox (on by default) – shared by the header menu and Settings › Feedback's "New
// report". It survives closing the menu until it is sent; a draft without text and without marks
// counts as empty, so the next press takes a fresh screenshot (keepsShot). Talk from the cell and
// the mic in the field both append to the text (joinText).
// AF-003: the draft also keeps its kind – "Bug" (the default) or "Idea" – chosen above the field.
// Feedback 16.11.2026: the dictation's own recordings ("Recording", on by default – recording.ts) and an Android crash
// report the app handed over ("Crash report attached", on by default) belong to the draft too; either one alone makes a
// report worth sending (canSubmit). The outbox (outbox.ts) keeps the draft in this page's storage across a reload.
// Owns: the draft state and taking its screenshot. Never: uploads, sends or draws anything.

import { signal } from '@preact/signals';
import { FEEDBACK_AUDIO_MAX, FEEDBACK_CLIENT_DIAGNOSTICS_MAX } from '../../shared/model/feedback-delivery.ts';
import { canCaptureWindow, captureWindow } from './bridge.ts';
import type { PaintMark, ShotDraft } from './paint.ts';
import type { RecordedTake } from './recording.ts';

/** Where the person was when the screenshot was taken (the report's context). */
export interface DraftPlace { view?: string; conversationId?: string }

/** AF-003: the kinds the form offers (the runtime knows more: change, praise – agents may use them). */
export type DraftKind = 'bug' | 'idea';
export const DRAFT_KINDS: ReadonlyArray<{ kind: DraftKind; label: string; placeholder: string }> = [
  { kind: 'bug', label: 'Bug', placeholder: 'What happened, or what went wrong?' },
  { kind: 'idea', label: 'Idea', placeholder: 'What would you like?' },
];

export interface FeedbackDraft extends ShotDraft {
  text: string;
  marks: readonly PaintMark[];
  where: DraftPlace;
  /** AF-003: undefined = 'bug'. */
  kind?: DraftKind;
  /** The dictation's recordings, oldest first (at most FEEDBACK_AUDIO_MAX). */
  audio: readonly RecordedTake[];
  /** "Recording": the recordings go with the report. */
  withAudio: boolean;
  /** An Android crash report the app handed over (≤ FEEDBACK_CLIENT_DIAGNOSTICS_MAX characters). */
  diagnostics?: string;
  /** "Crash report attached": it goes with the report. */
  withDiagnostics: boolean;
}

export const EMPTY_DRAFT: FeedbackDraft = { text: '', shot: null, painted: null, marks: [], withShot: true, where: {}, audio: [], withAudio: true, withDiagnostics: true };

/** The report's words when only its recording speaks (the take could not be transcribed). */
export const UNTRANSCRIBED_TEXT = '(dictation not transcribed)';
/** The report's words when only the crash report says what happened. */
export const CRASH_ONLY_TEXT = '(crash report)';

/** Nothing in the draft that a report would carry from the person (the screenshot alone is retaken on the next press). */
export function isEmptyDraft(draft: Pick<FeedbackDraft, 'text' | 'marks' | 'audio' | 'diagnostics'>): boolean {
  return !draft.text.trim() && !draft.marks.length && !draft.audio.length && !draft.diagnostics;
}

/** Send is possible: words, a recording that goes along, or an attached crash report. */
export function canSubmit(draft: Pick<FeedbackDraft, 'text' | 'audio' | 'withAudio' | 'diagnostics' | 'withDiagnostics'>): boolean {
  return draft.text.trim() !== '' || (draft.withAudio && draft.audio.length > 0) || (draft.withDiagnostics && !!draft.diagnostics);
}

/** The report's text: the person's words, else what the attachments are. */
export function reportText(draft: Pick<FeedbackDraft, 'text' | 'audio' | 'withAudio'>): string {
  const words = draft.text.trim();
  if (words) return words;
  return draft.withAudio && draft.audio.length ? UNTRANSCRIBED_TEXT : CRASH_ONLY_TEXT;
}

/** A dictation's recording joins the draft (beyond FEEDBACK_AUDIO_MAX it is not kept). */
export function addRecording(take: RecordedTake): void {
  const draft = feedbackDraft.peek();
  if (draft.audio.length >= FEEDBACK_AUDIO_MAX) return;
  updateDraft({ audio: [...draft.audio, take] });
}

/** The Android app handed over a crash report ("Report" on its crash screen): it rides with the next report. */
export function attachCrashReport(text: string): void {
  const trimmed = text.trim().slice(0, FEEDBACK_CLIENT_DIAGNOSTICS_MAX);
  if (trimmed) updateDraft({ diagnostics: trimmed, withDiagnostics: true });
}

/** The draft's kind ('bug' unless "Idea" was chosen). */
export function draftKind(draft: Pick<FeedbackDraft, 'kind'>): DraftKind {
  return draft.kind === 'idea' ? 'idea' : 'bug';
}

export const feedbackDraft = signal<FeedbackDraft>(EMPTY_DRAFT);
/**
 * The draft as it was sent, while its send is on its way (feedback 17.11.2026, Mika: during "Sending…" the form showed
 * the fresh draft – "Recording" ticked again – as if it sent what the person had unticked). The outbox holds the report
 * and the draft is fresh at once (a second press never sends it twice); the form and the overlay show this one,
 * disabled, until the outcome.
 */
export const sentDraft = signal<FeedbackDraft | null>(null);

/** What the form and the overlay show: the draft on its way while it goes, else the draft. */
export function shownDraft(): FeedbackDraft {
  return sentDraft.value ?? feedbackDraft.value;
}
/** A screenshot is being taken for the draft (its thumbnail shows a placeholder meanwhile). */
export const shotTaking = signal(false);

/** The draft keeps its screenshot (text or marks would refer to it); otherwise a press retakes it. */
export function keepsShot(draft: Pick<FeedbackDraft, 'text' | 'marks' | 'shot'>): boolean {
  return draft.shot !== null && (draft.text.trim() !== '' || draft.marks.length > 0);
}

/** Dictated words after what is already there, one space between. */
export function joinText(current: string, spoken: string): string {
  const words = spoken.trim();
  if (!words) return current;
  if (!current.trim()) return words;
  return /\s$/.test(current) ? `${current}${words}` : `${current} ${words}`;
}

export function updateDraft(change: Partial<FeedbackDraft>): void {
  feedbackDraft.value = { ...feedbackDraft.peek(), ...change };
}

export function appendDraftText(spoken: string): void {
  updateDraft({ text: joinText(feedbackDraft.peek().text, spoken) });
}

/** After sending: a fresh draft (the next press takes a new screenshot). */
export function clearDraft(): void {
  feedbackDraft.value = EMPTY_DRAFT;
}

let taking: Promise<void> | null = null;

/**
 * Takes the window's screenshot for the draft unless it keeps the one it has (keepsShot) or this
 * host cannot capture (a phone). Called on the cell's pointer down, before anything opens.
 */
export function takeShot(where: DraftPlace): Promise<void> {
  if (taking) return taking;
  if (!canCaptureWindow() || keepsShot(feedbackDraft.peek())) return Promise.resolve();
  shotTaking.value = true;
  updateDraft({ shot: null, painted: null, marks: [], withShot: true, where });
  taking = captureWindow()
    .then((image) => { if (!keepsShot(feedbackDraft.peek())) updateDraft({ shot: image, painted: null, marks: [] }); })
    .finally(() => { taking = null; shotTaking.value = false; });
  return taking;
}

let painting: Promise<void> | null = null;

/** "Paint over" closes: its marks are flattened by `work`; a Send meanwhile waits for it (paintSettled). */
export function whilePainting(work: Promise<void>): Promise<void> {
  const tracked: Promise<void> = work.finally(() => { if (painting === tracked) painting = null; });
  painting = tracked;
  return tracked;
}

export function paintSettled(): Promise<void> {
  return painting ?? Promise.resolve();
}

/** Resolves when the screenshot on its way is there – or after `limitMs`, whichever is first. */
export function shotSettled(limitMs = 1500): Promise<void> {
  const pending = taking;
  if (!pending) return Promise.resolve();
  return Promise.race([pending, new Promise<void>((resolve) => setTimeout(resolve, limitMs))]);
}
