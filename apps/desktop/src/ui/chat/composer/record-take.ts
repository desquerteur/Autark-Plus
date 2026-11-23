// The composer's recordings (F23, owner 16.11.2026: audio and video "direkt angehängt an die Nachricht, also nicht
// transkribiert"): the key a chat's take is kept under until the draft holds it (IndexedDB 'take:compose:<chat id>',
// pwa/idb.ts, written by blocks/ui/recorder.ts – never one of an ask widget's keys), its file name, and the one upload
// that turns it into an attachment chip of the draft: chunked with progress (lib/files.ts uploadBlob, a person's device
// with the chat's id) and, like any recording or video, not bound to the 20 MB of other files – the runtime's chunk
// sessions bound it (300 MB, refused here before a byte goes). The stored copy goes only once the draft holds the chip and was saved. A second Attach of a chat
// while one runs joins it, so a take never goes in twice. Send waits while a chat's composer holds a take (holdsTake).
// Owns: the key, the names, attachTake, uploadMedia and which chats attach right now.
// Never: records, renders, or keeps a take after it is in the draft.

import { signal } from '@preact/signals';
import type { Attachment } from '../../../shared/model/chat.ts';
import { heldTakes } from '../../blocks/ui/media-devices.ts';
import { CHUNK_BYTES, toAttachment, uploadBlob } from '../../lib/files.ts';
import type { UploadRpc } from '../../lib/files.ts';
import { isPersonSession } from '../../lib/people.ts';
import { platform } from '../../lib/platform.ts';
import { rpc } from '../../lib/rpc.ts';
import { dropTake } from '../../pwa/idb.ts';
import { draftFor, flushDraft, updateDraft } from './draft.ts';

export type RecordKind = 'audio' | 'video';

/** Where a chat's composer keeps its take until the draft holds it (and the take guard's key). */
export function recordKey(conversationId: string): string {
  return `compose:${conversationId}`;
}

const pad = (value: number) => String(value).padStart(2, '0');
const stamp = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;

function extension(mime: string): string {
  if (mime.includes('mp4')) return mime.startsWith('audio') ? 'm4a' : 'mp4';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

/** "Recording 2026-11-16 14-03.webm" / "Video 2026-11-16 14-03.webm" in the device's time (no ':' – the store would turn it into '_'). */
export function recordName(mime: string, at: Date): string {
  return `${mime.startsWith('video/') ? 'Video' : 'Recording'} ${stamp(at)}.${extension(mime)}`;
}

/** "Photo 2026-11-16 14-03.jpg": a frame of the camera's preview. */
export function photoName(at: Date): string {
  return `Photo ${stamp(at)}.jpg`;
}

/** A recording or a video (Send's 20 MB of other files do not bind it). */
export function isMedia(file: { type: string }): boolean {
  return /^(audio|video)\//.test(file.type);
}

/** A touch device's browser or phone app: Take photo and Record video are the camera app's (<input capture>). */
export function phoneCamera(): boolean {
  return platform === 'pwa' && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** What one chunked upload may carry (runtime/rpc/uploads.ts UPLOAD_MAX_BYTES): a larger file is refused before it goes. */
export const MEDIA_MAX_BYTES = 300 * 1024 * 1024;

/** One recording or video into the store for this chat, chunked (≤ 4 MB at a time in memory); `onProgress` gets 0..1. */
export async function uploadMedia(blob: Blob, name: string, conversationId: string, onProgress?: (ratio: number) => void, via: UploadRpc = rpc): Promise<Attachment> {
  if (blob.size > MEDIA_MAX_BYTES) throw new Error(`${name} is larger than 300 MB.`);
  return toAttachment(await uploadBlob(blob, name, onProgress, via, CHUNK_BYTES, isPersonSession() ? conversationId : undefined));
}

/** Chats whose take is being attached right now. */
export const attachingIn = signal<ReadonlySet<string>>(new Set());
const running = new Map<string, Promise<Attachment>>();

/** The take a chat attaches right now (a revisit waits for it instead of offering it again). */
export function attachingTake(conversationId: string): Promise<Attachment> | undefined {
  return running.get(conversationId);
}

export interface TakeToAttach {
  blob: Blob;
  mime: string;
}

/**
 * The take becomes an attachment chip of the chat's draft; the draft is saved at once and only then does the stored
 * copy go. Rejects when the upload failed – the stored copy stays for Attach (or the next visit). A call while the
 * chat's take is still on its way returns that one.
 */
export function attachTake(conversationId: string, take: TakeToAttach, options: { onProgress?: (ratio: number) => void; via?: UploadRpc; now?: Date } = {}): Promise<Attachment> {
  const pending = running.get(conversationId);
  if (pending) return pending;
  const job = (async () => {
    const mime = take.mime.split(';')[0].trim() || take.blob.type.split(';')[0].trim() || 'application/octet-stream';
    const name = take.blob instanceof File && take.blob.name ? take.blob.name : recordName(mime, options.now ?? new Date());
    const attachment = await uploadMedia(new Blob([take.blob], { type: mime }), name, conversationId, options.onProgress, options.via);
    const chips = draftFor(conversationId).peek().attachments;
    // the same bytes are the same file id: an Attach again after an answer that got lost adds no second chip
    if (!chips.some((chip) => chip.fileId === attachment.fileId)) updateDraft(conversationId, { attachments: [...chips, attachment] });
    flushDraft(conversationId); // the chip is in the saved draft before the stored copy goes
    await dropTake(recordKey(conversationId));
    return attachment;
  })();
  running.set(conversationId, job);
  attachingIn.value = new Set([...attachingIn.peek(), conversationId]);
  const done = () => {
    running.delete(conversationId);
    const next = new Set(attachingIn.peek());
    next.delete(conversationId);
    attachingIn.value = next;
  };
  job.then(done, done);
  return job;
}

/** The chat's composer records, attaches or holds a take that is not in the draft yet: Send waits for it. */
export function holdsTake(conversationId: string): boolean {
  return heldTakes.value.has(recordKey(conversationId)) || attachingIn.value.has(conversationId);
}
