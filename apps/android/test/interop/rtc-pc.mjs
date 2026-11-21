// Owns: the PC's side of the phone's WebRTC interop run (F25 stage 2, test/relay/RtcInterop.java) – the desktop's real
// PhoneBridge with its WebRTC way (rendezvous/phone.ts, rtc.ts, rtc-socket.ts, werift as the PC runs it) behind a
// runtime port that answers like the PC's (/, /big: 1 MiB, POST: length and SHA-256 back), and the phone's peer
// connection played by werift in place of the phone's libwebrtc, driven line by line from Java. Channel A runs over
// this process's stdin/stdout as the tunnel would (the Java phone's PeerChannel, its pinned handshake). One JSON object
// per line each way. Argument 1: the phone's Ed25519 key (b64url); argument 2: ok | off | blocked.
// Never: listens beyond loopback, uses STUN (the PC offers an empty list), or changes apps/desktop.
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../desktop');
const load = (relative) => import(pathToFileURL(path.join(desktop, relative)).href);
const { DeviceIdentity } = await load('src/runtime/devices/identity.ts');
const { PhoneBridge } = await load('src/runtime/devices/rendezvous/phone.ts');
const { b64url, fromB64url } = await load('src/runtime/devices/keys.ts');
const { systemClock } = await load('src/runtime/system/clock.ts');
const { fakeHost, memoryDb } = await load('test/unit/devices/fakes.ts');
const { RTCPeerConnection } = await import(pathToFileURL(path.join(desktop, 'node_modules/werift/lib/index.mjs')).href);

const [phoneKey, mode = 'ok'] = process.argv.slice(2);
const say = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const lines = [];
const keep = (message, data) => { lines.push({ message, data }); };
const log = { debug: keep, info: keep, warn: keep, error: keep };

const big = Buffer.alloc(1024 * 1024);
for (let i = 0; i < big.length; i++) big[i] = i % 251; // the phone checks every byte
const runtime = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let length = 0;
    const hash = crypto.createHash('sha256');
    req.on('data', (chunk) => { length += chunk.length; hash.update(chunk); });
    req.on('end', () => res.end(`got ${length} ${hash.digest('hex')}`));
  } else if (req.url === '/big') res.end(big);
  else res.end('hello phone');
});
await new Promise((resolve) => runtime.listen(0, '127.0.0.1', resolve));

const pc = await DeviceIdentity.load({ db: memoryDb(), host: fakeHost(), clock: systemClock, name: 'Desk' });
const phonePub = fromB64url(phoneKey);
const record = { id: 'dev_phone0000000', name: 'Phone', kind: 'phone', role: 'client', fingerprint: crypto.createHash('sha256').update(phonePub).digest('hex'), publicKey: phoneKey, addresses: [], caps: {}, status: 'online', self: false };
const bridge = new PhoneBridge({
  identity: pc, log, port: () => runtime.address().port, phone: (fp) => (fp === record.fingerprint ? record : undefined),
  rtc: { stun: () => (mode === 'off' ? undefined : []), tryMs: 4_000 },
});

// Channel A: the tunnel, over stdio.
const heard = [];
const ended = [];
let closed = false;
const tunnel = {
  send(data) { if (!closed) say({ k: 'a', t: typeof data === 'string', d: Buffer.from(data).toString('base64') }); },
  close(code) { if (closed) return; closed = true; say({ k: 'aclose' }); queueMicrotask(() => ended.forEach((listener) => listener(code))); },
  onMessage(listener) { heard.push(listener); },
  onClose(listener) { ended.push(listener); },
};
bridge.accept(tunnel, record).catch((error) => say({ k: 'fail', why: String(error?.message ?? error) }));

// The phone's peer connection (werift standing in for the phone's libwebrtc).
let peer;
let channel;
async function answer({ offer, stun }) {
  const blocked = mode === 'blocked' ? { iceFilterCandidatePair: () => false, iceFilterStunResponse: () => false } : {};
  peer = new RTCPeerConnection({ iceServers: stun.length ? [{ urls: stun }] : [], iceUseDefaultStunServer: false, iceUseTcp: false, ...blocked });
  peer.onIceCandidate.subscribe((candidate) => { if (candidate?.candidate) say({ k: 'cand', line: candidate.candidate }); });
  peer.iceGatheringStateChange.subscribe((state) => { if (state === 'complete') say({ k: 'gathered' }); });
  peer.iceConnectionStateChange.subscribe((state) => say({ k: 'ice', state }));
  peer.onDataChannel.subscribe((dc) => {
    channel = dc;
    dc.stateChanged.subscribe((state) => { if (state === 'open') say({ k: 'open', label: dc.label }); else if (state === 'closed') say({ k: 'closed' }); });
    dc.onMessage.subscribe((data) => say({ k: 'dc', t: typeof data === 'string', d: Buffer.from(data).toString('base64') }));
    if (dc.readyState === 'open') say({ k: 'open', label: dc.label });
  });
  await peer.setRemoteDescription({ type: 'offer', sdp: offer });
  await peer.setLocalDescription(await peer.createAnswer());
  say({ k: 'answered', sdp: peer.localDescription.sdp });
}

say({ k: 'pc', pub: b64url(pc.publicKey) });
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.k === 'a') { const data = Buffer.from(m.d, 'base64'); for (const listener of heard) listener(data, m.t); }
  else if (m.k === 'aclose') tunnel.close(1000);
  else if (m.k === 'answer') answer(m).catch((error) => say({ k: 'answerfail', why: String(error?.message ?? error) }));
  else if (m.k === 'dcsend') { const data = Buffer.from(m.d, 'base64'); try { channel?.send(m.t ? data.toString('utf8') : data); } catch { /* closed */ } }
  else if (m.k === 'close') await peer?.close().catch(() => undefined);
  else if (m.k === 'logs') {
    say({ k: 'logs', lines: lines.filter((each) => each.message.startsWith('phone')).map((each) => ({ message: each.message, ...each.data })), counts: bridge.counts() });
  } else if (m.k === 'quit') { await peer?.close().catch(() => undefined); runtime.closeAllConnections(); runtime.close(); process.exit(0); }
}
