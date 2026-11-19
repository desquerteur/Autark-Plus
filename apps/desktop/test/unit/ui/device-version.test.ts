// Feedback F25 (16.11.2026): Settings › Devices writes each PC's app version after its line – "0.3.6 – behind
// server 0.3.8" when another listed PC runs a newer one, else just the version; a phone, a browser or a PC that
// sends no version shows none (src/ui/settings/device-version.ts).
// Owns: these assertions only. Never: the row's markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Device } from '../../../src/shared/model/devices.ts';
import { updateOffered, versionHint } from '../../../src/ui/settings/device-version.ts';

const pc = (id: string, version?: string, extra: Partial<Device> = {}): Device => ({
  id, name: id, kind: 'pc', role: 'home', fingerprint: `fp_${id}`, addresses: [], caps: version ? { version } : {}, status: 'online', self: false, ...extra,
});

test('a PC behind another names the newest one; the newest PC shows its version only', () => {
  const list = [pc('notebook', '0.3.6', { self: true }), pc('server', '0.3.8'), pc('office', '0.3.7')];
  assert.equal(versionHint(list[0], list), '0.3.6 – behind server 0.3.8');
  assert.equal(versionHint(list[2], list), '0.3.7 – behind server 0.3.8');
  assert.equal(versionHint(list[1], list), '0.3.8');
});

test('no version, a phone or a removed PC: nothing to say or compare', () => {
  const old = pc('old-pc');
  const phone: Device = { ...pc('phone', '0.3.9'), kind: 'phone', role: 'client' };
  const gone = pc('gone', '0.4.0', { status: 'revoked' });
  const me = pc('me', '0.3.8', { self: true });
  const list = [me, old, phone, gone];
  assert.equal(versionHint(old, list), '', 'an older PC sends none');
  assert.equal(versionHint(phone, list), '');
  assert.equal(versionHint(me, list), '0.3.8', 'a phone or a removed PC is no comparison');
});

// Feedback 1b136d01 (19.11.2026): a PC behind the others and online offers its Update on its row.
test('the Update button: only on a PC behind the others that is online', () => {
  const list = [pc('notebook', '0.3.6'), pc('server', '0.3.8', { self: true }), pc('office', '0.3.7', { status: 'offline' })];
  assert.equal(updateOffered(list[0], list), true);
  assert.equal(updateOffered(list[1], list), false, 'the newest needs none');
  assert.equal(updateOffered(list[2], list), false, 'an offline PC cannot be asked');
  assert.equal(updateOffered(pc('old-pc'), list), false, 'no version, no comparison');
});
