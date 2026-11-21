// Owns: what a client may know about feedback delivery – whether this build can send (`feedback.status`), the team
// inbox on the PCs that hold the team's private key (B-055 Q1–Q3), `wf feedback setup`'s answer, the short
// report number both sides show (B-085) and the bounds of what a writing device adds (16.11.2026: client facts, its
// own diagnostics, recorded takes).
// Never: keys, the service account, the sealed bytes or any read API of the mailbox (it is write-only).
import type { FeedbackKind } from './system.ts';

/**
 * The short report number of a delivered report: the first 8 letters and digits of its receipt (the mailbox
 * document id, a UUID – the team inbox item's `id`), in capitals. Empty without a receipt.
 */
export function reportNumber(receiptId: string | undefined): string {
  return (receiptId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
}

/** The team inbox's folder in a company's data dir: <id>.json per report, its screenshot and recordings beside it (runtime/feedback/inbox.ts). */
export const INBOX_DIR = 'feedback-inbox';

/** The largest sealed envelope sent to the mailbox (its Firestore rule allows < 1,000,000 bytes). */
export const FEEDBACK_SEALED_LIMIT = 950_000;
/** The largest screenshot (raw bytes) the feedback service (services/feedback) accepts; its base64 stays inside the service's 1.5 MB request limit. */
export const FEEDBACK_IMAGE_LIMIT = 1_000_000;
/** One report as the feedback service (services/feedback) receives it; an image is base64 of at most FEEDBACK_IMAGE_LIMIT bytes. */
export interface FeedbackSubmission {
  requestId: string;
  visibility: 'private' | 'public';
  title: string;
  body: string;
  image?: { mime: FeedbackImageType; base64: string };
}
/** A report's `deliveryWarning` when the sealed report with its screenshot was too large. */
export const SCREENSHOT_DROPPED = 'The screenshot was too large and was not sent.';
/** Screenshot types a report may carry (never SVG or anything a browser would run). */
export const FEEDBACK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type FeedbackImageType = typeof FEEDBACK_IMAGE_TYPES[number];
/** A stored report's screenshot file: <id>.<ext> beside its JSON in INBOX_DIR. */
export const FEEDBACK_IMAGE_EXT: Record<FeedbackImageType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
/** 16.11.2026: recorded takes a report may carry (MediaRecorder: Opus in WebM, AAC in MP4 on the iPhone), at most FEEDBACK_AUDIO_MAX. */
export const FEEDBACK_AUDIO_TYPES = ['audio/webm', 'audio/mp4'] as const;
export type FeedbackAudioType = typeof FEEDBACK_AUDIO_TYPES[number];
export const FEEDBACK_AUDIO_MAX = 4;
/** A stored report's recording files: <id>.a<n>.<ext> beside its JSON (n from 1). */
export const FEEDBACK_AUDIO_EXT: Record<FeedbackAudioType, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a' };
/** A report's `deliveryWarning` when its recording did not fit into the letter (the text and the screenshot went). */
export const AUDIO_DROPPED = 'The recording was too long and stays on your PC';
/** feedback.create `client`: where the report was written ("Android app 0.3.15 · Android 16 · SM-S918B · 412×915"), kept to this length. */
export const FEEDBACK_CLIENT_MAX = 400;
/** feedback.create `clientDiagnostics`: the writing device's own diagnostics (an Android crash report), kept to this length. */
export const FEEDBACK_CLIENT_DIAGNOSTICS_MAX = 12_000;
/** feedback.create `clientId`: the writing device's own id for the report – the same id returns the stored report. */
export const FEEDBACK_CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * AF-003: the short number the sender sees after Send and the team sees in its inbox for the same report – the first
 * eight letters and digits of the report's receipt id (the mailbox document id), upper case: "668FC8DE".
 */
export function reportNumber(receiptId: string): string {
  return receiptId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
}

/**
 * `feedback.status`: `sending` – this build has a receiver (resources/feedback/receiver.json: the team's public key
 * and the mailbox); without one a report is only saved on this PC and the UI says so. `receiving` – this PC holds the
 * team's private key (the vault), so Settings › Feedback shows the team inbox; always false for anyone but the owner.
 */
export interface FeedbackStatus {
  sending: boolean;
  receiving: boolean;
}

/** One report from the team inbox (<data>/feedback-inbox/<id>.json), opened on this PC. Untrusted text. */
export interface FeedbackInboxItem {
  id: string;
  /** When this PC fetched it. */
  receivedAt: number;
  /** When the sender wrote it (the sender's clock). */
  createdAt: number;
  kind?: FeedbackKind;
  text: string;
  appVersion: string;
  os: string;
  view?: string;
  /** Filed by one of the sender's agents (unverified), not by the person. */
  fromAgent?: boolean;
  /** 16.11.2026: where it was written ("Android app 0.3.15 · Android 16 · SM-S918B · 412×915"); absent from older senders. */
  client?: string;
  /** The sending company's data folder on its PC ('first', 'company-2'): two same-named companies told apart. */
  company?: string;
  /** The text was dictated (read it for what was meant). */
  dictated?: boolean;
  diagnostics?: string;
  /** The writing device's own diagnostics (an Android crash report), apart from the person's words. */
  clientDiagnostics?: string;
  screenshot?: { mime: FeedbackImageType; size: number };
  /** The recorded takes, stored beside the report as `file` (<id>.a<n>.webm|m4a); feedback.inboxAudio {id, index} plays one. */
  audio?: Array<{ mime: FeedbackAudioType; size: number; file: string }>;
  /** Feedback 16.11.2026: marked by the team – done (built) or not relevant; removed FEEDBACK_HANDLED_KEEP_MS after `at`. */
  handled?: { as: FeedbackHandled; at: number };
}

/** How the team closed a report in its inbox. */
export type FeedbackHandled = 'done' | 'irrelevant';
/** A marked report stays this long on the team's PC, then goes by itself (owner 16.11.2026: "nach ein paar Tagen"). */
export const FEEDBACK_HANDLED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** What one fetch did: `added` new reports, `unreadable` letters this PC's key cannot open or no sender of ours made. */
export interface FeedbackInboxFetch {
  added: number;
  unreadable: number;
  /** More letters wait than one fetch takes (fetch again). */
  more: boolean;
  /** Reports in this PC's inbox after the fetch. */
  total: number;
}

/** `feedback.setup` (wf feedback setup): what was stored and what the owner does next. */
export interface FeedbackSetupResult {
  publicKey: string;
  project: string;
  /** A new key pair was made (first setup or --rotate); false: the vault's key was kept. */
  createdKey: boolean;
  /** Where receiver.json was written; absent when the app runs from a package (write it into the source tree). */
  receiverFile?: string;
  /** receiver.json's content (public: the team's public key, the project and its web API key). */
  receiver: { publicKey: string; project: string; apiKey: string };
  /** The Firestore rules to paste (resources/feedback/firestore.rules). */
  rules: string;
}

declare module '../api/methods.ts' {
  interface Methods {
    /** 'chat' devices too (they may create and send reports): whether sending is set up in this build. */
    'feedback.status': { params: void; result: FeedbackStatus };
    // B-055, owner only: the team inbox on the PC holding the team's private key.
    'feedback.inboxList': { params: void; result: FeedbackInboxItem[] };
    /** Fetches the mailbox now (opened and stored on this PC; the letter stays for the team's other PCs and companies). */
    'feedback.inboxFetch': { params: void; result: FeedbackInboxFetch };
    /** Deletes the report on this PC and its letter in the mailbox (it does not come back). */
    'feedback.inboxRemove': { params: { id: string }; result: { ok: true } };
    /** Marks a stored report done or not relevant (null clears it); a marked one is removed 7 days later. */
    'feedback.inboxMark': { params: { id: string; as: FeedbackHandled | null }; result: FeedbackInboxItem };
    'feedback.inboxScreenshot': { params: { id: string }; result: { mime: FeedbackImageType; dataBase64: string } };
    /** 16.11.2026: one recorded take of a stored report – `index` into its `audio` list (0 = the first). */
    'feedback.inboxAudio': { params: { id: string; index: number }; result: { mime: FeedbackAudioType; dataBase64: string } };
    /** wf feedback setup: keys into the vault, receiver.json, the rules to paste. */
    'feedback.setup': { params: { project: string; apiKey: string; serviceAccountPath: string; rotate?: boolean }; result: FeedbackSetupResult };
  }
}

/** Autark-Plus: what the person ticked in the issue preview; everything else stays on the PC. */
export interface FeedbackIssueInclude {
  /** The page the report was made on. */
  view?: boolean;
  /** The redacted tail of warnings and errors from the app's log. */
  log?: boolean;
}

/** Autark-Plus: the GitHub issue exactly as it would go out (feedback.issuePreview). */
export interface FeedbackIssuePreview {
  repo: string;
  title: string;
  body: string;
  labels: string[];
  /** The prefilled github.com new-issue page. */
  url: string;
  /** A GitHub app is connected: Create issue files it directly; else the link opens in the browser. */
  connected: boolean;
}

/** Autark-Plus: feedback.fileIssue – `filed` false: nothing left the PC, open `url` (the prefilled new-issue page). */
export interface FeedbackIssueResult {
  report: import('./system.ts').FeedbackReport;
  url: string;
  filed: boolean;
}
