// 17.11.2026 (the owner via Clara, "Audio sollte man auch anhören können, wenn man es geschickt hat" – also while it still lies above the message field):
// whether an attachment is a recording to play. The runtime names a stored file by its bytes, and an audio-only WebM (or MP4/Ogg) looks like a video
// there – the app's own recordings are stored as `video/webm` – while the media library's probe knows it is sound (media row kind 'audio'). So a container
// type that may hold either counts as a recording when the library says so, or at once when it is one of the app's own takes (the name recordName() gave
// it: "Recording 2026-11-17 19-46.webm"); `audio/*` always does. The kinds come from media.list of the chat's audio rows and media.upserted (a probe that
// finished later flips a chip to its player).
// Owns: this rule and the kinds learned. Never: decides what a video is (viewKind, media-facts.ts), or reads a file.

import { signal } from '@preact/signals';
import type { Attachment } from '../../shared/model/chat.ts';
import type { MediaKind } from '../../shared/model/media.ts';
import { rpc } from './rpc.ts';

/** Container types whose files may hold sound only. */
const AMBIGUOUS = /^(?:video\/(?:webm|mp4|ogg|x-matroska|quicktime)|application\/ogg)$/i;
/** The name the composer gave a recording of sound (chat/composer/record-take.ts recordName; "Video …" is a video take). */
const OWN_TAKE = /^Recording \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.(?:webm|m4a|mp4|ogg)$/;

/** What the media library says about stored files (file id → kind), as far as learned. */
export const mediaKinds = signal<ReadonlyMap<string, MediaKind>>(new Map());

/** What the library says about a video (file id → length and light copy): the chat's play chip shows the length, the media block streams the copy. */
export const videoFacts = signal<ReadonlyMap<string, { durationMs?: number; previewFileId?: string }>>(new Map());

/** True when the attachment is a recording of sound: `audio/*`, or a container type that may hold either and is one (see the header). */
export function isRecording(attachment: Pick<Attachment, 'mime' | 'name' | 'fileId'>, kinds: ReadonlyMap<string, MediaKind> = mediaKinds.peek()): boolean {
  const type = attachment.mime.split(';')[0]!.trim().toLowerCase();
  if (type.startsWith('audio/')) return true;
  if (!AMBIGUOUS.test(type)) return false;
  return kinds.get(attachment.fileId) === 'audio' || OWN_TAKE.test(attachment.name);
}

function learn(rows: ReadonlyArray<{ fileId: string; kind: MediaKind; durationMs?: number; previewFileId?: string }>): void {
  if (!rows.length) return;
  const clips = new Map(videoFacts.peek());
  let clipChanged = false;
  for (const row of rows) {
    if (row.kind !== 'video') continue;
    const old = clips.get(row.fileId);
    if (old?.durationMs !== row.durationMs || old?.previewFileId !== row.previewFileId) { clips.set(row.fileId, { durationMs: row.durationMs, previewFileId: row.previewFileId }); clipChanged = true; }
  }
  if (clipChanged) videoFacts.value = clips;
  const next = new Map(mediaKinds.peek());
  let changed = false;
  for (const row of rows) if (next.get(row.fileId) !== row.kind) { next.set(row.fileId, row.kind); changed = true; }
  if (changed) mediaKinds.value = next;
}

let listening = false;
const asked = new Set<string>();
const askedFiles = new Set<string>();

/**
 * 18.11.2026 (Mika, window check): a stored file has ONE owner chat – the first it was seen in – so the same video sent
 * in a second chat was missing from that chat's media.list: no length on its chip, an empty Video tab. The chat's
 * attachments are asked for by their file ids too (once per file; a failed ask is tried again with the next call).
 */
export function learnFiles(fileIds: readonly string[]): void {
  const fresh = [...new Set(fileIds)].filter((id) => !askedFiles.has(id) && !videoFacts.peek().has(id) && !mediaKinds.peek().has(id));
  for (let at = 0; at < fresh.length; at += 100) {
    const batch = fresh.slice(at, at + 100);
    for (const id of batch) askedFiles.add(id);
    rpc.call('media.list', { fileIds: batch, limit: 100 }).then(learn, () => { for (const id of batch) askedFiles.delete(id); });
  }
}

/** Learns the audio and video files of a chat once (and follows media.upserted from then on); a failed ask is tried again with the next call. */
export function learnKinds(conversationId: string | undefined): void {
  if (!listening) {
    listening = true;
    try { rpc.on('media.upserted', (info) => learn([info])); } catch { listening = false; }
  }
  if (!conversationId || asked.has(conversationId)) return;
  asked.add(conversationId);
  const failed = () => asked.delete(conversationId);
  rpc.call('media.list', { conversationId, kind: 'audio', limit: 200 }).then(learn, failed);
  rpc.call('media.list', { conversationId, kind: 'video', limit: 200 }).then(learn, failed);
}
