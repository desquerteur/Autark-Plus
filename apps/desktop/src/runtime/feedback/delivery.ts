// Sending one report (B-055 Q1/Q2): its facts, the (marked) screenshot and – 16.11.2026 – the recorded takes become one
// JSON payload, sealed on this PC for the team's public key (seal.ts) and dropped into the write-only mailbox
// (drop.ts). Everything is private now: the old public GitHub path is gone and `visibility` is ignored.
// The outbox (kv `feedback-submissions`) holds only the sealed envelope, its request id and where it goes – never the
// text, the screenshot or the recording – and is written before any network I/O, so a retry after a lost answer
// sends the identical letter under the same id. After delivery only the receipt stays (the envelope is dropped). A
// letter the mailbox refused carries `refused` until a later try goes otherwise (the automatic resend leaves it).
// The recordings go all or none: when they do not fit into FEEDBACK_SEALED_LIMIT beside the text and the screenshot,
// the letter goes without them and says so (AUDIO_DROPPED) – the text always goes.
// Owns: the complete payload, its size budget, the outbox and the report's delivered state.
// Never: drops an attached screenshot, sends plaintext, resends an older (GitHub or receiver) submission,
// or claims delivery before the mailbox answered.

import { randomUUID } from 'node:crypto';
import type { RuntimeServices } from '../contracts.ts';
import type { FeedbackKind, FeedbackReport } from '../../shared/model/system.ts';
import {
  AUDIO_DROPPED, FEEDBACK_CLIENT_DIAGNOSTICS_MAX, FEEDBACK_CLIENT_MAX, FEEDBACK_IMAGE_TYPES, FEEDBACK_SEALED_LIMIT, SCREENSHOT_DROPPED,
  type FeedbackAudioType, type FeedbackImageType,
} from '../../shared/model/feedback-delivery.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { KvRepo } from '../store/kv.ts';
import { audioType } from './letter.ts';
import { redactText } from '../../shared/secrets/redact-text.ts';
import { sealReport } from './seal.ts';
import { dropSealed, NOT_SET_UP } from './drop.ts';
import type { ReceiverConfig } from './receiver.ts';

export const OUTBOX = 'feedback-submissions';
/** What sealing adds to the payload's bytes (seal.ts: magic, ephemeral key, nonce, tag). */
const SEAL_BYTES = 64;

/** What the team opens (letter.ts checks it again – a letter is untrusted input). */
export interface FeedbackPayload {
  v: 1;
  id: string;
  createdAt: number;
  kind?: FeedbackKind;
  text: string;
  appVersion: string;
  os: string;
  view?: string;
  /** Filed by an agent of the sender (unverified). */
  fromAgent?: true;
  /** Where the person wrote it (the writing page's facts, redacted). */
  client?: string;
  /** The sending company's data folder ('first', 'company-2'). */
  company?: string;
  screenshot?: { mime: FeedbackImageType; base64: string };
  diagnostics?: string;
  /** The writing device's own diagnostics (an Android crash report), redacted. */
  clientDiagnostics?: string;
  /** The recorded takes, in order. */
  audio?: Array<{ mime: FeedbackAudioType; base64: string }>;
  /** The text was dictated (the report had recorded takes, sent or not). */
  dictated?: true;
}

/** One outbox entry: ciphertext and routing only. `sealed` is gone once `deliveredAt` is set. */
export interface OutboxEntry {
  v: 1;
  requestId: string;
  project: string;
  recipient: string;
  sealed?: string;
  warning?: string;
  deliveredAt?: number;
  /** The mailbox refused the last try (drop.ts reason 'refused'): no automatic resend. */
  refused?: true;
}

/** A sealed letter still to go that the automatic resend may try again (not refused, not delivered). */
export function resendable(entry: OutboxEntry | undefined): boolean {
  return entry?.v === 1 && Boolean(entry.sealed) && !entry.deliveredAt && !entry.refused;
}

const OLDER = 'This older submission cannot be sent again. Its original delivery stands.';
const SCREENSHOT_TOO_LARGE = 'The screenshot is too large to send. Your complete report is saved on this PC; use a smaller screenshot.';

