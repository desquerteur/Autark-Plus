// 17.11.2026 (Konrad task_d4pdwppg): the page of main's hidden video preview window (main/media-preview.ts serves it as wf-file://media-preview/page.js,
// built apart from the UI bundle into app/media-preview-page.js by scripts/build.mjs, with mediabunny inside). It asks for its job's spec, reads the job's
// video from its own origin as it needs it (ranges), converts it with the browser's own codecs (WebCodecs) to H.264 in MP4 with the index in front – the
// short edge at most spec.shortEdge, a bitrate by the number of pixels, at most spec.maxFps frames a second, the sound taken over as it is – and posts the
// copy back in pieces (out?at=<byte>), then done with its picture, length and type; any failure goes back as fail with its stage. A sign of life
// (progress) every few seconds keeps main's stall watchdog quiet while it works.
// Owns: the conversion and the job protocol's page side. Never: reaches anything but its own origin (CSP and session refuse it), decides the numbers
// (the spec does), keeps the video open after the job, or shows anything.

import { ALL_FORMATS, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, UrlSource, WebMOutputFormat, getFirstEncodableVideoCodec } from 'mediabunny';
import { previewBitrate, previewSize } from '../../shared/model/video-preview.ts';
import type { PreviewSpec } from '../../shared/model/video-preview.ts';

const post = (route: string, body?: BodyInit, type = 'application/octet-stream') => fetch(route, { method: 'POST', body, headers: { 'Content-Type': type } });

class Stop extends Error {
  stage: string;
  constructor(stage: string) { super(stage); this.stage = stage; }
}

/** Posts the finished copy in pieces, in order; main answers 409 for a piece out of order, 400 once it has refused one. */
async function send(bytes: Uint8Array<ArrayBuffer>, chunk: number): Promise<void> {
  for (let at = 0; at < bytes.byteLength; at += chunk) {
    const reply = await post(`out?at=${at}`, bytes.subarray(at, Math.min(bytes.byteLength, at + chunk)));
    if (!reply.ok) throw new Stop('encode');
  }
}

let step = 'start';

async function convert(): Promise<void> {
  step = 'spec';
  const spec = (await (await fetch('spec')).json()) as PreviewSpec;
  step = 'open';
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource('video') });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Stop('no-video');
  const durationMs = Math.round((await input.computeDuration()) * 1000);
  if (!(durationMs > 0)) throw new Stop('decode');
  if (durationMs > spec.maxDurationMs) throw new Stop('too-long');
  const size = previewSize(track.displayWidth, track.displayHeight, spec.shortEdge);
  const bitrate = previewBitrate(size.width, size.height);
  step = 'stats';
  const stats = await track.computePacketStats(120);
  const frameRate = stats.averagePacketRate > spec.maxFps + 1 ? spec.maxFps : undefined;
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width: size.width, height: size.height, bitrate });
  if (!codec) throw new Stop('no-encoder');
  const target = new BufferTarget();
  const output = new Output({ format: codec === 'avc' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
  const conversion = await Conversion.init({
    input, output,
    video: { width: size.width, height: size.height, fit: 'fill', codec, bitrate, ...(frameRate ? { frameRate } : {}) },
  });
  if (!conversion.isValid) throw new Stop('decode');
  // sound the copy cannot carry would play silent: no copy then, the original keeps its sound
  if (conversion.discardedTracks.some((entry) => entry.track.type === 'audio' && entry.reason !== 'discarded_by_user')) throw new Stop('audio');
  let beat = 0;
  conversion.onProgress = () => {
    const now = performance.now();
    if (now - beat < 3000) return;
    beat = now;
    void post('progress').catch(() => undefined);
  };
  step = 'convert';
  await conversion.execute();
  const buffer = target.buffer;
  if (!buffer || buffer.byteLength < 512) throw new Stop('encode');
  step = 'send';
  await send(new Uint8Array(buffer), spec.chunkBytes);
  const reply = await post('done', JSON.stringify({ width: size.width, height: size.height, durationMs, mime: codec === 'avc' ? 'video/mp4' : 'video/webm', size: buffer.byteLength }), 'application/json');
  if (!reply.ok) throw new Stop('encode');
}

convert().catch(async (error: unknown) => {
  const stage = error instanceof Stop ? error.stage : 'decode';
  const detail = `${step}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
  await post('fail', JSON.stringify({ reason: stage, detail }), 'application/json').catch(() => undefined);
});
