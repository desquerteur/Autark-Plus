// Speech meta of a human message: a dictated or spoken message (SendMessageInput.speech) becomes meta.via 'voice' +
// meta.speech { source, live? } – `live`: said in a live conversation or call, not dictated (such lines are never
// folded into a running turn). Older rows may say source 'windows'. B-082: the hidden marks beside the plain body
// (SendMessageInput.marks – unsure and dictated spans) are kept as meta.marks after cleanMarks checked them against the
// body; an edit changes the words they were made for, so it drops them (unmarked).
// Owns: that validation. Never: trusts more than these fields from the client, or puts marks into the body.

import { WorkforceError } from '../../shared/errors.ts';
import type { Message, MessageMeta, SpeechMeta } from '../../shared/model/chat.ts';
import { cleanMarks } from '../../shared/voice/marks.ts';

const SOURCES: ReadonlyArray<SpeechMeta['source']> = ['endpoint', 'windows'];

function invalid(expected: string): never {
  throw new WorkforceError('bad_request', `Invalid parameter speech: expected ${expected}.`, { details: { param: 'speech', expected } });
}

/** Validated speech meta; undefined when none was sent. Throws bad_request on a wrong shape. */
export function speechMeta(value: unknown): SpeechMeta | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) invalid('{source, live?}');
  const { source, live } = value as Record<string, unknown>;
  if (typeof source !== 'string' || !SOURCES.includes(source as SpeechMeta['source'])) invalid(`source ${SOURCES.join(' | ')}`);
  return { source: source as SpeechMeta['source'], ...(live === true ? { live: true as const } : {}) };
}

/** Message meta with the speech applied (via 'voice') and the body's checked marks; unchanged without either. */
export function withSpeech(meta: MessageMeta, value: unknown, body = '', marks?: unknown): MessageMeta {
  const speech = speechMeta(value);
  const kept = marks === undefined || marks === null ? undefined : cleanMarks(body, marks);
  return { ...meta, ...(speech ? { via: 'voice' as const, speech } : {}), ...(kept ? { marks: kept } : {}) };
}

/** The message without its marks when `body` replaces its words (messages.edit). */
export function unmarked(message: Message, body: string): Message {
  if (body === message.body || !message.meta?.marks) return message;
  const { marks: _marks, ...meta } = message.meta;
  return { ...message, meta };
}
