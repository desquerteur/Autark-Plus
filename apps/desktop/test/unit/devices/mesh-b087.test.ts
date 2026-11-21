// B-087 the link fixes of devices/mesh.ts: a dial never reaches this PC itself (its own addresses are left out; one that
// still leads here is no refusal), a link that closes soon after a trigger found it live gets one retry on the larger
// id too (it no longer waits for the other PC's backoff after a sleep), at 5 s – the smaller id's own 1 s dial comes
// first and ends it, so both PCs never dial at once – while an old trigger arms nothing, a PC that is off stays
// 'offline' while it is redialed, and the smaller id's link survives only one dial of the other PC in the race window –
// a second one replaces it (live 09.11. 11:29: 20 dials closed in 10 s while nothing synced), and only a kept link is
// reported as connected. The rig is mesh-nodes.ts.
// Owns: these assertions only. Never: real sockets or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevicesRepo } from '../../../src/runtime/devices/repo.ts';
import { TRIGGER_MS } from '../../../src/runtime/devices/mesh-retry.ts';
import type { Logger } from '../../../src/runtime/contracts.ts';
import { silentLog } from './fakes.ts';
import { idOf, linkedBoth, linkedPair, nodes, settle, statusOf } from './mesh-nodes.ts';

test('B-087 a dial leaves out this PC\'s own addresses: one both PCs advertise (VirtualBox, a hotspot) never reaches this PC', async () => {
  const { low, high } = await linkedPair({ connectOnPair: false });
  new DevicesRepo(low.db).patch(idOf(high), { addresses: [low.address, high.address] }); // the other PC lists an address this PC has too
  await low.mesh.connect(idOf(high)).catch(() => undefined);
  await settle();
  assert.ok(linkedBoth(low, high), 'the real address won');
  assert.deepEqual(low.accepted, [], 'no dial reached this PC itself');
});

test('B-087 an address that still leads to this PC (not in its own list yet) is no refusal: the backoff goes on', async () => {
  const { low, high } = await linkedPair({ connectOnPair: false });
  const hairpin = 'http://192.168.56.1:47811';
  nodes.set(hairpin, low); // a new DHCP lease or the router's loopback: this address reaches this PC
  new DevicesRepo(low.db).patch(idOf(high), { addresses: [hairpin] });
  await low.mesh.connect(idOf(high)).catch(() => undefined);
  await settle();
  assert.equal(linkedBoth(low, high), false);
  assert.deepEqual(low.accepted, ['failed'], 'this PC met its own dial');
  assert.equal(low.timers.count(), 1, 'not a 4003: the retries do not end');
  new DevicesRepo(low.db).patch(idOf(high), { addresses: [high.address] }); // the other PC's real address arrives
  low.timers.fire();
  await settle();
  assert.ok(linkedBoth(low, high));
});

test('B-087 a link a trigger found live gets one retry on the larger id too when it closes – the other PC may sit in its 30 s backoff', async () => {
  const { low, high } = await linkedPair({ connectOnPair: false });
  low.mesh.start();
  await settle();
  high.mesh.reconnect(); // host resume on the larger id: its link looks live, the keepalive judges it
  await settle();
  assert.equal(high.timers.count(), 0, 'no ping, no timer');
  low.silence!(); // the link turns out dead (the keepalive's cut, or a reset answering the ping after the wake)
  await settle();
  assert.equal(high.timers.count(), 1, 'one retry on the larger id too');
  assert.deepEqual([low.timers.delays.at(-1), high.timers.delays.at(-1)], [1_000, 5_000], 'after the smaller id\'s own first step');
  high.timers.fire(); // the smaller id did not dial (it sits in its backoff)
  await settle();
  assert.ok(linkedBoth(low, high));
  assert.equal(low.timers.count() + high.timers.count(), 0, 'the new link ended the smaller id\'s pending retry');

  high.silence!(); // that new link closes with no trigger since: only the smaller id retries, as before
  await settle();
  assert.deepEqual([low.timers.count(), high.timers.count()], [1, 0]);
});

