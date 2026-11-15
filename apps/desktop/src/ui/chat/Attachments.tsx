// Attachment rendering: image thumbnails and file chips in messages, removable chips in the composer. On the
// desktop an image or a video of a message opens in the side pane (side-pane.ts); every other file opens with the
// system app. B-084: on the phone everything the media layer shows (image, video, recording, PDF) opens in the chat's
// area the same way; any other file is saved – inside the Android app to its Downloads (pwa/phone-download.ts), in a
// browser as a download (a first tap waits for the bytes, lib/files.ts fileUrlReady). B-080: openAttachment and showAttachment (the file in its folder)
// are also the message menu's "Open <name>" and "Show <name> in folder" (MessageActions.tsx) – one click opens once.
// B-082 (nothing is lost): a draft's audio chip plays inline (one recording at a time), offers "Transcribe again"
// (onRetry; the field keeps its focus, so the text goes to its caret) and deletes (x; a chip held in this page,
// lib/take-store.ts, leaves the page's store too). A sent message whose dictation was not heard
// (meta.dictation.failed) shows "Transcribe again" beside its player (voice.retranscribe).
// Owns: attachment markup and these actions. Never: uploads (lib/files.ts), hearing (composer/voice.ts) or message state.

import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Attachment, Message } from '../../shared/model/chat.ts';
import { Icon, IconButton, Spinner } from '../lib/ui.tsx';
import { fileUrlReady, useFileUrl } from '../lib/files.ts';
import { fileSize } from '../lib/format.ts';
import { platform } from '../lib/platform.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { heldKey, takeStore } from '../lib/take-store.ts';
import { toastError } from '../lib/toasts.ts';
import { isAndroidApp } from '../pwa/native.ts';
import { saveToPhone } from '../pwa/phone-download.ts';
import { viewKind } from '../workspace/media-facts.ts';
import { showMedia, showVideo } from './side-pane.ts';

async function openFile(attachment: Attachment): Promise<void> {
  try {
    if (platform === 'desktop') { await rpc.call('files.open', { id: attachment.fileId }); return; }
    const url = await fileUrlReady(attachment.fileId); // a first tap waits for the bytes
    if (isAndroidApp() && await saveToPhone(await (await fetch(url)).blob(), attachment.name)) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name;
    link.click();
  } catch (error) { toastError(error, 'Could not open file'); }
}

/**
 * Whether this attachment of a message opens in the chat's area: on the desktop an image or a video; on the phone
 * everything the media layer shows (image, video, recording, PDF – media-facts.ts viewKind).
 */
export function opensInPane(attachment: Attachment, desktop = platform === 'desktop'): boolean {
  if (desktop) return attachment.mime.startsWith('image/') || attachment.mime.startsWith('video/');
  return viewKind(attachment.mime, attachment.name) !== 'file';
}

/** A click: the side pane for an image or video, else the file itself. */
export function openAttachment(attachment: Attachment, conversationId?: string): void {
  if (conversationId && opensInPane(attachment)) {
    if (attachment.mime.startsWith('video/')) showVideo(conversationId, attachment); else showMedia(conversationId, attachment);
    return;
  }
  void openFile(attachment);
}

/** B-080: the file in its folder (desktop) – the message menu's "Show <name> in folder". */
export function showAttachment(attachment: Attachment): void {
  rpc.call('files.open', { id: attachment.fileId, reveal: true }).catch((error: unknown) => toastError(error, 'Could not show the file'));
}

function ImageThumb(props: { attachment: Attachment; conversationId?: string }) {
  const url = useFileUrl(props.attachment.fileId);
  return (
    <button type="button" class="attachment-image" title={props.attachment.name} onClick={() => openAttachment(props.attachment, props.conversationId)}>
      {url ? <img src={url} alt={props.attachment.name} loading="lazy" /> : <Spinner size={14} />}
    </button>
  );
}

function AudioPlayer(props: { attachment: Attachment }) {
  const url = useFileUrl(props.attachment.fileId);
  return url ? <audio class="attachment-audio" controls src={url} preload="metadata" /> : <FileChip attachment={props.attachment} />;
}

function FileChip(props: { attachment: Attachment; conversationId?: string; onRemove?: () => void; busy?: boolean }) {
  const { attachment } = props;
  return (
    <span class="file-chip">
      <button type="button" class="file-chip-open" title={attachment.name} onClick={() => openAttachment(attachment, props.conversationId)}>
        {props.busy ? <Spinner size={14} /> : <Icon name={attachment.mime.startsWith('image/') ? 'image' : 'paperclip'} size={16} />}
        <span class="file-chip-name">{attachment.name}</span>
        {attachment.size > 0 && <span class="file-chip-size tabular">{fileSize(attachment.size)}</span>}
      </button>
      {props.onRemove && <IconButton icon="x" label={`Remove ${attachment.name}`} size="small" iconSize={14} onClick={props.onRemove} />}
    </span>
  );
}

/** The recording of a message whose dictation was not heard (meta.dictation.failed), when it may be heard again. */
function unheardRecording(message: Message | undefined): string | undefined {
  const dictation = message?.meta.dictation as { fileId?: unknown; failed?: unknown } | undefined;
  return dictation?.failed === true && typeof dictation.fileId === 'string' && can('voice.retranscribe') ? dictation.fileId : undefined;
}

