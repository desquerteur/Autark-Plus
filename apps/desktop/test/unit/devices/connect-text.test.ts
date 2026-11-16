// The texts of Settings › Devices (ui/settings/connect-text.ts): grouped Remote IDs, the line under
// "Connect" for each state of this PC's request (with the code while it waits), the Remote ID hint
// with the meeting server or "only this network", a device row's hint (an employee's PC names its
// person), and when the first run's Connect card ends the first run (ui/onboarding/first-run-model.ts); F09 the PCs on
// this network grouped by PC with their companies, F17 a request waiting on another of my PCs.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectLine, deviceHint, groupDigits, incomingText, nearbyGroups, nearbyHint, remoteIdHint, typedTarget, CONNECT_HINT } from '../../../src/ui/settings/connect-text.ts';
import { linkedAsCeo } from '../../../src/ui/onboarding/first-run-model.ts';
import type { Device } from '../../../src/shared/model/devices.ts';
import type { NearbyPc, RemoteOutgoing } from '../../../src/shared/model/remote.ts';

const out = (status: RemoteOutgoing['status'], role: RemoteOutgoing['role'] = 'ceo'): RemoteOutgoing => ({ id: 'ro_1', role, deviceId: 'dev_x', name: 'Tower', remoteId: '123456782', fingerprint: 'f'.repeat(64), code: '4821', status, expiresAt: 1 });

test('Remote IDs in groups of three; a typed address stays as typed', () => {
  assert.equal(groupDigits('482913071'), '482 913 071');
  assert.equal(typedTarget('4829130'), '482 913 0');
  assert.equal(typedTarget('203.0.113.5'), '203.0.113.5');
});

test('the line under Connect: help, waiting with the code, outcomes, errors', () => {
  assert.deepEqual(connectLine(undefined, null), { text: CONNECT_HINT });
  assert.deepEqual(connectLine(out('waiting', 'employee'), null), { text: 'Waiting for Tower to accept as an employee – it shows the same code', code: '4821', action: 'cancel' });
  assert.equal(connectLine(out('accepted'), null).tone, 'ok');
  assert.equal(connectLine(out('declined'), null).action, 'close');
  assert.deepEqual(connectLine(out('waiting'), 'No Autark PC answered at that address.'), { text: 'No Autark PC answered at that address.', tone: 'error' });
});

test('the Remote ID hint: through the meeting server, or only this network', () => {
  const relay = (status: 'off' | 'connecting' | 'connected' | 'error') => ({ status, peersOnline: 0, relayed: [] });
  assert.equal(remoteIdHint(undefined, true), 'Type it on another PC to connect', 'not read yet: nothing claimed');
  assert.equal(remoteIdHint(relay('connected'), true), 'Type it on another PC to connect · meeting server connected');
  assert.equal(remoteIdHint(relay('off'), true), 'Type it on another PC to connect · only this network (meeting server off)');
  assert.match(remoteIdHint(relay('connecting'), true), /only this network for now \(meeting server connecting…\)$/);
  assert.match(remoteIdHint({ ...relay('error'), error: 'The meeting server is not reachable (ECONNREFUSED)' }, true), /only this network for now \(the meeting server is not reachable \(ECONNREFUSED\)\)$/);
  assert.match(remoteIdHint({ ...relay('error'), error: 'The meeting server refused this PC' }, true), /only this network for now \(the meeting server refused this PC\)$/, 'its own reason, not "not reachable"');
  assert.match(remoteIdHint(relay('error'), true), /only this network for now \(meeting server not reachable\)$/);
  assert.match(remoteIdHint(undefined, false), /devices\.findable/);
});

test('F09: PCs on this network grouped by PC – a PC\'s companies under it; same names elsewhere and older answers stay apart', () => {
  const pc = (name: string, digit: string, addresses: string[], company?: string): NearbyPc => ({
    deviceId: `dev_${digit.repeat(12)}`, name, remoteId: '123456782', fingerprint: digit.repeat(64), addresses, state: 'new', ...(company ? { company } : {}),
  });
  const first = pc('server', 'a', ['http://192.168.1.5:47812', 'http://100.64.0.5:47812'], 'Teydra Lab');
  const second = pc('server', 'b', ['http://192.168.1.5:63140'], 'Teydra Lab');
  const elsewhere = pc('server', 'c', ['http://192.168.1.9:47812'], 'Other firm');
  const old = pc('server', 'd', ['http://192.168.1.5:50000']);
  const notebook = pc('notebook', 'e', ['http://192.168.1.7:47812'], 'Teydra Lab');
  const groups = nearbyGroups([first, second, elsewhere, old, notebook]);
  assert.deepEqual(groups.map((group) => [group.name, group.pcs.map((entry) => entry.fingerprint[0])]), [
    ['server', ['a', 'b']], // one PC, two companies: they share an address host
    ['server', ['c']], // another PC of the same name on the same network never merges
    ['server', ['d']], // an older PC without a company stays one row
    ['notebook', ['e']],
  ]);
  assert.equal(nearbyHint(notebook, false), 'On this network · Teydra Lab · Remote ID 123 456 782', 'a PC alone: its company in the hint');
  assert.equal(nearbyHint(old, false), 'On this network · Remote ID 123 456 782');
  assert.equal(nearbyHint(first, true), 'Remote ID 123 456 782', 'under its PC: the company is the label');
  assert.deepEqual(nearbyGroups([]), []);
});

test('F17: a request waiting on another of my PCs names that PC', () => {
  const via = { deviceId: 'dev_server', name: 'server' };
  assert.deepEqual(incomingText({ role: 'phone', name: 'Galaxy', code: '5359', via }), { label: 'Phone Galaxy asks server to connect', hint: 'Accept only if the phone shows the code 5359' });
  assert.equal(incomingText({ role: 'ceo', name: 'Tower', code: '1234', via }).label, 'Tower wants to connect to server');
  assert.equal(incomingText({ role: 'employee', name: 'Tower', code: '1234', via }).label, 'Tower wants to connect to server as an employee');
  assert.equal(incomingText({ role: 'ceo', name: 'Tower', code: '1234' }).label, 'Tower wants to connect', 'one waiting here stays as it was');
});

test('the first run ends after a link as the CEO only', () => {
  assert.equal(linkedAsCeo(out('accepted')), true);
  assert.equal(linkedAsCeo(out('accepted', 'employee')), false, 'an employee\'s PC goes on with its own setup');
  assert.equal(linkedAsCeo(out('waiting')), false);
  assert.equal(linkedAsCeo(undefined), false);
});

test('device hints: this PC, a phone, the CEO\'s PC and an employee\'s PC', () => {
  const base: Device = { id: 'dev_a', name: 'Tower', kind: 'pc', role: 'home', fingerprint: 'f', addresses: [], caps: {}, status: 'online', self: false };
  const time = () => '14:02';
  assert.equal(deviceHint({ ...base, self: true }, () => undefined, time), 'This PC');
  assert.equal(deviceHint({ ...base, kind: 'phone', lastSeenAt: 1 }, () => undefined, time), 'Phone · Last used 14:02');
  assert.equal(deviceHint(base, () => undefined, time), 'PC · Online');
  assert.equal(deviceHint({ ...base, personId: 'per_anna', status: 'offline', lastSeenAt: 1 }, (id) => (id === 'per_anna' ? 'Anna' : undefined), time), 'PC · Employee · Anna · Not reachable · Last seen 14:02');
});
