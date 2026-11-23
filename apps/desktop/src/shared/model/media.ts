// Media library model: one row per stored file (image, recording, video, document) with
// optional human/AI descriptions and tags, so agents and the person can find media again.
// Owns: the plain-data shapes shared by runtime, UI, PWA and peers.
// Never: contains behaviour or file bytes (bytes live in the blob store, see FileRef).

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'other';

/** Metadata of one stored file in the media library. `fileId` is the FileRef id (sha256). */
export interface MediaInfo {
  fileId: string;
  conversationId?: string; // chat the file first appeared in (undefined = not linked to a chat)
  kind: MediaKind;
  mime: string;
  name: string;
  size?: number; // bytes (from the stored file; addition by the media package)
  width?: number;
  height?: number;
  durationMs?: number;
  pages?: number;
  /** 17.11.2026: a heavy video's light copy (H.264/MP4, short edge ≤ 720 px, ≈ 2.5 Mbit/s – shared/model/video-preview.ts) the players stream instead of `fileId`; the original stays the download. */
  previewFileId?: string;
  description?: string; // what the file shows/contains, written by the human or an agent
  tags?: string[];
  describedBy?: string; // 'human' or an agent id
  describedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Filter of media.list (all fields optional; `text` searches name, description and tags). */
export interface MediaFilter {
  conversationId?: string;
  /** These stored files only (a file has one owner chat, the first it was seen in – the same bytes sent in another chat are found by id). At most 100. */
  fileIds?: string[];
  kind?: MediaKind;
  text?: string;
  limit?: number;
}

/** Change accepted by media.describe (omitted fields stay as they are). */
export interface MediaPatch {
  description?: string;
  tags?: string[];
}

/** A rectangle of a picture in fractions 0–1 (a media: reference's region, shared/text/media-ref.ts). */
export interface MediaRegion { x: number; y: number; width: number; height: number }
