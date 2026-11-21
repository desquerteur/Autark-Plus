// F25 stage 2 (16.11.2026): the data channel as a SocketLike (rendezvous/rtc-socket.ts) – framing in 16 KiB pieces both
// ways, the early caps before the handshake (binary before the first text, more than 16 KiB), pieces out of shape, a
// full send buffer, a fuzz run with broken frames (Noah's border test), and the pinned handshake plus SecureChannel over
// it, where a broken frame after the handshake ends the channel. A fake data channel stands in for werift's here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceIdentity } from '../../../src/runtime/devices/identity.ts';
import { acceptSecure, connectSecure } from '../../../src/runtime/devices/channel.ts';
import { MAX_BUFFERED, MAX_EARLY, PIECE, RtcSocket, type DataChannelLike } from '../../../src/runtime/devices/rendezvous/rtc-socket.ts';
import { systemClock } from '../../../src/runtime/system/clock.ts';
import { fakeHost, memoryDb } from '../devices/fakes.ts';

interface FakeChannel extends DataChannelLike { bufferedAmount: number; sent: Array<string | Buffer>; deliver(data: string | Buffer): void; closed: boolean; peer?: FakeChannel }

function fakeChannel(): FakeChannel {
  const messages: Array<(data: string | Buffer) => void> = [];
  const states: Array<(state: string) => void> = [];
  const channel: FakeChannel = {
    bufferedAmount: 0, sent: [], closed: false,
    send(data) { channel.sent.push(data); if (channel.peer) { const copy = typeof data === 'string' ? data : Buffer.from(data); queueMicrotask(() => channel.peer!.deliver(copy)); } },
    close() { if (channel.closed) return; channel.closed = true; for (const state of states) state('closed'); channel.peer?.close(); },
    onMessage: { subscribe: (listener) => { messages.push(listener); } },
    stateChanged: { subscribe: (listener) => { states.push(listener); } },
    deliver(data) { if (!channel.closed) for (const listener of messages) listener(data); },
  };
  return channel;
}

/** Two sockets over a connected pair of fake data channels. */
function pair(): [RtcSocket, RtcSocket, FakeChannel, FakeChannel] {
  const a = fakeChannel();
  const b = fakeChannel();
  a.peer = b;
  b.peer = a;
  return [new RtcSocket(a), new RtcSocket(b), a, b];
}

