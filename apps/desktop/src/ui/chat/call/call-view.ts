// Owner 19.11.2026: what this device shows on a call – its camera or its screen – and the cut-out marked on it. One share at a
// time per device, bound to the chat whose call it belongs to; it ends with that call (CallOverlay unmounts → stopShare), with
// the person's second tap, or when the system ends the stream (the screen picker's Stop, a camera unplugged).
// The picture travels with the person's lines: when this chat's voice conversation sends a line, `shownWith` grabs the
// newest picture, and when it changed since the last one that went out (call-view-model.ts) – or a cut-out was marked –
// uploads it as a JPEG attachment of that line. The voice hears that a picture came with the line; the agent's work, which
// reads images, looks at it (runtime/calls/talker-prompt.ts voiceLine). A cut-out goes out once, then the whole picture again.
// Desktop: Electron grants camera and screen only right after armMedia (main/session-guards.ts picks the primary screen).
// Owns: the share's stream, its signals and the picture that goes out. Never: decides a call or sends a line itself.

import { signal } from '@preact/signals';
import type { Attachment } from '../../../shared/model/chat.ts';
import { armMedia, friendlyError, stopStream } from '../../blocks/ui/recorder.ts';
import { uploadFile } from '../../lib/files.ts';
import { toastError } from '../../lib/toasts.ts';
import { changed, fingerprint, outSize, PRINT, sourceRect, type Cut } from './call-view-model.ts';

export type ShareKind = 'camera' | 'screen';

/** What this device shows right now, and on which chat's call. */
export const callShare = signal<{ kind: ShareKind; conversationId: string; stream: MediaStream } | null>(null);
/** The cut-out marked on the preview, sent with the next line. */
export const callCut = signal<Cut | null>(null);

let lastPrint: number[] | undefined;
let grabber: HTMLVideoElement | undefined;

/** Whether this page can show a camera or a screen at all. */
export function canShare(kind: ShareKind): boolean {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return kind === 'camera' ? typeof media?.getUserMedia === 'function' : typeof media?.getDisplayMedia === 'function';
}

/** Starts showing `kind` on `conversationId`'s call (from the tap); the same kind again stops it. */
export async function toggleShare(conversationId: string, kind: ShareKind): Promise<void> {
  const now = callShare.peek();
  stopShare();
  if (now?.kind === kind && now.conversationId === conversationId) return;
  try {
    await armMedia(['video']);
    const stream = kind === 'camera'
      ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (callShare.peek()?.stream === stream) stopShare(); });
    callShare.value = { kind, conversationId, stream };
  } catch (error) {
    toastError(new Error(friendlyError(error)), kind === 'camera' ? 'Camera not shared' : 'Screen not shared');
  }
}

/** Stops showing anything; `conversationId`: only when it shows on that chat's call. */
export function stopShare(conversationId?: string): void {
  const now = callShare.peek();
  if (!now || (conversationId && now.conversationId !== conversationId)) return;
  stopStream(now.stream);
  callShare.value = null;
  callCut.value = null;
  lastPrint = undefined;
  if (grabber) grabber.srcObject = null;
}

/** The newest picture of the stream as a canvas (cut out when marked), or undefined before the first frame. */
async function grab(stream: MediaStream, cut?: Cut): Promise<HTMLCanvasElement | undefined> {
  grabber ??= Object.assign(document.createElement('video'), { muted: true, playsInline: true });
  if (grabber.srcObject !== stream) { grabber.srcObject = stream; await grabber.play().catch(() => undefined); }
  if (!grabber.videoWidth) await new Promise((resolve) => setTimeout(resolve, 300));
  const { videoWidth: width, videoHeight: height } = grabber;
  if (!width || !height) return undefined;
  const { sx, sy, sw, sh } = sourceRect(width, height, cut);
  const size = outSize(sw, sh);
  const canvas = Object.assign(document.createElement('canvas'), size);
  canvas.getContext('2d')?.drawImage(grabber, sx, sy, sw, sh, 0, 0, size.width, size.height);
  return canvas;
}

function printOf(canvas: HTMLCanvasElement): number[] {
  const small = Object.assign(document.createElement('canvas'), { width: PRINT, height: PRINT });
  const context = small.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(canvas, 0, 0, PRINT, PRINT);
  return fingerprint(context.getImageData(0, 0, PRINT, PRINT).data);
}

/** The picture that goes with a line of `conversationId`'s call: none when nothing shows there or nothing changed. */
export async function shownWith(conversationId: string): Promise<Attachment[]> {
  const share = callShare.peek();
  if (!share || share.conversationId !== conversationId) return [];
  const cut = callCut.peek() ?? undefined;
  const canvas = await grab(share.stream, cut);
  if (!canvas) return [];
  const print = cut ? undefined : printOf(canvas);
  if (print && !changed(lastPrint, print)) return [];
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!blob) return [];
  const name = cut ? 'Cut-out.jpg' : share.kind === 'camera' ? 'Camera.jpg' : 'Screen.jpg';
  const attachment = await uploadFile(blob, name, { conversationId });
  if (cut) { callCut.value = null; lastPrint = undefined; } else lastPrint = print;
  return [attachment];
}
