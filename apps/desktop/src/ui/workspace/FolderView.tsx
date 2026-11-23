// Pane tab › a folder: one list, folders first, with "Up" on top. A folder opens in this tab, a file in a file tab of its
// own, both in this surface's space (space.ts); a right click offers the system's own app. The list is read again every few seconds while the tab is shown, so a
// file an agent adds shows up. B-076: a folder of a linked PC (`device`) is listed there and what opens from it stays
// that PC's; while that PC is offline the list says so in one line and the next look tries again; the list scrolls in
// step with the same tab elsewhere (view-sync.ts). B-081: a folder that does not exist shows the not-found page with
// the similar paths found on its PC (PathMissing.tsx; no Create – folders come with the files saved into them).
// Owns: that list. Never: reads or changes a file (FileView.tsx).

import { useEffect, useRef, useState } from 'preact/hooks';
import type { PathEntry, PathList } from '../../shared/api/methods-files.ts';
import { useContextMenu } from '../lib/context-menu.tsx';
import { errorText, rpc } from '../lib/rpc.ts';
import { EmptyState, Spinner } from '../lib/ui.tsx';
import { onPc, openFileTab, openFolderTab, openPathTab, pathMenu } from './file-tabs.ts';
import { Row } from './NewTabPage.tsx';
import { PathMissing } from './PathMissing.tsx';
import { useSpace } from './space.ts';
import { useScrollPosition } from './view-sync.ts';

const REFRESH_MS = 3000;

function EntryRow(props: { id: string; entry: PathEntry; device?: string }) {
  const { id, entry, device } = props;
  const space = useSpace();
  const menu = useContextMenu(() => pathMenu(entry.path, device));
  return <Row icon={entry.folder ? 'folder' : 'file'} label={entry.name} menu={menu} onClick={() => { if (entry.folder) openFolderTab(entry.path, id, space, device); else openFileTab(entry.path, undefined, space, device); }} />;
}

export function FolderView(props: { id: string; path: string; device?: string }) {
  const { id, path, device } = props;
  const space = useSpace();
  const scroller = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<PathList | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    let alive = true;
    let last = '';
    const read = () => rpc.call('files.listPath', { path, ...onPc(device) }).then((next) => {
      if (!alive) return;
      setFailed('');
      const text = JSON.stringify(next);
      if (text !== last) { last = text; setList(next); }
    }, (error: unknown) => { if (alive) setFailed(errorText(error)); });
    void read();
    const timer = setInterval(() => { if (!document.hidden) void read(); }, REFRESH_MS);
    const shown = () => { if (!document.hidden) void read(); }; // a hidden window looks again when it is shown
    document.addEventListener('visibilitychange', shown);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', shown); };
  }, [path, device]);
  // A path that holds a file after all (it was replaced, or the tab came back) opens as what it is.
  useEffect(() => { if (failed) void openPathTab(path, id, space, device).catch(() => undefined); }, [failed]);
  useScrollPosition(id, scroller, list);

  const up = list?.parent;
  return (
    <div class="new-tab" ref={scroller}>
      <ul class="new-tab-list new-tab-head"><Row icon="arrow-up" label="Up" disabled={!up} onClick={() => { if (up) openFolderTab(up, id, space, device); }} /></ul>
      {failed ? <EmptyState>{failed}</EmptyState> : !list ? <Spinner label="Loading folder" />
        : list.missing ? <PathMissing id={id} path={path} device={device} near={list.near ?? []} />
        : !list.entries.length ? <EmptyState>This folder is empty.</EmptyState>
        : <ul class="new-tab-list" aria-label="Folder">{list.entries.map((entry) => <EntryRow key={entry.path} id={id} entry={entry} device={device} />)}</ul>}
      {list && list.total > list.entries.length && <p class="pane-note">The first {list.entries.length} of {list.total}.</p>}
    </div>
  );
}