/** "Transcribe again" beside a sent recording: the runtime hears it again and writes the message's text. */
function HearAgain(props: { messageId: string }) {
  const [busy, setBusy] = useState(false);
  if (busy) return <span class="icon-button small"><Spinner size={14} label="Transcribing" /></span>; // the button's own size: nothing moves
  return (
    <IconButton icon="arrow-clockwise" label="Transcribe again" size="small" iconSize={14} onClick={() => {
      setBusy(true);
      rpc.call('voice.retranscribe', { messageId: props.messageId })
        .catch((error: unknown) => toastError(error, 'Dictation not transcribed'))
        .finally(() => setBusy(false));
    }} />
  );
}

/**
 * A message's attachments; with its chat an image or video opens in the side pane. `message`: the caller's own message
 * (MessageItem) – its recording that was not heard gets "Transcribe again".
 */
export function AttachmentList(props: { attachments: Attachment[]; conversationId?: string; message?: Message }) {
  const images = props.attachments.filter((attachment) => attachment.mime.startsWith('image/'));
  const audio = props.attachments.filter((attachment) => attachment.mime.startsWith('audio/'));
  const files = props.attachments.filter((attachment) => !attachment.mime.startsWith('image/') && !attachment.mime.startsWith('audio/'));
  const unheard = unheardRecording(props.message);
  return (
    <div class="attachments">
      {images.length > 0 && <div class="attachment-images">{images.map((attachment) => <ImageThumb key={attachment.fileId} attachment={attachment} conversationId={props.conversationId} />)}</div>}
      {audio.map((attachment) => (attachment.fileId === unheard && props.message
        ? <div key={attachment.fileId} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AudioPlayer attachment={attachment} /><HearAgain messageId={props.message.id} /></div>
        : <AudioPlayer key={attachment.fileId} attachment={attachment} />))}
      {files.length > 0 && <div class="attachment-files">{files.map((attachment) => <FileChip key={attachment.fileId} attachment={attachment} conversationId={props.conversationId} />)}</div>}
    </div>
  );
}

// One recording plays at a time (a chip's play button).
const playing = signal<string | null>(null);
let player: HTMLAudioElement | null = null;

function togglePlay(fileId: string, url: string): void {
  const same = playing.peek() === fileId;
  player?.pause();
  player = null;
  playing.value = null;
  if (same) return;
  const audio = new Audio(url);
  const done = () => { if (player === audio) { player = null; playing.value = null; } };
  audio.onended = done;
  audio.onerror = done;
  player = audio;
  playing.value = fileId;
  void audio.play().catch(done);
}

/** A draft's recording: play/stop, name and size, "Transcribe again" (a dictation take: lib/take-name.ts), remove. */
function AudioChip(props: { attachment: Attachment; onRemove: () => void; onRetry?: (attachment: Attachment) => void | Promise<void> }) {
  const { attachment } = props;
  const held = heldKey(attachment.fileId);
  const stored = useFileUrl(held ? null : attachment.fileId);
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (held) void takeStore.url(held).then((url) => setLocal(url ?? null)); }, [held]);
  // A chip that goes (heard again, sent, swapped for its upload) stops its recording.
  useEffect(() => () => { if (playing.peek() === attachment.fileId) togglePlay(attachment.fileId, ''); }, [attachment.fileId]);
  const url = held ? local : stored;
  const on = playing.value === attachment.fileId;
  const retry = () => {
    setBusy(true);
    void Promise.resolve(props.onRetry?.(attachment)).finally(() => setBusy(false));
  };
  const remove = () => {
    if (on) togglePlay(attachment.fileId, '');
    if (held) void takeStore.drop(held);
    props.onRemove();
  };
  return (
    <span class="file-chip">
      <IconButton icon={on ? 'stop' : 'play'} label={on ? 'Stop playing' : `Play ${attachment.name}`} size="small" iconSize={14} disabled={!url}
        onClick={() => { if (url) togglePlay(attachment.fileId, url); }} />
      <span class="file-chip-open" title={attachment.name}>
        <span class="file-chip-name">{attachment.name}</span>
        {attachment.size > 0 && <span class="file-chip-size tabular">{fileSize(attachment.size)}</span>}
      </span>
      {props.onRetry && (held || attachment.name.startsWith('Dictation ')) && (busy ? <span class="icon-button small"><Spinner size={14} label="Transcribing" /></span>
        : <IconButton icon="arrow-clockwise" label="Transcribe again" size="small" iconSize={14} onMouseDown={(event) => event.preventDefault()} onClick={retry} />)}
      <IconButton icon="x" label={`Remove ${attachment.name}`} size="small" iconSize={14} onClick={remove} />
    </span>
  );
}

/** Composer chips: uploaded attachments (a recording plays inline and can be heard again) + uploads in progress. */
export function ComposerAttachments(props: { attachments: Attachment[]; uploading: string[]; onRemove: (fileId: string) => void; onRetry?: (attachment: Attachment) => void | Promise<void> }) {
  if (!props.attachments.length && !props.uploading.length) return null;
  return (
    <div class="composer-attachments">
      {props.attachments.map((attachment) => (attachment.mime.startsWith('audio/')
        ? <AudioChip key={attachment.fileId} attachment={attachment} onRemove={() => props.onRemove(attachment.fileId)} onRetry={props.onRetry} />
        : <FileChip key={attachment.fileId} attachment={attachment} onRemove={() => props.onRemove(attachment.fileId)} />))}
      {props.uploading.map((name) => <FileChip key={`up-${name}`} attachment={{ fileId: '', name, mime: '', size: 0 }} busy />)}
    </div>
  );
}
