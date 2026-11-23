// The peer listener's sockets before their handshake (http/peer.ts, F29 review 16.11.2026): one address holds at most
// MAX_HANDSHAKES_PER_ADDRESS of them, and a socket whose handshake failed is cut PEER_CLOSE_WAIT_MS after its close frame
// when the other side never answers it (ws waited 30 s) – so one client cannot keep the MAX_PEERS slots full and lock out
// linked PCs and phones. A finished handshake no longer counts for its address. Real sockets on 127.0.0.1, the real
// phone bridge, raw clients that never answer anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceIdentity } from '../../../src/runtime/devices/identity.ts';
import { connectSecure, wrapWs } from '../../../src/runtime/devices/channel.ts';
import { b64url } from '../../../src/runtime/devices/keys.ts';
import { PhoneBridge } from '../../../src/runtime/devices/rendezvous/phone.ts';
import { PeerServer } from '../../../src/runtime/http/peer-server.ts';
import { MAX_HANDSHAKES_PER_ADDRESS, PEER_CLOSE_WAIT_MS } from '../../../src/runtime/http/peer.ts';
import { systemClock } from '../../../src/runtime/system/clock.ts';
import { fakeHost, memoryDb, silentLog } from '../devices/fakes.ts';
import { openSocket } from './fixture.ts';

const identity = (name: string) => DeviceIdentity.load({ db: memoryDb(), host: fakeHost(), clock: systemClock, name });
/** A masked binary frame – data before the hello, which ends the handshake. */
const BINARY = Buffer.from([0x82, 0x84, 0, 0, 0, 0, 1, 2, 3, 4]);

/** A raw client on /peer/phone: its upgrade status, then `frame` (if any), and never an answer – not even a close frame. */
function raw(port: number, opened: net.Socket[], frame?: Buffer): Promise<{ status: number; closed: Promise<boolean> }> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    opened.push(socket);
    const closed = new Promise<boolean>((done) => socket.once('close', () => done(true)));
    socket.on('error', () => undefined);
    socket.once('data', (data: Buffer) => {
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(data.toString('latin1'))?.[1] ?? 0);
      if (status === 101 && frame) socket.write(frame);
      resolve({ status, closed });
    });
    socket.write(`GET /peer/phone HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
  });
}

test('one address holds at most 4 sockets before their handshake; a failed one is cut 2 s after its close frame', async (t) => {
  const pc = await identity('Desk');
  const handset = await identity('Pixel');
  const phone = { id: 'dev_pixel0000001', name: 'Pixel', kind: 'phone' as const, role: 'client' as const, fingerprint: handset.fingerprint, publicKey: b64url(handset.publicKey), addresses: [], caps: {}, status: 'online' as const, self: false };
  const bridge = new PhoneBridge({ identity: pc, log: silentLog, port: () => 1, phone: (fp) => (fp === handset.fingerprint ? phone : undefined) });
  const listener = new PeerServer({
    pairing: { wellKnown: () => ({ app: 'workforce', protocol: 1, deviceId: pc.deviceId, name: 'Desk', fingerprint: pc.fingerprint }), handle: async () => ({ ok: true }) },
    mesh: { accept: async () => { throw new Error('no PC links here'); } },
    phones: bridge, log: () => silentLog, config: () => ({ mode: 'lan', port: 0 }), linked: () => true, hosts: () => ['127.0.0.1'],
  });
  await listener.start();
  const port = listener.port()!;
  const opened: net.Socket[] = [];
  t.after(async () => { for (const socket of opened) socket.destroy(); bridge.closeAll(); await listener.close(); });

  const failed = [];
  for (let i = 0; i < MAX_HANDSHAKES_PER_ADDRESS; i++) failed.push(await raw(port, opened, BINARY));
  assert.deepEqual(failed.map((each) => each.status), Array(MAX_HANDSHAKES_PER_ADDRESS).fill(101));
  assert.equal((await raw(port, opened)).status, 503, 'one more socket of the same address waits');

  const cut = await Promise.race([Promise.all(failed.map((each) => each.closed)).then(() => true), delay(PEER_CLOSE_WAIT_MS + 1_000, false)]);
  assert.equal(cut, true, 'sockets that never answer the close frame are cut after the short wait, not after 30 s');

  const channel = await connectSecure(wrapWs(await openSocket(`ws://127.0.0.1:${port}/peer/phone`)), handset, pc.fingerprint);
  assert.equal(channel.closed, false, 'the phone gets in again');
  const silent = [];
  for (let i = 0; i < MAX_HANDSHAKES_PER_ADDRESS; i++) silent.push((await raw(port, opened)).status);
  assert.deepEqual(silent, Array(MAX_HANDSHAKES_PER_ADDRESS).fill(101), 'a finished handshake no longer counts for its address');
  assert.equal((await raw(port, opened)).status, 503);
});