async function screenshotOf(s: RuntimeServices, report: FeedbackReport): Promise<FeedbackPayload['screenshot'] | undefined> {
  const imageId = report.annotationFileId ?? report.screenshotFileId;
  if (!imageId) return undefined;
  const file = s.files.get(imageId);
  if (!file || !(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.mime)) throw new WorkforceError('bad_request', 'Choose a PNG, JPEG or WebP screenshot.');
  if (file.size > FEEDBACK_SEALED_LIMIT) throw new WorkforceError('bad_request', SCREENSHOT_TOO_LARGE); // not even read
  const bytes = await s.files.read(imageId);
  return { mime: file.mime as FeedbackImageType, base64: Buffer.from(bytes).toString('base64') };
}

/**
 * The recorded takes when all of them fit into `room` bytes of JSON (base64 inside), else 'too large' – then none is
 * even read. A take that is gone or no WebM/MP4 is left out (the text still goes).
 */
async function audioOf(s: RuntimeServices, report: FeedbackReport, room: number): Promise<FeedbackPayload['audio'] | 'too large' | undefined> {
  const files = (report.audioFileIds ?? []).map((id) => ({ id, file: s.files.get(id) })).filter((entry) => entry.file);
  if (!files.length) return undefined;
  const need = files.reduce((sum, entry) => sum + Math.ceil(entry.file!.size / 3) * 4 + 40, 12); // ',"audio":[…]' and one '{"mime":…,"base64":"…"}' each
  if (need > room) return 'too large';
  const takes: NonNullable<FeedbackPayload['audio']> = [];
  for (const entry of files) {
    let bytes: Uint8Array;
    try { bytes = await s.files.read(entry.id); } catch { continue; }
    const mime = audioType(bytes);
    if (mime) takes.push({ mime, base64: Buffer.from(bytes).toString('base64') });
  }
  return takes.length ? takes : undefined;
}

/** The complete payload sealed for the receiver; an oversized screenshot keeps the report local, an oversized recording stays behind. */
async function sealFor(s: RuntimeServices, report: FeedbackReport, requestId: string, diagnostics: string | undefined, config: ReceiverConfig): Promise<{ sealed: Buffer; warning?: string }> {
  const clean = (value: string) => redactText(s.secrets.redact(value)); // the vault may know more values than at create
  const { context } = report;
  const payload: FeedbackPayload = {
    v: 1, id: requestId, createdAt: report.createdAt, ...(report.kind ? { kind: report.kind } : {}), text: clean(report.text),
    appVersion: clean(context.version).slice(0, 120), os: clean(context.os).slice(0, 120),
    ...(context.view ? { view: clean(context.view).slice(0, 120) } : {}),
    ...(report.author !== 'human' ? { fromAgent: true as const } : {}),
    ...(context.client ? { client: clean(context.client).slice(0, FEEDBACK_CLIENT_MAX) } : {}),
    ...(context.company ? { company: context.company } : {}),
    ...(diagnostics ? { diagnostics: clean(diagnostics).slice(0, 12_000) } : {}),
    ...(context.clientDiagnostics ? { clientDiagnostics: clean(context.clientDiagnostics).slice(0, FEEDBACK_CLIENT_DIAGNOSTICS_MAX) } : {}),
    ...(report.audioFileIds?.length ? { dictated: true as const } : {}),
  };
  const shot = await screenshotOf(s, report);
  if (shot) payload.screenshot = shot;
  const seal = () => sealReport(config.publicKey, Buffer.from(JSON.stringify(payload), 'utf8'));
  let warning: string | undefined;
  const audio = await audioOf(s, report, FEEDBACK_SEALED_LIMIT - SEAL_BYTES - Buffer.byteLength(JSON.stringify(payload), 'utf8'));
  if (audio === 'too large') warning = AUDIO_DROPPED; else if (audio) payload.audio = audio;
  let bytes = seal();
  if (bytes.length > FEEDBACK_SEALED_LIMIT && payload.audio) { // the estimate was short: the letter without the recording
    delete payload.audio;
    warning = AUDIO_DROPPED;
    bytes = seal();
  }
  if (bytes.length > FEEDBACK_SEALED_LIMIT) throw new WorkforceError('bad_request', shot ? SCREENSHOT_TOO_LARGE : 'This report is too large to send.');
  return { sealed: bytes, ...(warning ? { warning } : {}) };
}

