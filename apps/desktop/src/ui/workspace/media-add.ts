// B-084 (decision 12) Media › "Add files": each picked file is stored like any upload (ui/lib/files.ts uploadRef, which
// already makes it a media row, media.upserted refreshes the list); inside a phone app it also gets the tag
// 'from phone', which says where it came from and lets the AI see a file no chat links (media/repo.ts AGENT_SCOPE).
// Tags the file already had stay. One file failing does not stop the others.
// Owns: that order (store, then tag) and the per-file outcome. Never: shows anything (MediaLibrary toasts failures),
// chooses which files are picked, or changes the 20 MB limit of uploadRef.

import type { MediaInfo } from '../../shared/model/media.ts';
import type { FileRef } from '../../shared/model/system.ts';

export const PHONE_TAG = 'from phone';

export interface AddDeps {
  upload(file: File): Promise<FileRef>;
  describe(params: { fileId: string; tags?: string[] }): Promise<MediaInfo>;
  /** True inside the Android app or the iPhone web app (pwa/native.ts isPhoneApp). */
  phone: boolean;
}

export interface AddFailure { name: string; error: unknown }

/** Stores the files one after the other (and tags them on a phone); returns the ones that failed. */
export async function addFiles(files: readonly File[], deps: AddDeps): Promise<AddFailure[]> {
  const failed: AddFailure[] = [];
  for (const file of files) {
    try {
      const ref = await deps.upload(file);
      if (!deps.phone) continue;
      const current = await deps.describe({ fileId: ref.id }); // no change: hands back the row as it is
      const tags = current.tags ?? [];
      if (!tags.includes(PHONE_TAG)) await deps.describe({ fileId: ref.id, tags: [...tags, PHONE_TAG] });
    } catch (error) {
      failed.push({ name: file.name, error });
    }
  }
  return failed;
}
