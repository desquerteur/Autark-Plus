// The composer's recorder (F23, owner 16.11.2026: "Aufnehmen … direkt angehängt an die Nachricht, also nicht
// transkribiert"). Plus › Record audio / Record video open this bar in the composer's slot above the field, like the
// schedule block: one row of fixed cells – [preview: video only] [status] [Retake | Photo] [primary, one width] [×] –,
// audio one row high, video as high as its preview, so a click moves nothing. Audio records as soon as the microphone
// is open (the menu pick was the click); video shows the camera first: Record, or Photo (a frame of the preview goes in
// as a picture). Stop attaches the take as a chip of the draft (record-take.ts) and the bar closes; the chip is the
// review (an audio chip plays inline, its × removes it). A take that could not be attached stays: "Not attached: …"
// with Attach and Retake. A take not yet in the draft (left mid-take, a reload, a failed upload) brings the bar back
// when the chat opens: "Unsent recording · 0:12". × discards – asking first while a take is at stake; Esc is ×.
// On a phone Record video and Take photo are the camera app's (<input capture>, PhoneChrome.java on Android): a video
// from it is a take like a recorded one (kept in IndexedDB until the draft holds it), a photo goes in like a picked one.
// F23: while it records, the status cell holds two lines in the bar's height – the time (and the words per minute) and
// under it the words heard so far on the same microphone (blocks/ui/live-words.ts), newest at the end.
// Owns: the bar and its slot (useRecordSlot: which bar is open, the capture input, the Plus menu's three entries).
// Never: records (blocks/ui/recorder.ts) or uploads (record-take.ts) itself, or keeps the camera or microphone open
// once the bar closed.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { duration } from '../../blocks/ask.ts';
import { LIVE_TITLE, liveLine, useLiveWords } from '../../blocks/ui/live-words.ts';
import { canRecordLive, unsentTake, useRecorder } from '../../blocks/ui/recorder.ts';
import { RecordDevice } from '../../blocks/ui/RecordDevice.tsx';
import { confirm } from '../../lib/dialog.tsx';
import { Button, Icon, IconButton } from '../../lib/ui.tsx';
import { pushToast, toastError } from '../../lib/toasts.ts';
import { attachTake, attachingIn, attachingTake, holdsTake, phoneCamera, photoName, recordKey } from './record-take.ts';
import type { RecordKind } from './record-take.ts';

interface BarProps {
  conversationId: string;
  mode: RecordKind;
  /** A file of the phone's camera app: it is the take (attached at once). */
  file?: File;
  /** Retake where the camera app records (a phone's video). */
  onCapture: () => void;
  onPhoto: (file: File) => void;
  onClose: () => void;
}

