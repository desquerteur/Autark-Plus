// B-084 (decision 12) MediaView › "Save to phone" / "Download" off the desktop: inside the Android app with its port the
// bytes (≤ 25 MB) are fetched from this page's own /files route and handed to the app (pwa/phone-download.ts), which
// writes them to the phone's Downloads; in a plain browser a file of that size goes through a blob: link, so the
// browser's download list never keeps the device token of the /files URL; otherwise, or when that fails, a same-origin
// link to the same route with `download=1` (runtime/http/files.ts answers `attachment` with the stored name), which the
// browser or the app's DownloadListener saves. The desktop's "Save" is files.open with reveal (MediaView), not here.
// Owns: that choice and the link. Never: builds a URL for anything but a stored blob (lib/media-stream.ts streamUrl).

import type { FileRef } from '../../shared/model/system.ts';
import { streamUrl } from '../lib/media-stream.ts';
import { isAndroidApp } from '../pwa/native.ts';
import { hasNativePort } from '../pwa/native-port.ts';
import { PHONE_DOWNLOAD_MAX, saveToPhone } from '../pwa/phone-download.ts';

export interface SaveDeps {
  url(fileId: string): string | null;
  port(): boolean;
  /** False inside the Android app: its WebView saves no blob: download. */
  blobs(): boolean;
  fetchBlob(url: string): Promise<Blob>;
  toPhone(blob: Blob, name: string): Promise<boolean>;
  follow(url: string, name: string): void;
  /** Saves fetched bytes through a blob: link. */
  saveBlob(blob: Blob, name: string): void;
}

/** The /files link of a stored file that the browser saves instead of showing (null where this page has no route). */
export function downloadUrl(fileId: string, url: (id: string) => string | null = streamUrl): string | null {
  const base = url(fileId);
  return base ? `${base}${base.includes('?') ? '&' : '?'}download=1` : null;
}

function followLink(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.click();
}

const PAGE: SaveDeps = {
  url: streamUrl,
  port: hasNativePort,
  blobs: () => !isAndroidApp(),
  fetchBlob: async (url) => {
    const reply = await fetch(url);
    if (!reply.ok) throw new Error(reply.status === 404 ? 'This file is not here and its PC is not reachable right now.' : `The file could not be read (${reply.status}).`);
    return reply.blob();
  },
  toPhone: saveToPhone,
  follow: followLink,
  saveBlob: (blob, name) => {
    const local = URL.createObjectURL(blob);
    followLink(local, name);
    setTimeout(() => URL.revokeObjectURL(local), 60_000); // armed by this save; the download has started by then
  },
};

/** 'phone' = the app saved it, 'link' = handed to the browser's download; throws when this page has no file route. */
export async function saveFile(file: FileRef, deps: SaveDeps = PAGE): Promise<'phone' | 'link'> {
  const url = deps.url(file.id);
  if (!url) throw new Error("This file can't be saved here.");
  if (file.size <= PHONE_DOWNLOAD_MAX && (deps.port() || deps.blobs())) {
    const blob = await deps.fetchBlob(url);
    if (deps.port() && await deps.toPhone(blob, file.name)) return 'phone';
    if (deps.blobs()) { deps.saveBlob(blob, file.name); return 'link'; }
  }
  deps.follow(downloadUrl(file.id, () => url) ?? url, file.name);
  return 'link';
}
