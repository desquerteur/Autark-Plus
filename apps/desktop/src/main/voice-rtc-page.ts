// Owner 07.11.2026: the page of the hidden voice window (voice-rtc.ts serves it in its own private session as
// wf-file://voice-rtc/job/<n>/ and /rtc.js, this module's rtcPage run once). It reads the job's spec and the take as
// 16 kHz PCM16 (main's media analyzer decoded it), builds an AudioBuffer, and connects an AudioContext's
// MediaStreamAudioDestinationNode – never its speaker output – to an RTCPeerConnection with one audio track and the
// "oai-events" data channel the Codex realtime server expects (live 07.11.2026, rtc-probe.py). The offer goes to main
// once ICE gathering is complete (or after spec.gatherMs with the candidates there are); the answer comes back from
// a long-poll. Once connected the page waits spec.leadMs, plays the take in real time into the track, waits
// spec.tailMs (the server's voice detection ends the turn on silence) and posts 'sent'. The connection stays until
// main closes the window. The far side's audio (the assistant's voice) is never attached to anything, so it is
// never heard. Every failure is posted as its stage ('decode', 'offer', 'connect', 'send').
// B-082: the data channel's session.usage.updated carries the voice's own meter (usage.audio_duration_ms, connection
// time); the page posts that number to 'usage' each time (about every 15 s), main answers the last one on close.
// Owns: the page side of the voice job, the served script and the page's CSP. Never: plays sound, reaches anything
// over HTTP but its own origin, keeps the take after the job. rtcPage must stay self-contained: it is served as its own source.

/** What `spec` answers. */
export interface RtcPageSpec { rate: number; leadMs: number; tailMs: number; gatherMs: number; connectMs: number }

/** The browser objects the page uses (the window itself; tests pass fakes). */
export interface RtcPageEnv {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  setTimeout(handler: () => void, ms: number): unknown;
  AudioContext: new (options?: { sampleRate?: number }) => RtcAudioContext;
  RTCPeerConnection: new () => RtcPeer;
}

/** The parts of an AudioContext the page uses. */
export interface RtcAudioContext {
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  createBuffer(channels: number, length: number, rate: number): { readonly duration: number; getChannelData(channel: number): Float32Array };
  createMediaStreamDestination(): { stream: { getAudioTracks(): unknown[] } };
  createBufferSource(): { buffer: unknown; connect(node: unknown): void; start(): void; addEventListener(type: 'ended', listener: () => void): void };
}

/** The parts of an RTCPeerConnection the page uses. */
export interface RtcPeer {
  readonly iceGatheringState: string;
  readonly connectionState: string;
  readonly localDescription: { sdp: string } | null;
  addTrack(track: unknown, stream: unknown): void;
  createDataChannel(label: string): { addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void };
  createOffer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(description: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: 'answer'; sdp: string }): Promise<void>;
  addEventListener(type: 'icegatheringstatechange' | 'connectionstatechange', listener: () => void): void;
  close(): void;
}

/** The voice job, start to end (see the header). */
export async function rtcPage(env: RtcPageEnv = globalThis as unknown as RtcPageEnv): Promise<void> {
  const post = async (path: string, body: string): Promise<void> => {
    const response = await env.fetch(path, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error('refused');
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => { env.setTimeout(resolve, ms); });
  /** Resolves when `done()` holds after one of the peer's `type` events, or after `ms` (then `done()` is the answer). */
  const until = (peer: RtcPeer, type: 'icegatheringstatechange' | 'connectionstatechange', done: () => boolean, ms: number) => new Promise<boolean>((resolve) => {
    if (done()) { resolve(true); return; }
    peer.addEventListener(type, () => { if (done()) resolve(true); });
    env.setTimeout(() => resolve(done()), ms);
  });
  let stage = 'decode';
  let peer: RtcPeer | null = null;
  let context: RtcAudioContext | null = null;
  try {
    const spec = await (await env.fetch('spec')).json() as RtcPageSpec;
    const response = await env.fetch('pcm');
    if (!response.ok) throw new Error(stage);
    const samples = new Int16Array(await response.arrayBuffer());
    if (!samples.length) throw new Error(stage);
    context = new env.AudioContext({ sampleRate: 48_000 }); // Opus runs at 48 kHz; the context resamples the 16 kHz buffer
    const buffer = context.createBuffer(1, samples.length, spec.rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) data[i] = samples[i] / 32768;
    const sink = context.createMediaStreamDestination(); // a track, not the speaker

    stage = 'offer';
    const pc = new env.RTCPeerConnection();
    peer = pc;
    const track = sink.stream.getAudioTracks()[0];
    if (!track) throw new Error(stage);
    pc.addTrack(track, sink.stream);
    pc.createDataChannel('oai-events').addEventListener('message', (event) => { // B-082: the session meter, a number only
      try {
        if (typeof event.data !== 'string' || !event.data.includes('session.usage.updated')) return;
        const data = JSON.parse(event.data) as { type?: unknown; usage?: { audio_duration_ms?: unknown } };
        const ms = data?.type === 'session.usage.updated' ? data.usage?.audio_duration_ms : undefined;
        if (typeof ms === 'number' && Number.isFinite(ms)) post('usage', JSON.stringify({ ms })).catch(() => undefined);
      } catch { /* not JSON: nothing to read */ }
    });
    await pc.setLocalDescription(await pc.createOffer());
    await until(pc, 'icegatheringstatechange', () => pc.iceGatheringState === 'complete', spec.gatherMs);
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error(stage);
    await post('offer', JSON.stringify({ sdp }));
    const answer = await env.fetch('answer'); // held by main until the server answered
    if (!answer.ok) throw new Error(stage);
    const remote = await answer.json() as { sdp?: unknown };
    if (typeof remote.sdp !== 'string') throw new Error(stage);

    stage = 'connect';
    await pc.setRemoteDescription({ type: 'answer', sdp: remote.sdp });
    if (!await until(pc, 'connectionstatechange', () => pc.connectionState === 'connected', spec.connectMs)) throw new Error(stage);

    stage = 'send';
    if (context.state !== 'running') await context.resume();
    await sleep(spec.leadMs);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(sink);
    const ended = new Promise<void>((resolve) => source.addEventListener('ended', () => resolve()));
    source.start();
    await ended;
    await sleep(spec.tailMs);
    if (pc.connectionState !== 'connected') throw new Error(stage);
    await post('sent', JSON.stringify({ durationMs: Math.round(buffer.duration * 1000) }));
  } catch {
    try { peer?.close(); } catch { /* already closed */ }
    try { await context?.close(); } catch { /* already closed */ }
    await post('fail', JSON.stringify({ reason: stage })).catch(() => undefined);
  }
}

/** The served script: rtcPage's own source, called once with the window. */
export const RTC_SCRIPT = `(${rtcPage.toString()})(globalThis);\n`;

export const RTC_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Voice</title></head><body><script src="/rtc.js"></script></body></html>';

/** Only this origin's script and fetches; no media elements, images, styles, frames or forms. */
export const RTC_CSP = ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');
