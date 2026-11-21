// The write-only mailbox (B-055 Q2): one sealed letter becomes one Firestore document feedback/<id> through the REST
// API with the project's public web API key – no SDK, no sign-in. The document id is the report's stable request id,
// so a retry after a lost answer finds its own letter (HTTP 409 ALREADY_EXISTS = it arrived) instead of a second one.
// The rule (resources/feedback/firestore.rules) allows only this create: fields v = 1 and sealed (bytes < 1,000,000).
// A failed create keeps its cause in the error's details (B-085): `reason` (DropReason) and the HTTP `status`.
// Feedback 16.11.2026: the letter also carries `exp` (a timestamp LETTER_TTL_MS ahead) – the mailbox's Firestore TTL
// policy deletes a letter nobody fetched by then. A mailbox whose rules do not know `exp` yet (rules before v2)
// refuses it: then the same letter goes once more without it, so no version order between rules and app matters.
// Owns: the create request and what its answer means. Never: reads, lists or deletes letters (inbox.ts, team only),
// sends anything but the sealed bytes, or carries a remote error body into an error.

import { FEEDBACK_SEALED_LIMIT } from '../../shared/model/feedback-delivery.ts';
import { WorkforceError } from '../../shared/errors.ts';
import type { ReceiverConfig } from './receiver.ts';
import { FIRESTORE_ORIGIN, request } from './transport.ts';

/** Firestore document ids the rule accepts (≤ 64 characters; we only ever use these characters). */
export const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Why it did not go – the panel's line above already says the report is saved on this PC.
export const NOT_SET_UP = 'Sending feedback is not set up in this version.';
const RETRY = 'Feedback could not be sent right now; try again later.';
const REFUSED = 'The feedback mailbox refused this report.';
// AF-003: why a send failed, in the one line the form shows (`details.reason` for the runtime log).
const OFFLINE = 'Feedback could not be sent right now: the feedback server is not reachable. Check the internet connection; try again later.';
const SLOW = 'Feedback could not be sent right now: the feedback server did not answer in time; try again later.';

/**
 * How long a letter stays in the mailbox: every team receiver deletes one older than this by Google's createTime
 * (inbox.ts, 16.11.2026), and `exp` lets Firestore's TTL policy do it too where it is set (rules v2 allow up to 31 days).
 */
export const LETTER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Why a report did not reach the mailbox (WorkforceError details.reason). */
export type DropReason = 'offline' | 'timeout' | 'refused' | 'server' | 'not_set_up';

/** The cause of a failed request: no answer in time (transport.ts timeout) or no connection at all. */
export function networkReason(error: unknown): DropReason {
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'offline';
}

/** The documents URL of the mailbox (`endpoint`: a local fake in tests). */
export function documentsUrl(config: Pick<ReceiverConfig, 'project' | 'endpoint'>): string {
  return `${config.endpoint ?? FIRESTORE_ORIGIN}/v1/projects/${encodeURIComponent(config.project)}/databases/(default)/documents`;
}

/**
 * Creates feedback/<id> with the sealed bytes. 'created': it is in the mailbox now; 'exists': an earlier attempt
 * already put it there (only this sender knows the id). The answer echoes only `v` (mask), never the letter.
 */
export async function dropSealed(config: ReceiverConfig, id: string, sealed: Uint8Array, run: typeof fetch = fetch, now: () => number = Date.now): Promise<'created' | 'exists'> {
  if (!DOCUMENT_ID.test(id)) throw new WorkforceError('bad_request', 'Invalid feedback id.');
  if (sealed.byteLength > FEEDBACK_SEALED_LIMIT) throw new WorkforceError('bad_request', 'This report is too large to send.');
  const url = `${documentsUrl(config)}/feedback?documentId=${encodeURIComponent(id)}&mask.fieldPaths=v&key=${encodeURIComponent(config.apiKey)}`;
  const fields = { v: { integerValue: '1' }, sealed: { bytesValue: Buffer.from(sealed).toString('base64') } };
  const post = async (body: string): Promise<number> => {
    try {
      return (await request(run, url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, 0)).status;
    } catch (error) {
      const reason = networkReason(error);
      throw new WorkforceError('unavailable', reason === 'timeout' ? SLOW : OFFLINE, { details: { reason } }); // AF-003
    }
  };
  let status = await post(JSON.stringify({ fields: { ...fields, exp: { timestampValue: new Date(now() + LETTER_TTL_MS).toISOString() } } }));
  if (status === 400 || status === 403) status = await post(JSON.stringify({ fields })); // rules before v2: the letter without exp
  if (status >= 200 && status < 300) return 'created';
  if (status === 409) return 'exists';
  if (status === 400 || status === 403 || status === 404) throw new WorkforceError('unavailable', REFUSED, { details: { reason: 'refused', status } });
  throw new WorkforceError('unavailable', RETRY, { details: { reason: 'server', status } });
}
