// The not-found page of a file, folder or media-by-path tab (B-081), in place of an empty editor or list: "<name> was not
// found[ on <PC>].", then the similar existing paths the PC that holds the path found (files.readPath / listPath `near`,
// the nearest existing folder last) – a click opens one as what it is (a picture etc. in the Media tab) in this tab's
// place, on the same PC – and on a file tab "Create <name>",
// which turns the tab into the editor (Ctrl+S makes the file). Plain rows of the new-tab page; nothing moves on a click.
// Owns: that page. Never: reads paths itself or makes the file (file-doc.ts).

import { useEffect } from 'preact/hooks';
import type { PathEntry } from '../../shared/api/methods-files.ts';
import { EmptyState } from '../lib/ui.tsx';
import { openNear } from './file-tabs.ts';
import { pcName, watchLinkedPcs } from './linked-pcs.ts';
import { Row } from './NewTabPage.tsx';
import { useSpace } from './space.ts';

/** The last part of a path ("C:\a\b.md" → "b.md"); the path itself at a root. */
export const leafOf = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The words above the rows (pure). */
export function missingText(path: string, device?: string): string {
  return `${leafOf(path)} was not found${device ? ` on ${pcName(device)}` : ''}.`;
}

/** Where a similar path lies, as its row's hint: the folder above it. */
const hintOf = (entry: PathEntry): string => {
  const cut = Math.max(entry.path.lastIndexOf('/'), entry.path.lastIndexOf('\\'));
  return cut > 0 ? entry.path.slice(0, cut) : '';
};

export function PathMissing(props: { id: string; path: string; device?: string; near: readonly PathEntry[]; onCreate?: () => void }) {
  const { id, path, device, near, onCreate } = props;
  const space = useSpace();
  useEffect(() => { if (device) watchLinkedPcs(); }, [device]); // the PC's name
  return (
    <>
      <EmptyState>{missingText(path, device)}</EmptyState>
      {near.length > 0 && (
        <ul class="new-tab-list" aria-label="Similar paths">
          {near.map((entry) => <Row key={entry.path} icon={entry.folder ? 'folder' : 'file'} label={entry.name} hint={hintOf(entry)} onClick={() => openNear(entry, id, space, device)} />)}
        </ul>
      )}
      {onCreate && <ul class="new-tab-list"><Row icon="plus" label={`Create ${leafOf(path)}`} onClick={onCreate} /></ul>}
    </>
  );
}
