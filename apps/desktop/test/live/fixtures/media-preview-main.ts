// LIVE fixture (17.11.2026, task_d4pdwppg): the Electron main process of test/live/media-preview.test.ts, bundled by that test. Takes the video
// to convert from WF_LIVE_VIDEO (a real file, e.g. a 1080×1920 export), else records a heavy portrait WebM (1080×1920, ≈ 16 Mbit/s of noise) in a hidden
// window, stores it the way the blob store does, lets the real MediaPreview (hidden sandboxed window, private session, the page built from
// src/ui/preview/page.ts) make the light copy, checks the copy (box order, picture, length, playable in a <video>) and prints one RESULT line.
// Owns: the check's Electron side. Never: shows a window, uses the person's profile (userData is the test's temp folder), reaches the network.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, protocol, session } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import { MediaPreview } from '../../../src/main/media-preview.ts';
import { PREVIEW_ORIGIN } from '../../../src/main/media-preview-routes.ts';
import { electronAnalyzerWindows } from '../../../src/main/media-analyzer-window.ts';
import { PRIVILEGED_SCHEMES } from '../../../src/main/protocols/handlers.ts';
import { blobPath } from '../../../src/main/protocols/rules.ts';

const DIR = process.env.WF_LIVE_DIR ?? '';
const PAGE = process.env.WF_PREVIEW_PAGE ?? '';
const VIDEO = process.env.WF_LIVE_VIDEO ?? '';
const IDLE_MS = 1500;

/** Runs in the generator page: records noisy 1080×1920 scenes from a canvas, returns the WebM as base64. */
async function record(seconds: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  document.body.append(canvas);
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const paint = (t: number) => {
    g.fillStyle = `hsl(${(t * 60) % 360},60%,45%)`;
    g.fillRect(0, 0, 1080, 1920);
    for (let i = 0; i < 400; i++) { // noise keeps the bitrate high
      g.fillStyle = `rgb(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255})`;
      g.fillRect(Math.random() * 1060, Math.random() * 1900, 24, 24);
    }
  };
  recorder.start(200);
  const started = performance.now();
  while (performance.now() - started < seconds * 1000) {
    paint((performance.now() - started) / 1000);
    await new Promise((resolve) => setTimeout(resolve, 33));
  }
  recorder.stop();
  await stopped;
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Runs in the generator page: the copy as a <video>: its picture, length, and that it plays on. */
async function playable(base64: string, mime: string): Promise<{ width: number; height: number; duration: number; played: boolean }> {
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))], { type: mime }));
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error(video.error?.message ?? 'video error')); });
  await video.play();
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, played: video.currentTime > 0.2 };
}

function boxes(file: string): string[] {
  const data = readFileSync(file);
  const out: string[] = [];
  for (let at = 0; at + 8 <= data.length;) {
    let size = data.readUInt32BE(at);
    out.push(data.subarray(at + 4, at + 8).toString('latin1'));
    if (size === 1) size = Number(data.readBigUInt64BE(at + 8));
    if (size === 0) size = data.length - at;
    at += size;
  }
  return out;
}

async function run(): Promise<Record<string, unknown>> {
  const generator = new BrowserWindow({
    show: false, width: 640, height: 360,
    webPreferences: { partition: 'wf-live-generator', offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  await generator.loadURL('about:blank');
  const source = VIDEO
    ? readFileSync(VIDEO)
    : Buffer.from(await generator.webContents.executeJavaScript(`(${record.toString()})(4)`) as string, 'base64');
  const blobsDir = path.join(DIR, 'blobs');
  const fileId = createHash('sha256').update(source).digest('hex');
  mkdirSync(path.dirname(blobPath(blobsDir, fileId)), { recursive: true });
  writeFileSync(blobPath(blobsDir, fileId), source);

  const created: BrowserWindow[] = [];
  class Tracked extends BrowserWindow {
    constructor(options: BrowserWindowConstructorOptions) {
      super(options);
      created.push(this);
    }
  }
  const maker = new MediaPreview({
    open: (serve) => electronAnalyzerWindows({ BrowserWindow: Tracked, fromPartition: (partition, options) => session.fromPartition(partition, options) }, { partition: 'wf-media-preview', origin: PREVIEW_ORIGIN })(async (request) => {
      const response = await serve(request);
      if (process.env.WF_LIVE_TRACE) process.stderr.write(`${request.method} ${request.url.replace(PREVIEW_ORIGIN, '')} -> ${response.status}
`);
      return response;
    }),
    blobsDir, dir: path.join(DIR, 'previews'), script: () => readFileSync(PAGE, 'utf8'), idleMs: IDLE_MS,
  });
  const started = Date.now();
  const result = await maker.preview({ fileId, mime: VIDEO ? 'video/mp4' : 'video/webm' });
  const jobMs = Date.now() - started;
  const openAfterJob = maker.windowOpen && created.length === 1 && !created[0].isDestroyed();
  const info = await generator.webContents.executeJavaScript(`(${playable.toString()})(${JSON.stringify(readFileSync(result.file).toString('base64'))}, ${JSON.stringify(result.mime)})`) as Awaited<ReturnType<typeof playable>>;
  await new Promise((resolve) => setTimeout(resolve, IDLE_MS + 1000)); // past the idle time
  const report = {
    sourceBytes: source.length, jobMs, result: { ...result, file: path.basename(result.file) }, fileBytes: statSync(result.file).size, boxes: result.mime === 'video/mp4' ? boxes(result.file) : [],
    playable: info, openAfterJob, windowOpen: maker.windowOpen, previewWindows: created.length, destroyed: created.map((window) => window.isDestroyed()),
    windowsLeft: BrowserWindow.getAllWindows().filter((window) => window !== generator).length,
  };
  maker.dispose();
  generator.destroy();
  return report;
}

app.setPath('userData', path.join(DIR, 'profile'));
protocol.registerSchemesAsPrivileged(PRIVILEGED_SCHEMES);
app.on('window-all-closed', () => { /* the check decides when to quit */ });
app.whenReady().then(run).then(
  (report) => { process.stdout.write(`RESULT ${JSON.stringify(report)}\n`); app.exit(0); },
  (error: unknown) => { process.stdout.write(`RESULT ${JSON.stringify({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })}\n`); app.exit(1); },
);
