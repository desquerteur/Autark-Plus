// The tunnel is the rare fallback (18.11.2026): a daily byte budget per device key, per client source and in total,
// and the emergency stop RELAY_TUNNELS=off. Past a budget the sender's full tunnels close with code 'quota'; a new tunnel
// then opens only as a signalling tunnel (64 KiB, one per minute per key and source) so the devices can still agree on a
// direct path; the next UTC day starts at 0; with tunnels off only signalling tunnels open, meeting and presence go on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelay, SIGNAL_BYTES } from '../src/relay.ts';
import { DayCounter, limitsFromEnv, tunnelsFromEnv } from '../src/limits.ts';
import { connect, device, settle } from './clients.ts';

async function pinnedPair(port: number) {
  const a = device();
  const b = device();
  const ca = await connect(port, { me: a, peers: [b.fp] });
  await ca.next('ready');
  const cb = await connect(port, { me: b, peers: [a.fp] });
  await cb.next('ready');
  return { ca, cb };
}

function frame(tid: number, size: number): Buffer {
  const out = Buffer.alloc(5 + size, 7);
  out.writeUInt32BE(tid, 0);
  out[4] = 0;
  return out;
}

test('a device over its daily tunnel budget loses its tunnels (quota) and cannot open new ones until the next day', async (t) => {
  let clock = Date.parse('2026-11-18T10:00:00Z');
  const relay = await createRelay({ port: 0, host: '127.0.0.1', now: () => clock, limits: { tunnelBytesPerDay: 100_000, bytesPerSecond: 1024 * 1024 * 1024 } });
  t.after(() => relay.close());
  const { ca, cb } = await pinnedPair(relay.port);
  t.after(() => { ca.ws.close(); cb.ws.close(); });
  ca.send({ t: 'open', ref: 1, to: cb.fp });
  const opened = await ca.next('opened');
  await cb.next('incoming');

  ca.ws.send(frame(opened.tid, 60_000));
  await settle(100);
  assert.equal(cb.binary.length, 1, 'within the budget the frame is passed on');
  ca.ws.send(frame(opened.tid, 60_000)); // 120 KB today > 100 KB
  const closed = await ca.next('closed');
  assert.equal(closed.code, 'quota');
  assert.equal(cb.binary.length, 1, 'the frame past the budget is not passed on');
  assert.ok(relay.stats().tunnelBytesToday >= 120_000);

  ca.send({ t: 'open', ref: 2, to: cb.fp });
  const signal = await ca.next('opened');
  assert.equal(signal.held, 'quota', 'past the budget a tunnel opens only for signalling');
  await cb.next('incoming');
  ca.ws.send(frame(signal.tid, 16_000)); // a WebRTC offer passes
  await settle(100);
  assert.equal(cb.binary.length, 2);
  ca.ws.send(frame(signal.tid, SIGNAL_BYTES - 16_000)); // data beyond the signalling bytes does not
  const capped = await ca.next('closed');
  assert.equal(capped.code, 'quota');
  assert.equal(cb.binary.length, 2);
  ca.send({ t: 'open', ref: 3, to: cb.fp });
  const refused = await ca.next('error');
  assert.equal(refused.code, 'quota', 'one signalling tunnel per minute');
  assert.equal(refused.ref, 3);
  clock += 61_000;
  cb.send({ t: 'open', ref: 6, to: ca.fp });
  assert.equal((await cb.next('opened')).held, 'quota', 'towards the device over its budget also only signalling');

  ca.send({ t: 'find', ref: 4, id: '123456782' });
  assert.ok(await ca.next('found'), 'meeting and lookups go on');

  clock = Date.parse('2026-11-19T00:00:01Z');
  ca.send({ t: 'open', ref: 5, to: cb.fp });
  const fresh = await ca.next('opened');
  assert.equal(fresh.held, undefined, 'a new UTC day starts at 0');
});

test('the total budget of the day closes the tunnels of whoever sends past it', async (t) => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', limits: { tunnelBytesPerDay: 10_000_000, tunnelBytesPerDayTotal: 50_000, bytesPerSecond: 1024 * 1024 * 1024 } });
  t.after(() => relay.close());
  const { ca, cb } = await pinnedPair(relay.port);
  t.after(() => { ca.ws.close(); cb.ws.close(); });
  ca.send({ t: 'open', ref: 1, to: cb.fp });
  const opened = await ca.next('opened');
  await cb.next('incoming');
  ca.ws.send(frame(opened.tid, 60_000));
  assert.equal((await ca.next('closed')).code, 'quota');
});

test('emergency stop: with tunnels off only a signalling tunnel opens; presence and Connect lookups go on', async (t) => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', tunnels: false });
  t.after(() => relay.close());
  const { ca, cb } = await pinnedPair(relay.port);
  t.after(() => { ca.ws.close(); cb.ws.close(); });
  ca.send({ t: 'open', ref: 1, to: cb.fp });
  const signal = await ca.next('opened');
  assert.equal(signal.held, 'off');
  await cb.next('incoming');
  ca.ws.send(frame(signal.tid, SIGNAL_BYTES / 2));
  ca.ws.send(frame(signal.tid, SIGNAL_BYTES / 2)); // with the headers just past the signalling bytes
  assert.equal((await ca.next('closed')).code, 'off');
  ca.send({ t: 'open', ref: 3, to: cb.fp });
  assert.equal((await ca.next('error')).code, 'off');
  assert.equal(relay.stats().tunnelsOn, false);
  ca.send({ t: 'find', ref: 2, id: '123456782' });
  assert.ok(await ca.next('found'));
});

test('environment: RELAY_TUNNELS=off is the stop, the byte budgets are overridable', () => {
  assert.equal(tunnelsFromEnv({}), true);
  assert.equal(tunnelsFromEnv({ RELAY_TUNNELS: 'OFF ' }), false);
  assert.equal(tunnelsFromEnv({ RELAY_TUNNELS: 'on' }), true);
  const limits = limitsFromEnv({ RELAY_TUNNEL_BYTES_PER_DAY: '1000', RELAY_TUNNEL_BYTES_PER_DAY_TOTAL: '20000000000' });
  assert.equal(limits.tunnelBytesPerDay, 1000);
  assert.equal(limits.tunnelBytesPerDayTotal, 20_000_000_000);
  assert.equal(limitsFromEnv({}).tunnelBytesPerDay, 256 * 1024 * 1024);
});

test('day counter: counts per key within a UTC day, resets on the next', () => {
  let clock = Date.parse('2026-11-18T23:59:59Z');
  const day = new DayCounter(() => clock);
  day.add('a', 5);
  assert.equal(day.add('a', 7), 12);
  assert.equal(day.get('b'), 0);
  clock += 2_000;
  assert.equal(day.get('a'), 0);
});
