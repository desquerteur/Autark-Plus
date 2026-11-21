// The ways to a path in a surface: open a file tab or a folder tab (what the path holds decides), the docs behind file
// tabs (a doc with typed text stays when its tab goes) and the right-click menu of a path. Any part of the app calls these;
// a tab opens in `space`, else where `inPlaceOf` is shown, else where the frame says (pages.ts openPanel) – on the phone
// too, where it shows its PC's file. B-076: a path of a linked PC names it in `device`; reads and writes go there.
// B-081: a path that holds nothing opens the not-found page (similar paths, Create) – an app-own file meant to be made
// (openFileTab `create`: Settings, an agent's files) goes straight to the editor; the same path opens on another PC in
// the same tab place (openPathOn, the three-dots menu's Open on); a picture, video, audio file or PDF met as a file can
// be shown in the Media tab (showable / showInMedia, FileView's Show); a similar path of the not-found page opens as what
// it is (openNear). A file of a linked PC can be brought here, and on the phone any file saved to the phone (saveHere,
// FileView's foot line): the PC that holds it stores it (files.uploadPath), then the desktop shows a copy in its folder
// (files.open with reveal, as the Media tab's Save – a copy in the runtime's temp, swept after a day, so the button says
// "copy", not "save"; a lasting save needs a runtime op: patches/W3-files.md F) and the phone saves it (media-save.ts).
// Owns: those. Never: draws a tab (FileView.tsx, FolderView.tsx, PathMissing.tsx) or tab logic (pages.ts).

import '../../shared/api/methods-files.ts'; // the files.*Path method shapes (module augmentation)
import type { MenuSection } from '../lib/popover.tsx';
import { platform } from '../lib/platform.ts';
import { errorText, rpc, RpcError } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { pushToast, toastError } from '../lib/toasts.ts';
import { isPhoneApp } from '../pwa/native.ts';
import { FileDoc } from './file-doc.ts';
import { viewKind } from './media-facts.ts';
import { saveFile } from './media-save.ts';
import { openPanel } from './pages.ts';

const docs = new Map<string, FileDoc>();
/** App-own files meant to be made (openFileTab `create`): while missing they open in the editor, also when shown again. */
const making = new Set<string>();
const docKey = (path: string, device?: string) => `${device ?? ''}\n${path}`;
/** The params naming the linked PC a path is on (none: this PC). */
export const onPc = (device?: string): { device?: string } => (device ? { device } : {});

export function docFor(path: string, device?: string): FileDoc {
  const key = docKey(path, device);
  let doc = docs.get(key);
  if (!doc) {
    doc = new FileDoc(path, {
      read: (at, since) => rpc.call('files.readPath', { path: at, ...(since === undefined ? {} : { since }), ...onPc(device) }),
      write: (at, text, base) => rpc.call('files.writePath', { path: at, text, ...(base === undefined ? {} : { base }), ...onPc(device) }),
      conflict: (error) => error instanceof RpcError && error.code === 'conflict',
      errorText,
    }, device);
    if (making.has(key)) doc.create();
    docs.set(key, doc);
  }
  return doc;
}

/** The file's tab is gone or not shown: nothing typed, nothing to keep. */
export function releaseDoc(doc: FileDoc): void {
  if (!doc.state.peek().dirty) docs.delete(docKey(doc.path, doc.device));
}

/** `create`: an app-own file meant to be made – missing, it opens in the editor (Ctrl+S makes it), not the not-found page. */
export interface FileTabOptions { create?: boolean }

export function openFileTab(path: string, inPlaceOf?: string, space?: string, device?: string, options?: FileTabOptions): void {
  if (options?.create) {
    making.add(docKey(path, device));
    docs.get(docKey(path, device))?.create();
  }
  openPanel({ kind: 'file', path, ...onPc(device) }, inPlaceOf, space);
}

export function openFolderTab(path: string, inPlaceOf?: string, space?: string, device?: string): void {
  openPanel({ kind: 'folder', path, ...onPc(device) }, inPlaceOf, space);
}

