// `file` block: a deliverable. A path on a PC: Open on every device, the way a path in a chat opens (path-links.ts
// openPathLink: the side pane on the desktop, the chat's area on the phone, read on the author's home PC first – 16.11.:
// on the phone it did not open), plus Show in folder on the desktop. A stored copy only (fileId): Open on the desktop,
// Download on the phone; inside the Android app Download hands the bytes to the app (pwa/phone-download.ts).
// Owns: file row rendering and the download. Never: opens paths outside the host's own checks
// (main decides) or shows an absolute path off the desktop.

import { useState } from 'preact/hooks';
import type { UiBlock } from '../../../shared/blocks/catalog.ts';
import { Icon } from '../../lib/ui.tsx';
import { rpc } from '../../lib/rpc.ts';
import { toastError } from '../../lib/toasts.ts';
import { isFileId, openPath, platform } from '../host.ts';
import { Inline } from '../markdown.tsx';
import { saveToPhone } from '../../pwa/phone-download.ts';
import { openPathLink, pathIn } from '../../workspace/path-links.ts';
import { s } from './util.ts';

/** files.read sends at most this much in one frame (runtime READ_MAX_BYTES). */
const DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? '';

async function download(fileId: string, name: string): Promise<void> {
  const { dataBase64, mime } = await rpc.call('files.read', { id: fileId, maxBytes: DOWNLOAD_MAX_BYTES });
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  if (await saveToPhone(blob, name)) return; // the Android app: into the phone's Downloads (B-084)
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000); // one-shot: give the browser time to start the download
}

export function FileBlock(props: { block: UiBlock }) {
  const path = s(props.block.path);
  const fileId = isFileId(s(props.block.fileId)) ? s(props.block.fileId) : '';
  const fileName = baseName(path);
  const name = s(props.block.label) || fileName || 'File';
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try { await work(); } catch (error) { toastError(error, failure); } finally { setBusy(false); }
  };
  const desktop = platform === 'desktop';
  const onPc = pathIn(path, false) !== undefined; // an absolute path on a PC (a network path is none)
  const open = (event: Event) => {
    if (onPc) { void openPathLink(path, (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-author]')?.dataset.author); return; }
    void act(() => rpc.call('files.open', { id: fileId, reveal: false }), "Couldn't open the file");
  };
  const canOpen = onPc || (desktop && fileId !== '');
  return (
    <div class="b-file">
      <Icon name="file" size={20} />
      <div class="b-file-text">
        <div class="b-file-name" title={desktop ? path || name : name}>{name}</div>
        {props.block.note !== undefined && <Inline text={s(props.block.note)} class="b-step-sub" />}
      </div>
      {(canOpen || (!desktop && fileId !== '')) && (
        <div class="b-file-actions">
          {canOpen && <button type="button" class="button secondary" disabled={busy} onClick={open}>Open</button>}
          {desktop && onPc && <button type="button" class="button ghost" disabled={busy} onClick={() => act(() => openPath(path, true), "Couldn't open the file")}>Show in folder</button>}
          {!desktop && fileId && <button type="button" class="button secondary" disabled={busy} onClick={() => act(() => download(fileId, fileName || name), "Couldn't download the file")}>Download</button>}
        </div>
      )}
    </div>
  );
}