/** Refuses older submissions (B-034 receiver, B-035 GitHub, B-036 plaintext outbox); strips an old plaintext payload. */
function refuseOlder(s: RuntimeServices, kv: KvRepo, report: FeedbackReport): OutboxEntry | undefined {
  if (kv.get('feedback-delivery', report.id) || kv.get('feedback-github', report.id)) throw new WorkforceError('conflict', OLDER);
  const stored = kv.get<OutboxEntry | { payload?: unknown; receipt?: { state?: string } }>(OUTBOX, report.id);
  if (stored && (stored as OutboxEntry).v !== 1) {
    const state = (stored as { receipt?: { state?: string } }).receipt?.state;
    kv.set(OUTBOX, report.id, { v: 0, older: true, ...(state ? { state } : {}) }, s.clock.now()); // no plaintext stays behind
    throw new WorkforceError('conflict', OLDER);
  }
  if (!stored && report.receiptId) throw new WorkforceError('conflict', OLDER);
  return stored as OutboxEntry | undefined;
}

/** Seals (once) and drops report `report`; returns it as sent. */
export async function deliver(s: RuntimeServices, report: FeedbackReport, diagnostics: string | undefined, config: ReceiverConfig | undefined,
  run?: typeof fetch): Promise<FeedbackReport> {
  const kv = new KvRepo(s.db);
  let entry = refuseOlder(s, kv, report);
  if (!config) throw new WorkforceError('unavailable', NOT_SET_UP, { details: { reason: 'not_set_up' } });
  if (!entry?.deliveredAt) {
    // An older build may already have uploaded its text-only envelope before losing the answer. A new id is
    // needed to include the screenshot; do not turn that earlier attempt into a successful complete delivery.
    if (entry?.warning === SCREENSHOT_DROPPED) throw new WorkforceError('conflict', 'This earlier submission omitted its screenshot. Create a new report to send the screenshot.');
    // A new receiver (another project or a rotated key) gets a new letter under the same id; an identical retry resends the same bytes.
    if (!entry?.sealed || entry.project !== config.project || entry.recipient !== config.publicKey) {
      const requestId = entry?.requestId ?? randomUUID();
      const { sealed, warning } = await sealFor(s, report, requestId, diagnostics, config);
      entry = { v: 1, requestId, project: config.project, recipient: config.publicKey, sealed: sealed.toString('base64'), ...(warning ? { warning } : {}) };
      kv.set(OUTBOX, report.id, entry, s.clock.now()); // before external I/O
    }
    // exp counts from the report's own time, so a retry sends the very same letter (a months-old report: without exp).
    try {
      await dropSealed(config, entry.requestId, Buffer.from(entry.sealed!, 'base64'), run, () => report.createdAt);
    } catch (error) {
      const refused = error instanceof WorkforceError && error.details?.reason === 'refused';
      if (refused !== Boolean(entry.refused)) {
        const { refused: _old, ...rest } = entry;
        kv.set(OUTBOX, report.id, refused ? { ...rest, refused: true } : rest, s.clock.now());
      }
      throw error;
    }
    const { refused: _refused, ...receipt }: OutboxEntry = { ...entry, deliveredAt: s.clock.now() };
    delete receipt.sealed; // delivered: only the receipt stays
    entry = receipt;
    kv.set(OUTBOX, report.id, entry, s.clock.now());
  }
  const sent: FeedbackReport = { ...report, status: 'sent', receiptId: entry.requestId, visibility: 'private', sentAt: entry.deliveredAt };
  delete sent.url;
  if (entry.warning) sent.deliveryWarning = entry.warning; else delete sent.deliveryWarning;
  return sent;
}
