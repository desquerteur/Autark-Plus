// The ping keepalive (http/keepalive.ts, B-077/B-080): a ping every 15 s; a socket is ended only after a minute without
// any frame (onSilent hears it first); any frame counts as life, not only the pong; a tick that comes late because this
// process stalled pings again and ends nobody; the interval is armed only while sockets exist. Fake sockets and a
// manual clock – no timers run.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { KEEPALIVE_MS, Keepalive } from '../../../src/runtime/http/keepalive.ts';

class FakeWs extends EventEmitter {
  pings = 0;
  ended = false;
  ping(): void { this.pings++; }
  terminate(): void { this.ended = true; this.emit('close'); }
}

test('B-080: a socket silent for 45 s stays; past a minute without any frame it is cut, onSilent hearing it first', () => {
  let now = 0;
  const heard: Array<{ ws: unknown; ms: number }> = [];
  const keepalive = new Keepalive(KEEPALIVE_MS, () => now, (ws, ms) => heard.push({ ws, ms }));
  const silent = new FakeWs();
  const pongs = new FakeWs();
  const talks = new FakeWs();
  for (const ws of [silent, pongs, talks]) keepalive.add(ws as never);
  try {
    for (let round = 0; round < 3; round++) { now += KEEPALIVE_MS; keepalive.tick(); pongs.emit('pong'); }
    talks.emit('message', Buffer.from('frame')); // a pong stuck behind a big frame: the frame itself proves life
    assert.equal(now, 45_000);
    assert.deepEqual([silent.ended, silent.pings], [false, 3], '45 s of silence: a low-RAM PC may just have stalled');
    now += KEEPALIVE_MS; keepalive.tick();
    assert.equal(silent.ended, false, 'exactly a minute: still kept');
    now = 61_000; keepalive.tick();
    assert.equal(silent.ended, true, 'past a minute without any frame');
    assert.deepEqual(heard, [{ ws: silent, ms: 61_000 }]);
    assert.equal(pongs.ended, false);
    assert.equal(talks.ended, false);
    assert.equal(keepalive.all().length, 2);
  } finally {
    keepalive.stop();
  }
});

test('a late tick (this process stalled) pings again and ends nobody; the next on-time tick does', () => {
  let now = 0;
  const keepalive = new Keepalive(KEEPALIVE_MS, () => now);
  const ws = new FakeWs();
  keepalive.add(ws as never);
  try {
    now += KEEPALIVE_MS; keepalive.tick();
    now += KEEPALIVE_MS * 4; keepalive.tick(); // 60 s late: its answers may sit unread in this process
    assert.equal(ws.ended, false, 'a late tick never ends a socket');
    assert.equal(ws.pings, 2);
    now += KEEPALIVE_MS; keepalive.tick();
    assert.equal(ws.ended, true, 'still no frame after an on-time round');
  } finally {
    keepalive.stop();
  }
});

test('a ping every 15 s; a dead link is noticed within about 60–75 s on either end', () => {
  assert.equal(KEEPALIVE_MS, 15_000);
  assert.equal(new Keepalive().silentMs, 60_000);
});