const received = (socket: RtcSocket) => {
  const out: Array<{ data: Buffer; isText: boolean }> = [];
  socket.onMessage((data, isText) => out.push({ data, isText }));
  return out;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('frames of any size arrive whole; pieces are 16 KiB plus one flag byte, MORE on all but the last', async () => {
  const [left, right, wire] = pair();
  const got = received(right);
  left.send('{"t":"hello"}');
  right.trusted();
  const sizes = [1, PIECE - 1, PIECE, PIECE + 1, 2 * PIECE, 100_000, 8 * 1024 * 1024];
  let before = 0;
  for (const size of sizes) { before = wire.sent.length; left.send(Buffer.alloc(size, size % 251)); }
  await tick();
  assert.deepEqual(got.map((m) => [m.isText, m.data.length]), [[true, 13], ...sizes.map((size) => [false, size])]);
  for (const [i, size] of sizes.entries()) assert.ok(got[i + 1].data.every((byte) => byte === size % 251), `the ${size} bytes are intact`);
  const pieces = wire.sent.filter((data): data is Buffer => Buffer.isBuffer(data));
  assert.ok(pieces.every((piece) => piece.length <= PIECE + 1), 'no piece is larger than 16 KiB + 1');
  const big = wire.sent.slice(before) as Buffer[]; // the 8 MiB frame
  assert.equal(big.length, 512, '8 MiB = 512 pieces of 16 KiB');
  assert.deepEqual([big.filter((piece) => piece[0] === 1).length, big.at(-1)![0]], [511, 0], 'MORE on every piece but the last');
});

test('before the handshake: binary before the first text, or more than 16 KiB in all, ends the socket', async () => {
  const [, early] = pair();
  received(early);
  (early as unknown as { receive(data: Buffer): void }).receive(Buffer.from([0, 1, 2]));
  assert.equal(early.closed, true, 'binary before the first text');
  assert.equal(early.code, 4000);

  const [, chatty] = pair();
  const got = received(chatty);
  const feed = (data: string | Buffer) => (chatty as unknown as { receive(data: string | Buffer): void }).receive(data);
  feed('x'.repeat(4000));
  feed(Buffer.concat([Buffer.from([0]), Buffer.alloc(PIECE - 6000)]));
  assert.equal(chatty.closed, false, 'text first, then binary within 16 KiB, is a handshake on its way');
  feed(Buffer.concat([Buffer.from([0]), Buffer.alloc(MAX_EARLY)]));
  assert.equal(chatty.closed, true, 'past 16 KiB before the handshake is done');
  assert.equal(got.length, 2);

  const [, trusted] = pair();
  const fine = received(trusted);
  const give = (data: string | Buffer) => (trusted as unknown as { receive(data: string | Buffer): void }).receive(data);
  give('hello');
  trusted.trusted();
  for (let i = 0; i < 8; i++) give(Buffer.concat([Buffer.from([0]), Buffer.alloc(PIECE)]));
  assert.equal(trusted.closed, false, 'after the handshake the early cap is gone');
  assert.equal(fine.length, 9);
});

test('pieces out of shape end the socket: a short MORE piece, unknown flags, an empty piece, text inside a frame, past 8 MiB', () => {
  const cases: Array<[string, Array<string | Buffer>]> = [
    ['a MORE piece shorter than 16 KiB', [Buffer.concat([Buffer.from([1]), Buffer.alloc(100)])]],
    ['unknown flag bits', [Buffer.concat([Buffer.from([2]), Buffer.alloc(10)])]],
    ['a piece of only the flag byte', [Buffer.from([0])]],
    ['an empty message', [Buffer.alloc(0)]],
    ['a piece past 16 KiB', [Buffer.concat([Buffer.from([0]), Buffer.alloc(PIECE + 1)])]],
    ['text between the pieces of a frame', [Buffer.concat([Buffer.from([1]), Buffer.alloc(PIECE)]), 'text']],
    ['a frame past 8 MiB', Array.from({ length: 514 }, () => Buffer.concat([Buffer.from([1]), Buffer.alloc(PIECE)]))],
  ];
  for (const [what, frames] of cases) {
    const [, socket] = pair();
    const got = received(socket);
    const feed = (data: string | Buffer) => (socket as unknown as { receive(data: string | Buffer): void }).receive(data);
    feed('hello');
    socket.trusted();
    for (const frame of frames) feed(frame);
    assert.equal(socket.closed, true, what);
    assert.equal(got.filter((m) => !m.isText).length, 0, `${what}: nothing binary came through`);
  }
});

test('a send buffer past 16 MiB ends the socket (the phone goes back to its tunnel); a close keeps its code', async () => {
  const [left, , wire] = pair();
  const codes: Array<number | undefined> = [];
  left.onClose((code) => codes.push(code));
  wire.bufferedAmount = MAX_BUFFERED + 1;
  left.send(Buffer.alloc(10));
  assert.equal(left.closed, true);
  assert.equal(wire.closed, true, 'the data channel is closed too');
  const [refused] = pair();
  refused.onClose((code) => codes.push(code));
  refused.close(4003, 'unknown device');
  await tick();
  assert.deepEqual(codes, [1006, 4003], 'the code the close was given, not the data channel\'s own');
  assert.equal(refused.code, 4003);
});

test('fuzz: 12 runs of 1,500 random frames – no throw, nothing past 8 MiB, nothing after a close; a closed socket is replaced', () => {
  let seed = 0x5eed;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let sockets = 0;
  let delivered = 0;
  for (let run = 0; run < 12; run++) {
    let after = 0;
    let largest = 0;
    const fresh = () => {
      sockets++;
      const [, socket] = pair();
      socket.onMessage((data) => { if (socket.closed) after++; delivered++; largest = Math.max(largest, data.length); });
      const feed = (data: string | Buffer) => (socket as unknown as { receive(data: string | Buffer): void }).receive(data);
      if (random() < 0.7) { feed('hello'); socket.trusted(); }
      return { socket, feed };
    };
    let current = fresh();
    for (let i = 0; i < 1500; i++) {
      if (current.socket.closed) current = fresh();
      const roll = random();
      if (roll < 0.05) current.feed('t'.repeat(Math.floor(random() * 5000)));
      else {
        const length = roll < 0.6 ? PIECE + 1 : Math.floor(random() * (PIECE + 40));
        const frame = Buffer.alloc(length);
        if (length) frame[0] = random() < 0.97 ? (random() < 0.7 ? 1 : 0) : Math.floor(random() * 256);
        current.feed(frame);
      }
    }
    assert.equal(after, 0, 'nothing is delivered once a socket closed');
    assert.ok(largest <= 8 * 1024 * 1024 + 1024, `largest delivered message ${largest}`);
  }
  assert.ok(sockets > 12 && delivered > 50, `the run exercised ${sockets} sockets and ${delivered} delivered messages`);
});

test('the pinned handshake and SecureChannel run over the data channel; a broken frame after the handshake ends the channel', async () => {
  const pcKey = await DeviceIdentity.load({ db: memoryDb(), host: fakeHost(), clock: systemClock, name: 'Desk' });
  const phoneKey = await DeviceIdentity.load({ db: memoryDb(), host: fakeHost(), clock: systemClock, name: 'Pixel' });
  const [phoneSide, pcSide, , pcWire] = pair();
  const accepted = acceptSecure(pcSide, pcKey, (pub) => (pub.equals(phoneKey.publicKey) ? 'dev_pixel' : undefined));
  const phone = await connectSecure(phoneSide, phoneKey, pcKey.fingerprint);
  const pc = await accepted;
  pcSide.trusted();
  phoneSide.trusted();
  const got: unknown[] = [];
  pc.onMessage((message) => got.push(message));
  phone.send({ t: 'd', s: 1, b: 'x'.repeat(1024 * 1024) });
  phone.send({ t: 'e', s: 1 });
  await tick();
  assert.equal(got.length, 2, 'a 1 MB message and a small one arrived');
  assert.equal((got[0] as { b: string }).b.length, 1024 * 1024);
  pcWire.deliver(Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 7)])); // well-framed, but no valid ciphertext
  assert.equal(pc.closed, true, 'a frame that does not open ends the channel');
});