/** A frame of the live preview as a JPEG (the true image, not the mirrored view). */
async function frameOf(video: HTMLVideoElement | null): Promise<Blob | null> {
  if (!video?.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')?.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

function RecordBar(props: BarProps) {
  const { conversationId, mode, onClose } = props;
  const key = recordKey(conversationId);
  const rec = useRecorder(mode, { draftKey: key });
  const [progress, setProgress] = useState<number | null>(null); // attaching (0..1)
  const [failed, setFailed] = useState<string | null>(null);
  /** The take was just recorded or captured: it goes into the draft at once (a resumed one waits for Attach). */
  const fresh = useRef(false);
  const alive = useRef(true);
  const preview = useRef<HTMLVideoElement>(null);
  const live = !props.file && canRecordLive(mode) && !(mode === 'video' && phoneCamera());
  const recording = rec.state === 'recording';
  const words = useLiveWords(live ? rec.stream : null, recording && rec.started, conversationId);

  useEffect(() => () => { alive.current = false; }, []);
  // Opened: a captured file is the take; else a take of this chat that waits comes back first, or the device opens.
  useEffect(() => {
    if (props.file) { fresh.current = true; void rec.takeFile(props.file); return; }
    void unsentTake(key).then((stored) => {
      if (!alive.current || stored) return; // the recorder offers it (rec.resumable): resumed below
      fresh.current = true;
      void rec.prepare();
    });
  }, []);
  useEffect(() => { if (rec.resumable && !fresh.current) rec.resume(); }, [rec.resumable]);
  useEffect(() => { if (mode === 'audio' && rec.state === 'ready') rec.start(); }, [rec.state]);
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    el.srcObject = rec.stream;
    if (rec.stream) void el.play().catch(() => undefined);
  }, [rec.stream]);

  const attach = async () => {
    const take = rec.take;
    if (!take || progress !== null) return;
    setFailed(null);
    setProgress(0);
    try {
      await attachTake(conversationId, take, { onProgress: (ratio) => { if (alive.current) setProgress(ratio); } });
      if (!alive.current) return;
      rec.reset();
      onClose();
    } catch (error) {
      if (!alive.current) { toastError(error, 'Recording not attached'); return; } // it waits for the chat's next visit
      setProgress(null);
      setFailed(error instanceof Error && error.message ? error.message : 'The upload failed.');
    }
  };
  useEffect(() => { if (rec.take && fresh.current) { fresh.current = false; void attach(); } }, [rec.take]);

  const retake = () => {
    if (!live) { props.onCapture(); return; } // the new file replaces this bar and its take
    setFailed(null);
    fresh.current = true;
    void rec.retake();
  };
  const photo = async () => {
    const blob = await frameOf(preview.current);
    if (!blob || !alive.current) return;
    props.onPhoto(new File([blob], photoName(new Date()), { type: 'image/jpeg' }));
    rec.reset();
    onClose();
  };
  const close = async () => {
    if (progress !== null) return; // an attach ends by itself
    if ((recording || rec.take) && !(await confirm({ title: 'Discard recording?', body: 'It is not attached yet.', confirmLabel: 'Discard', danger: true }))) return;
    rec.discard();
    onClose();
  };

  const attaching = progress !== null || (rec.take !== null && fresh.current);
  let status: ComponentChildren;
  let tone = '';
  if (attaching) status = `Attaching… ${Math.round((progress ?? 0) * 100)} %`;
  else if (failed) { status = `Not attached: ${failed}`; tone = ' error'; }
  else if (rec.take) status = `Unsent recording${rec.take.seconds > 0 ? ` · ${duration(rec.take.seconds)}` : ''}`;
  else if (recording) {
    status = (
      <span class="record-live">
        <span class="record-clock">
          <span class={`w-record-dot${rec.started ? '' : ' is-starting'}`} aria-hidden="true" />
          {rec.started ? duration(rec.elapsed) : 'Starting…'}
          {words.wpm && <span class="muted" title="Words per minute"> · {words.wpm} wpm</span>}
        </span>
        <span class="w-live-words" title={LIVE_TITLE}><span>{liveLine(words, rec.started)}</span></span>
      </span>
    );
  }
  else if (rec.state === 'error') { status = rec.error; tone = ' error'; }
  else if (rec.state === 'ready') status = <RecordDevice mode={mode} choice={rec.devices} onChoose={rec.chooseDevice} />;
  else status = props.file ? 'Attaching…' : mode === 'audio' ? 'Starting microphone…' : 'Starting camera…';

  let primary: { label: string; onClick?: () => void };
  if (attaching || rec.take) primary = { label: 'Attach', onClick: attaching ? undefined : () => void attach() };
  else if (recording) primary = { label: 'Stop', onClick: rec.stop };
  else if (rec.state === 'error') primary = { label: 'Try again', onClick: () => { fresh.current = true; void rec.prepare(); } };
  else if (rec.state === 'ready' && mode === 'video') primary = { label: 'Record', onClick: rec.start };
  else primary = { label: props.file ? 'Attach' : mode === 'audio' ? 'Stop' : 'Record' }; // the device is opening
  const secondary = rec.take && !attaching ? { label: 'Retake', onClick: retake }
    : rec.state === 'ready' && mode === 'video' ? { label: 'Photo', onClick: () => void photo() } : null;
  const mirrored = rec.facing ? rec.facing === 'user' : true; // a selfie view; a camera facing away is not mirrored

  return (
    <div class={`record-bar mode-${mode}`} role="group" aria-label={mode === 'audio' ? 'Record audio' : 'Record video'}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void close(); } }}>
      {mode === 'video' && (
        <div class="record-preview">
          <video ref={preview} class={mirrored ? 'is-mirrored' : undefined} muted playsInline autoplay hidden={!rec.stream} />
          {!rec.stream && <Icon name="camera" size={20} />}
        </div>
      )}
      <div class={`record-status tabular${tone}`} role="status">{typeof status === 'string' ? <span class="record-status-text" title={status}>{status}</span> : status}</div>
      {secondary && <Button variant="secondary" onClick={secondary.onClick}>{secondary.label}</Button>}
      <Button variant="primary" class="record-primary" icon={primary.label === 'Stop' && recording ? 'stop' : undefined}
        busy={!primary.onClick} onClick={primary.onClick}>{primary.label}</Button>
      <IconButton icon="x" label={recording || rec.take ? 'Discard recording' : 'Close'} size="small" iconSize={16} disabled={attaching} onClick={() => void close()} />
    </div>
  );
}

