// Pane tab › Media: one stored file (a media library row or a chat file, by its id) or a file on this
// PC (by its path, stored first) – an image fitted into the page area, a video or recording in a
// player (streamed, never autoplayed), a PDF's text head, any other file as its icon and name. One
// line under it: the name, its facts ("1280×720 · 0:42 · 3.2 MB") and Open on the PC. A right click
// offers Open and Show in folder. B-076: a file of a linked PC (`device`) is stored there and its bytes
// come here (one line says so while that PC is offline); a video's second follows the same tab
// elsewhere when someone seeks or pauses (view-sync.ts). B-084: a stored file (by id, or one of a linked PC) also has
// Open and "Save" on the desktop (files.open with reveal: a named copy here, shown in its folder – files.open fetches
// bytes still on the other PC first); off the desktop "Save to phone" in a phone app, else "Download" (media-save.ts).
// B-081: a path that holds nothing on its PC is the not-found page (PathMissing.tsx: that PC's similar paths, no Create)
// and is not asked for again – only an unreachable PC is.
// Owns: that view. Never: describes, tags, segments or deletes files (an agent does that on request).

import { useEffect, useRef, useState } from 'preact/hooks';
import type { PathEntry } from '../../shared/api/methods-files.ts';
import type { FileRef } from '../../shared/model/system.ts';
import { openPath } from '../blocks/host.ts';
import { MediaImage, MediaPlayer } from '../blocks/ui/Media.tsx';
import { useContextMenu } from '../lib/context-menu.tsx';
import { platform } from '../lib/platform.ts';
import { errorText, rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { toastError } from '../lib/toasts.ts';
import { Icon, Spinner, type MenuSection } from '../lib/ui.tsx';
import { isPhoneApp } from '../pwa/native.ts';
import { onPc } from './file-tabs.ts';
import { mediaFacts, viewKind } from './media-facts.ts';
import { saveFile } from './media-save.ts';
import { nameTab } from './pages.ts';
import { PathMissing } from './PathMissing.tsx';
import { useSpace } from './space.ts';
import { useTimePosition } from './view-sync.ts';

/** A file of a linked PC that could not be had is asked for again after this long. */
const RETRY_MS = 5000;

export function MediaView(props: { id: string; fileId?: string; path?: string; device?: string }) {
  const { id, fileId, path, device } = props;
  const space = useSpace();
  const stageRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<FileRef | null>(null);
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [near, setNear] = useState<readonly PathEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = fileId ? rpc.call('files.get', { id: fileId }) : rpc.call('files.uploadPath', { path: path ?? '', ...onPc(device) });
    const again = () => { if (alive && device) retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS); }; // that PC may be back by then
    load.then((ref) => { if (!alive) return; setFailed(''); setFile(ref); nameTab(id, ref.name, space); }, (error: unknown) => {
      if (!alive) return;
      setFailed(errorText(error));
      if (!path) { again(); return; }
      // B-081: nothing at the path there is the not-found page with that PC's similar paths, and no new ask
      rpc.call('files.readPath', { path, ...onPc(device) }).then((read) => { if (!alive) return; if (read.state === 'missing') setNear(read.near ?? []); else again(); }, again);
    });
    return () => { alive = false; if (retry) clearTimeout(retry); };
  }, [fileId, path, device, attempt]); // a tab's file never changes (its id names it): the view is drawn anew for another
  useTimePosition(id, stageRef);

  // A path of this PC opens in place; anything else is a stored file, whose bytes files.open brings here first.
  const local = Boolean(path) && !device;
  const desktop = platform === 'desktop';
  const canOpen = desktop && (local ? can('files.openPath') : can('files.open'));
  const [saving, setSaving] = useState(false);
  const open = (reveal: boolean) => {
    const done = local && path ? openPath(path, reveal) : file ? rpc.call('files.open', { id: file.id, reveal }) : Promise.resolve();
    void Promise.resolve(done).catch((error: unknown) => toastError(error, "Couldn't open the file"));
  };
  const save = () => {
    if (!file) return;
    setSaving(true);
    saveFile(file).catch((error: unknown) => toastError(error, "Couldn't save the file")).finally(() => setSaving(false));
  };
  const menu = useContextMenu((): MenuSection[] => canOpen && file ? [{ items: [
    { label: 'Open', onSelect: () => open(false) },
    { label: 'Show in folder', onSelect: () => open(true) },
  ] }] : []);

  if (near) return <div class="pane-view"><div class="new-tab"><PathMissing id={id} path={path ?? ''} device={device} near={near} /></div></div>;
  const kind = file ? viewKind(file.mime, file.name) : 'file';
  let stage;
  if (!file) stage = failed ? <p class="pane-note">{failed}</p> : <Spinner label="Loading file" />;
  else if (kind === 'image') stage = <MediaImage src={file.id} fileId={file.id} alt={file.name} />;
  else if (kind === 'video' || kind === 'audio') stage = <MediaPlayer src={file.id} fileId={file.id} kind={kind} />;
  else if (kind === 'pdf' && file.textPreview) stage = <pre class="pane-media-text">{file.textPreview}</pre>;
  else stage = <div class="workspace-start"><Icon name="file" size={24} /><p>{file.name}</p></div>;

  return (
    <div class={`pane-view pane-media kind-${kind}`} {...menu}>
      <div class="pane-stage" ref={stageRef}>{stage}</div>
      <div class="pane-foot">
        <span class="pane-foot-text" title={file?.name}>{file ? [file.name, mediaFacts(file)].filter(Boolean).join(' · ') : ''}</span>
        {canOpen && <button type="button" class="button secondary pane-foot-button" disabled={!file} onClick={() => open(false)}>Open</button>}
        {canOpen && !local && <button type="button" class="button secondary pane-foot-button" disabled={!file} onClick={() => open(true)}>Save</button>}
        {!desktop && <button type="button" class="button secondary pane-foot-button" disabled={!file || saving} onClick={save}>{isPhoneApp() ? 'Save to phone' : 'Download'}</button>}
      </div>
    </div>
  );
}