test('B-087 after a close both PCs see, the smaller id\'s 1 s dial comes first and ends the larger id\'s one retry: one dial, no link swap', async () => {
  const lines: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const log: Logger = { ...silentLog, info: (message: string, data?: Record<string, unknown>) => { lines.push({ message, data }); } };
  const { low, high } = await linkedPair({ connectOnPair: false, log });
  low.mesh.start();
  await settle();
  high.mesh.reconnect(); // a wake on the larger id finds the link live
  await settle();
  low.silence!(); // then the link closes on both ends at once (a router reset, the keepalive's cut)
  await settle();
  const before = lines.length;
  for (const node of [low, high]) node.timers.fire(1_000); // the 1 s step comes on both PCs
  await settle();
  assert.ok(linkedBoth(low, high));
  assert.deepEqual(low.accepted, [], 'the larger id did not dial as well');
  assert.equal(high.timers.count(), 0, 'the smaller id\'s link ended its one retry');
  assert.deepEqual(lines.slice(before).filter((line) => line.message === 'peer link closed'), [], 'no link swapped');
});

test('B-087 a slow dial of the smaller id that opens after the other PC linked does no second handshake: no link swap', async () => {
  const lines: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const log: Logger = { ...silentLog, info: (message: string, data?: Record<string, unknown>) => { lines.push({ message, data }); } };
  const { low, high } = await linkedPair({ connectOnPair: false, log });
  low.mesh.start();
  await settle();
  high.mesh.reconnect(); // a wake on the larger id finds the link live
  await settle();
  low.silence!(); // the link closes on both ends
  await settle();
  let release!: () => void;
  low.hold = new Promise((resolve) => { release = resolve; }); // the smaller id's dial hangs (its direct addresses time out)
  low.timers.fire(1_000);
  await settle();
  high.timers.fire(); // the larger id's one retry at 5 s links first
  await settle();
  assert.ok(linkedBoth(low, high));
  const before = lines.length;
  release(); // the slow dial's socket opens now
  low.hold = undefined;
  await settle();
  assert.ok(linkedBoth(low, high), 'the link the other PC dialed stays');
  assert.deepEqual(lines.slice(before).filter((line) => line.message === 'peer link closed' || line.message === 'peer dialed'), [], 'no second handshake, no swap');
});

test('B-087 an old trigger arms nothing: a link closing long after the wake is retried by the smaller id alone', async () => {
  const { low, high } = await linkedPair({ connectOnPair: false });
  low.mesh.start();
  await settle();
  high.mesh.reconnect(); // an unlock in the morning finds the link live
  await settle();
  high.clock.advance(TRIGGER_MS); // the link outlived the close a wake leads to
  low.silence!(); // an unrelated close later that day
  await settle();
  assert.deepEqual([low.timers.count(), high.timers.count()], [1, 0]);
});

test('B-087 a PC that is off stays offline while it is redialed: no connecting/offline flip and no event per retry', async () => {
  const { low, high } = await linkedPair();
  high.down = true;
  (await low.mesh.connect(idOf(high))).channel.close();
  await settle();
  assert.equal(statusOf(low, high), 'offline');
  const announced = () => low.events.filter((entry) => entry.event === 'device.upserted' && (entry.data as { id: string }).id === idOf(high)).length;
  const before = announced();
  let release!: () => void;
  low.hold = new Promise((resolve) => { release = resolve; });
  low.timers.fire(); // a background retry dials
  await settle();
  assert.equal(statusOf(low, high), 'offline', 'still offline while the retry dials');
  release();
  await settle();
  low.hold = undefined;
  for (let i = 0; i < 3; i++) { low.timers.fire(); await settle(); }
  assert.equal(announced(), before, 'nothing announced per retry');
  high.down = false;
  low.timers.fire();
  await settle();
  assert.equal(statusOf(low, high), 'online');
  assert.ok(announced() > before, 'coming back is announced');
});

test('B-087 the smaller id\'s link survives one dial of the other PC in the race window; a second replaces it at once', async () => {
  const { low, high } = await linkedPair({ connectOnPair: false });
  await low.mesh.connect(idOf(high)); // S, dialed by the smaller id
  await settle();
  low.cut!(); // the other PC lost S; this PC has not noticed
  await settle();
  assert.equal(high.mesh.online(idOf(low)), false);
  await high.mesh.connect(idOf(low)).catch(() => undefined);
  await settle();
  assert.equal(high.mesh.online(idOf(low)), false, 'its first dial lost the race (a normal race looks the same)');
  await high.mesh.connect(idOf(low)).catch(() => undefined); // a second dial: it does not hold S
  await settle();
  assert.ok(linkedBoth(low, high), 'the second dial is the link now, inside the 10 s window');
  assert.deepEqual(low.accepted, [undefined, idOf(high)], 'only the kept link is reported as connected (http/peer.ts logs it)');
  assert.equal(low.timers.count() + high.timers.count(), 0);
});