interface Open { conversationId: string; mode: RecordKind; file?: File; at: number }

/**
 * The composer's record slot for one chat: the bar (or null), the hidden capture input and the Plus menu's entries.
 * `addPhotos`: a photo of the camera (app or preview) goes in like a picked picture.
 */
export function useRecordSlot(conversationId: string, addPhotos: (files: File[]) => void) {
  const [open, setOpen] = useState<Open | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const kind = useRef<'image' | RecordKind>('image');
  const show = (mode: RecordKind, file?: File) => setOpen({ conversationId, mode, file, at: Date.now() });

  // The chat opens: its take that is not in the draft yet (left mid-take, a reload, a failed upload) brings the bar back.
  useEffect(() => {
    setOpen(null);
    let current = true;
    const look = () => void unsentTake(recordKey(conversationId)).then((take) => {
      if (!current || !take) return;
      const mode: RecordKind = take.mime.startsWith('video/') ? 'video' : 'audio';
      setOpen((now) => (now?.conversationId === conversationId ? now : { conversationId, mode, at: Date.now() }));
    });
    const running = attachingTake(conversationId);
    if (running) running.catch(look); else look();
    return () => { current = false; };
  }, [conversationId]);

  /** The camera app (photo, a phone's video) or, where nothing records live, the system's recorder or picker. */
  const capture = (what: 'image' | RecordKind) => {
    const el = input.current;
    if (!el) return;
    kind.current = what;
    el.accept = `${what}/*`;
    if (what === 'audio') el.removeAttribute('capture'); else el.setAttribute('capture', 'environment');
    el.click();
  };
  const start = (mode: RecordKind) => {
    if (holdsTake(conversationId)) {
      pushToast({ title: attachingIn.peek().has(conversationId) ? 'The recording is still being attached' : 'Attach or discard the recording first', tone: 'info' }, 4000);
      return;
    }
    if ((mode === 'video' && phoneCamera()) || !canRecordLive(mode)) capture(mode);
    else show(mode);
  };
  const picked = (file: File | undefined) => {
    if (!file) return;
    if (kind.current === 'image') addPhotos([file]);
    else show(kind.current, file);
  };

  const at = open?.conversationId === conversationId ? open.at : undefined;
  const bar = open && at !== undefined
    ? <RecordBar key={at} conversationId={conversationId} mode={open.mode} file={open.file} onCapture={() => capture(open.mode)}
        onPhoto={(file) => addPhotos([file])} onClose={() => setOpen((now) => (now?.at === at ? null : now))} />
    : null;
  const element = <input ref={input} type="file" hidden onChange={(event) => {
    const el = event.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    picked(file);
  }} />;
  return {
    bar,
    input: element,
    /** Recording, attaching or holding a take of this chat: Send waits. */
    held: holdsTake(conversationId),
    actions: { recordAudio: () => start('audio'), recordVideo: () => start('video'), takePhoto: phoneCamera() ? () => capture('image') : undefined },
  };
}
