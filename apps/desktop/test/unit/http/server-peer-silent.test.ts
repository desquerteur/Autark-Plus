// The runtime HTTP server's own peer sockets (http/server.ts, B-087): one its keepalive cuts after a minute without any
// frame is marked like on the peer listener, so the mesh hears 4008 and the log says 'peer socket silent'; a client
// socket cut by the same keepalive is no peer and gets no such line. Real sockets on loopback; the minute of silence is
// set on the keepalive's own entries, then one round of it runs.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '../../../src/runtime/contracts.ts';
import { SILENT_CLOSE } from '../../../src/runtime/devices/channel.ts';
import type { Keepalive } from '../../../src/runtime/http/keepalive.ts';
import { closeCode, fixture, openSocket } from './fixture.ts';

test('B-087: a peer socket the main server cuts for silence says 4008 and is logged; a client socket is not', async () => {
  const lines: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const log: Logger = { debug() {}, info: (message, data) => { lines.push({ message, data }); }, warn() {}, error() {} };
  const f = fixture({ log });
  try {
    const { port } = await f.server.listen();
    const peer = await openSocket(`ws://127.0.0.1:${port}/peer`);
    const client = await openSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(f.accepted.length, 1);
    const heard = new Promise<number | undefined>((resolve) => f.accepted[0]!.onClose(resolve));
    const ends = [closeCode(peer), closeCode(client)];

    const keepalive = (f.server as unknown as { keepalive: Keepalive }).keepalive;
    const inner = keepalive as unknown as { sockets: Map<unknown, { lastLife: number }>; last: number };
    assert.equal(inner.sockets.size, 2, 'the peer and the client socket share the keepalive');
    for (const state of inner.sockets.values()) state.lastLife = Date.now() - 61_000;
    inner.last = Date.now(); // an on-time round, not a late one
    keepalive.tick();

    assert.equal(await heard, SILENT_CLOSE, 'the mesh hears the cut for silence, not a network error');
    await Promise.all(ends);
    const silent = lines.filter((line) => line.message === 'peer socket silent');
    assert.equal(silent.length, 1, 'one line, for the peer only');
    assert.ok(Number(silent[0]!.data?.ms) > 60_000);
    assert.equal(inner.sockets.size, 0);
  } finally {
    await f.close();
  }
});