/** Opens what `path` holds as a tab; a path that holds nothing opens a file tab with the not-found page. Failures throw. */
export async function openPathTab(path: string, inPlaceOf?: string, space?: string, device?: string): Promise<void> {
  const read = await rpc.call('files.readPath', { path, ...onPc(device) });
  if (read.state === 'folder') openFolderTab(read.path, inPlaceOf, space, device);
  else openFileTab(read.path, inPlaceOf, space, device);
}

/** A path tab as the three-dots menu sees it. */
export interface PathTab { id: string; kind: 'file' | 'folder' | 'media'; path: string; name?: string }

/** The same path on PC `device` (none: this PC), in the place of `entry`'s tab – nothing else in the strip moves. */
export function openPathOn(entry: PathTab, device: string | undefined, space: string): void {
  const at = { path: entry.path, ...onPc(device) };
  if (entry.kind === 'media') openPanel({ kind: 'media', ...at, ...(entry.name ? { name: entry.name } : {}) }, entry.id, space);
  else openPanel({ kind: entry.kind, ...at }, entry.id, space);
}

/** A file the Media tab can show by its name: a picture, video, audio file or PDF. */
export const showable = (path: string): boolean => viewKind('', path) !== 'file';

/** Shows the file in the Media tab in place of `inPlaceOf` – on a linked PC too (the PC that holds it stores it first). */
export function showInMedia(path: string, inPlaceOf?: string, space?: string, device?: string): void {
  openPanel({ kind: 'media', path, ...onPc(device) }, inPlaceOf, space);
}

/** A similar path of the not-found page, in that tab's place on the same PC: a folder tab, the Media tab, else a file tab. */
export function openNear(entry: { path: string; folder: boolean }, inPlaceOf: string, space?: string, device?: string): void {
  if (entry.folder) openFolderTab(entry.path, inPlaceOf, space, device);
  else if (showable(entry.path)) showInMedia(entry.path, inPlaceOf, space, device);
  else openFileTab(entry.path, inPlaceOf, space, device);
}

/** A file tab offers a save here: on the desktop for a linked PC's file, off the desktop (the phone) for every file. */
export const savesHere = (device?: string, desktop = platform === 'desktop'): boolean =>
  desktop ? Boolean(device) && can('files.open') : can('files.uploadPath');

/** The words of that save as they are: the desktop's copy here (kept a day), the phone app's Downloads, a browser's download. */
export function saveHereWords(desktop = platform === 'desktop'): { label: string; hint?: string; failed: string } {
  if (desktop) return { label: 'Show a copy here', hint: 'A copy on this PC, kept for a day, shown in its folder', failed: "Couldn't copy the file here" };
  return { label: isPhoneApp() ? 'Save to phone' : 'Download', failed: "Couldn't save the file" };
}

/** The file onto this device: the PC that holds it stores it, then the desktop shows a copy in its folder here (temp,
 *  swept after a day) and the phone saves it. Failures throw. */
export async function saveHere(path: string, device?: string, desktop = platform === 'desktop'): Promise<void> {
  const file = await rpc.call('files.uploadPath', { path, ...onPc(device) });
  if (desktop) await rpc.call('files.open', { id: file.id, reveal: true });
  else await saveFile(file);
}

export function openWithSystem(path: string, reveal = false): void {
  rpc.call('files.openPath', { path, reveal, anywhere: true }).catch((error: unknown) => toastError(error, 'Could not open it'));
}

/** A path's right-click menu (a path of another PC: only its copy – the system's apps are this PC's). */
export function pathMenu(path: string, device?: string): MenuSection[] {
  const copy = { label: 'Copy path', onSelect: () => { navigator.clipboard.writeText(path).then(() => pushToast({ title: 'Copied', tone: 'info' }, 1500), (error: unknown) => toastError(error, 'Could not copy')); } };
  if (device) return [{ items: [copy] }];
  return [{ items: [
    { label: 'Open with system', onSelect: () => openWithSystem(path) },
    { label: 'Show in folder', onSelect: () => openWithSystem(path, true) },
    copy,
  ] }];
}
