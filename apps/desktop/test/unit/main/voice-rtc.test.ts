// Owner 07.11.2026: the hidden voice window's job (src/main/voice-rtc.ts) with a fake window that plays the page's
// part over the routes – the op arguments' checks, offer → answer → sent → close, one job at a time, the limits on what
// the page posts, a page failure, a timeout and a crash – plus host-services.ts's routing of the voice.rtc* ops and
// the page script's own flow (voice-rtc-page.ts) over fake browser objects. B-082: the page reports the voice's session
// meter (session.usage.updated → usage.audio_duration_ms, a number only) and close answers the last one.
// Owns: these assertions only. Never: Electron or WebRTC.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_OPS, RTC_LIMITS, type DecodedAudio } from '../../../src/shared/api/host-bridge.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { RTC_ORIGIN, rtcAnswerRequest, rtcOfferRequest, VoiceRtc, type RtcServe } from '../../../src/main/voice-rtc.ts';
import { rtcPage, RTC_CSP, type RtcPageEnv } from '../../../src/main/voice-rtc-page.ts';
import { HostServices, type HostServicesDeps } from '../../../src/main/host-services.ts';

const FILE = 'b'.repeat(64);
const pcm = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);
const decoded = (partial = false): DecodedAudio => ({ sampleRate: 16_000, pcm, durationMs: 2_500, startMs: 0, partial });

/** A window whose "page" is driven by the test through `serve`. */
function rig(options: { decode?: () => Promise<DecodedAudio>; page?: (serve: RtcServe, base: string) => Promise<void> } = {}) {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const windows: Array<{ url?: string; destroyed: boolean; gone?: () => void }> = [];
  const clock = { now: 1_000 };
  const rtc = new VoiceRtc({
    now: () => clock.now,
    decode: options.decode ?? (async () => decoded()),
    open: (serve) => {
      const entry: { url?: string; destroyed: boolean; gone?: () => void } = { destroyed: false };
      windows.push(entry);
      return {
        load: async (url) => { entry.url = url; if (options.page) void options.page(serve, url); },
        onGone: (listener) => { entry.gone = listener; },
        destroy: () => { entry.destroyed = true; },
      };
    },
    setTimer: (fn, ms) => { const timer = { fn, ms, live: true }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as { live: boolean }).live = false; },
  });
  return { rtc, timers, windows, clock };
}

const req = (url: string, init?: RequestInit) => new Request(url, init);
const postJson = (serve: RtcServe, url: string, body: unknown) => serve(req(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

/** The page's part: spec, pcm, offer, the held answer, then 'sent'. */
async function goodPage(serve: RtcServe, base: string, seen: { answer?: string; spec?: unknown; pcm?: number; csp?: string | null }): Promise<void> {
  const html = await serve(req(base));
  seen.csp = html.headers.get('Content-Security-Policy');
  seen.spec = await (await serve(req(`${base}spec`))).json();
  seen.pcm = (await (await serve(req(`${base}pcm`))).arrayBuffer()).byteLength;
  assert.equal((await postJson(serve, `${base}offer`, { sdp: 'v=0 offer' })).status, 204);
  assert.equal((await postJson(serve, `${base}offer`, { sdp: 'v=0 again' })).status, 409, 'one offer per job');
  seen.answer = ((await (await serve(req(`${base}answer`))).json()) as { sdp: string }).sdp;
  assert.equal((await postJson(serve, `${base}usage`, { ms: 3_100.4 })).status, 204);
  assert.equal((await postJson(serve, `${base}usage`, { ms: 'x' })).status, 204, 'not a number: ignored');
  assert.equal((await postJson(serve, `${base}sent`, { durationMs: 2_480 })).status, 204);
}

test('host op arguments: a blob id and an audio MIME type; an answer needs a job id and an SDP within the limit', () => {
  assert.deepEqual(rtcOfferRequest({ fileId: FILE, mime: 'audio/webm;codecs=opus' }), { fileId: FILE, startMs: 0, maxMs: RTC_LIMITS.maxMs, mime: 'audio/webm' });
  assert.deepEqual(rtcOfferRequest({ fileId: FILE, mime: 'text/html' }), { fileId: FILE, startMs: 0, maxMs: RTC_LIMITS.maxMs });
  for (const fileId of ['../x', 'a'.repeat(63), 42, undefined]) assert.throws(() => rtcOfferRequest({ fileId }), (error: unknown) => error instanceof WorkforceError && error.code === 'bad_request');
  assert.deepEqual(rtcAnswerRequest({ jobId: 3, sdp: 'v=0\r\no=- 1' }), { jobId: 3, sdp: 'v=0\r\no=- 1' });
  for (const args of [{ jobId: 0, sdp: 'v=0' }, { jobId: 1.5, sdp: 'v=0' }, { jobId: 1, sdp: 'hello' }, { jobId: 1, sdp: `v=0${'x'.repeat(RTC_LIMITS.sdpChars)}` }, { jobId: 1, sdp: 'v=0\0' }, { jobId: 1 }]) {
    assert.throws(() => rtcAnswerRequest(args), (error: unknown) => error instanceof WorkforceError && error.code === 'bad_request', JSON.stringify(args).slice(0, 40));
  }
  for (const op of ['voice.rtcOffer', 'voice.rtcAnswer', 'voice.rtcClose'] as const) assert.ok(HOST_OPS.includes(op), op);
});

test('a job: the offer after the page posted it, the answer to its long-poll, resolved when it says sent; close destroys the window', async () => {
  const seen: { answer?: string; spec?: unknown; pcm?: number; csp?: string | null } = {};
  const r = rig({ page: (serve, base) => goodPage(serve, base, seen) });
  const offer = await r.rtc.offer({ fileId: FILE, mime: 'audio/wav' });
  assert.deepEqual(offer, { jobId: 1, sdp: 'v=0 offer', durationMs: 2_500 });
  assert.equal(r.windows[0].url, `${RTC_ORIGIN}/job/1/`);
  await assert.rejects(r.rtc.offer({ fileId: FILE }), (error: unknown) => error instanceof WorkforceError && error.code === 'conflict', 'one job at a time');
  const sent = await r.rtc.answer({ jobId: 1, sdp: 'v=0 answer' });
  assert.deepEqual(sent, { durationMs: 2_480 });
  assert.equal(seen.answer, 'v=0 answer');
  assert.equal(seen.pcm, pcm.byteLength);
  assert.deepEqual(seen.spec, { rate: 16_000, leadMs: RTC_LIMITS.leadMs, tailMs: RTC_LIMITS.tailMs, gatherMs: 5_000, connectMs: RTC_LIMITS.connectMs });
  assert.equal(seen.csp, RTC_CSP);
  const live = r.timers.filter((timer) => timer.live);
  assert.equal(live.length, 1);
  assert.equal(live[0].ms, RTC_LIMITS.connectMs + RTC_LIMITS.leadMs + 2_500 + RTC_LIMITS.tailMs + 10_000, 'the send timer: the take in real time plus its margins');
  await assert.rejects(r.rtc.answer({ jobId: 1, sdp: 'v=0 answer' }), (error: unknown) => error instanceof WorkforceError && error.code === 'conflict');
  r.clock.now += 56_300;
  assert.deepEqual(r.rtc.close({ jobId: 1 }), { ok: true, sessionMs: 3_100, windowMs: 56_300 }, 'B-082: the session meter the page saw last and the connection\'s own time (answer → close)');
  assert.equal(r.windows[0].destroyed, true);
  assert.equal(r.rtc.windowOpen, false);
  assert.deepEqual(r.rtc.close({ jobId: 1 }), { ok: true }, 'closing again is fine');
  await assert.rejects(r.rtc.answer({ jobId: 1, sdp: 'v=0' }), (error: unknown) => error instanceof WorkforceError && error.code === 'not_found');
});

test('routes: other hosts and jobs are refused, verbs are checked, a bad offer or a page failure ends the job', async () => {
  let serving: RtcServe | null = null;
  const r = rig({ page: async (serve, base) => {
    serving = serve;
    assert.equal((await serve(req('wf-file://media-analyzer/job/1/spec'))).status, 404);
    assert.equal((await serve(req(`${RTC_ORIGIN}/job/99/spec`))).status, 410);
    assert.equal((await serve(req(`${base}offer`))).status, 405);
    assert.equal((await serve(req(`${RTC_ORIGIN}/rtc.js`))).headers.get('Content-Type'), 'text/javascript; charset=utf-8');
    assert.equal((await postJson(serve, `${base}offer`, { sdp: 'no sdp' })).status, 400);
  } });
  await assert.rejects(r.rtc.offer({ fileId: FILE }), /could not be prepared/);
  assert.equal(r.windows[0].destroyed, true);
  assert.equal((await serving!(req(`${RTC_ORIGIN}/job/1/spec`))).status, 410, 'an ended job answers nothing');

  const failing = rig({ page: async (serve, base) => {
    await postJson(serve, `${base}offer`, { sdp: 'v=0 offer' });
    await serve(req(`${base}answer`));
    await postJson(serve, `${base}fail`, { reason: 'connect' });
  } });
  const offer = await failing.rtc.offer({ fileId: FILE });
  await assert.rejects(failing.rtc.answer({ jobId: offer.jobId, sdp: 'v=0 a' }), /did not open/);
  assert.equal(failing.windows[0].destroyed, true);
});

test('a take over the limit, a silent one, a crash and the timers end the job with a clear error', async () => {
  await assert.rejects(rig({ decode: async () => decoded(true) }).rtc.offer({ fileId: FILE }), /over 10 minutes/);
  await assert.rejects(rig({ decode: async () => ({ ...decoded(), pcm: new Uint8Array(0) }) }).rtc.offer({ fileId: FILE }), /no sound/);
  const crash = rig();
  const crashed = crash.rtc.offer({ fileId: FILE });
  await new Promise((resolve) => setTimeout(resolve, 5));
  crash.windows[0].gone!();
  await assert.rejects(crashed, /stopped/);
  const slow = rig();
  const waiting = slow.rtc.offer({ fileId: FILE });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const timer = slow.timers.find((t) => t.live)!;
  assert.equal(timer.ms, RTC_LIMITS.offerMs);
  timer.fn();
  await assert.rejects(waiting, (error: unknown) => error instanceof WorkforceError && error.code === 'timeout');
  assert.equal(slow.windows[0].destroyed, true);
  const unanswered = rig({ page: async (serve, base) => { await postJson(serve, `${base}offer`, { sdp: 'v=0 offer' }); } });
  await unanswered.rtc.offer({ fileId: FILE });
  const wait = unanswered.timers.find((t) => t.live)!;
  assert.equal(wait.ms, RTC_LIMITS.answerMs, 'a job waits for its answer only so long');
  wait.fn();
  assert.equal(unanswered.windows[0].destroyed, true);
});

test('host services: voice.rtc* go to the voice window; without one they are unavailable', async () => {
  const deps = { safeStorage: {}, shell: {}, capture: {}, window: { focused: () => false } } as unknown as HostServicesDeps;
  await assert.rejects(new HostServices(deps).handle({ id: 1, type: 'host', op: 'voice.rtcOffer', args: { fileId: FILE } }), (error: unknown) => error instanceof WorkforceError && error.code === 'unavailable');
  const asked: string[] = [];
  const services = new HostServices({ ...deps, voiceRtc: {
    offer: async () => { asked.push('offer'); return { jobId: 1, sdp: 'v=0', durationMs: 1 }; },
    answer: async () => { asked.push('answer'); return { durationMs: 1 }; },
    close: () => { asked.push('close'); return { ok: true }; },
  } });
  await services.handle({ id: 1, type: 'host', op: 'voice.rtcOffer', args: { fileId: FILE } });
  await services.handle({ id: 2, type: 'host', op: 'voice.rtcAnswer', args: { jobId: 1, sdp: 'v=0' } });
  await services.handle({ id: 3, type: 'host', op: 'voice.rtcClose', args: { jobId: 1 } });
  assert.deepEqual(asked, ['offer', 'answer', 'close']);
});

test('the page: the take into a stream track (never the speaker), offer after gathering, answer, real-time play, then sent', async () => {
  const posts: Array<{ path: string; body: unknown }> = [];
  const log: string[] = [];
  const listeners: Record<string, () => void> = {};
  let channel: ((event: { data: unknown }) => void) | undefined;
  const peer = {
    iceGatheringState: 'gathering', connectionState: 'new', localDescription: null as { sdp: string } | null,
    addTrack: () => { log.push('track'); }, createDataChannel: (label: string) => { log.push(`channel:${label}`); return { addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => { channel = listener; } }; },
    createOffer: async () => ({ type: 'offer', sdp: 'v=0 local' }),
    setLocalDescription: async (d: { sdp?: string }) => { peer.localDescription = { sdp: d.sdp! }; setTimeout(() => { peer.iceGatheringState = 'complete'; listeners.icegatheringstatechange?.(); }, 1); },
    setRemoteDescription: async (d: { sdp: string }) => { log.push(`remote:${d.sdp}`); setTimeout(() => { peer.connectionState = 'connected'; listeners.connectionstatechange?.(); }, 1); },
    addEventListener: (type: string, listener: () => void) => { listeners[type] = listener; }, close: () => { log.push('close'); },
  };
  const env: RtcPageEnv = {
    // short waits stay short; the 5/15 s limits get 100 ms – clamped to 2 ms they raced the fake's 1 ms events (18.11.)
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 5000 ? 100 : Math.min(ms, 2)),
    fetch: async (path, init) => {
      if (path === 'spec') return Response.json({ rate: 16_000, leadMs: 1000, tailMs: 2000, gatherMs: 5000, connectMs: 15000 });
      if (path === 'pcm') return new Response(new Uint8Array([0, 64, 0, 192]));
      if (path === 'answer') return Response.json({ sdp: 'v=0 remote' });
      posts.push({ path, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    },
    AudioContext: class {
      state = 'suspended';
      async resume() { this.state = 'running'; log.push('resume'); }
      async close() {}
      createBuffer(_channels: number, length: number, rate: number) { const data = new Float32Array(length); log.push(`buffer:${length}@${rate}`); return { duration: length / rate, getChannelData: () => data }; }
      createMediaStreamDestination() { return { stream: { getAudioTracks: () => ['track'] } }; }
      createBufferSource() {
        return { buffer: null, connect: (node: unknown) => { log.push(node && typeof node === 'object' && 'stream' in node ? 'to-track' : 'to-other'); }, start: () => {
          log.push('play');
          for (const data of ['{"type":"session.created","usage":{"audio_duration_ms":1}}', '{"type":"session.usage.updated","usage":{"audio_duration_ms":12345}}', 'session.usage.updated {', new ArrayBuffer(2)]) channel?.({ data });
          setTimeout(() => ended?.(), 1);
        }, addEventListener: (_type: string, listener: () => void) => { ended = listener; } };
      }
    } as unknown as RtcPageEnv['AudioContext'],
    RTCPeerConnection: class { constructor() { return peer; } } as unknown as RtcPageEnv['RTCPeerConnection'],
  };
  let ended: (() => void) | undefined;
  await rtcPage(env);
  assert.deepEqual(posts, [{ path: 'offer', body: { sdp: 'v=0 local' } }, { path: 'usage', body: { ms: 12_345 } }, { path: 'sent', body: { durationMs: 0 } }], 'only the usage event\'s number goes to main');
  assert.deepEqual(log, ['buffer:2@16000', 'track', 'channel:oai-events', 'remote:v=0 remote', 'resume', 'to-track', 'play']);
});
