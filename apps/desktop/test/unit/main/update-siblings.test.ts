// Feedback F25 (16.11.2026, "warum das hier nicht synchron läuft"): a linked own PC on a newer version asks this PC's
// updater for one check at once (within the 30 s throttle, once per version), never an install; a version whose install
// did not land here (this start's notice) is not downloaded or restarted for by itself again – a click still installs
// it, a newer one goes the usual way; the desktop wiring passes my own PCs' versions and the notice on
// (src/main/updates/update-service.ts, updates-wiring.ts siblingUpdates); the version order (shared/model/devices.ts).
// Owns: these assertions. Never: electron, network or real timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareAppVersions, type Device } from '../../../src/shared/model/devices.ts';
import type { SystemInfo } from '../../../src/shared/model/system.ts';
import { siblingUpdates } from '../../../src/main/updates-wiring.ts';
import { harness, settle } from './update-fakes.ts';

test('a newer version on a linked PC checks once at once; the same version, an older one or one within the throttle do not', async () => {
  const h = harness({ script: { version: null } });
  h.service.siblingVersion('0.1.9');
  h.service.siblingVersion('0.2.0');
  await settle();
  assert.equal(h.calls.check, 0, 'not newer than this app (0.2.0)');
  h.service.siblingVersion('0.2.1');
  await settle();
  assert.equal(h.calls.check, 1, 'one check at once');
  h.service.siblingVersion('0.2.1');
  await settle();
  assert.equal(h.calls.check, 1, 'once per version');
  h.service.siblingVersion('0.2.2');
  await settle();
  assert.equal(h.calls.check, 1, 'within the check throttle');
  assert.equal(h.calls.install, 0);
  h.service.dispose();
});

test('a version whose install did not land here is not downloaded or restarted for by itself; a click still installs it', async () => {
  const h = harness({ autoDownload: () => true, script: { version: '0.3.0' } });
  h.service.installFailed('0.3.0');
  await h.service.check();
  await settle();
  assert.equal(h.service.state.status, 'available', 'shown, not downloaded by itself');
  assert.equal(h.calls.download, 0);
  h.service.autoDownloadChanged();
  await settle();
  assert.equal(h.calls.download, 0, 'turning automatic updates on again does not retry it either');
  await h.service.apply();
  assert.equal(h.calls.install, 1, 'the click installs it');
  h.service.dispose();
});

test('a downloaded update of a version that failed here waits for a click; a newer version restarts as usual', async () => {
  const h = harness({ autoDownload: () => true, script: { version: '0.3.0' } });
  await h.service.check();
  await settle();
  assert.ok(h.service.state.restartAt, 'the countdown runs');
  h.service.installFailed('0.3.0');
  await settle();
  assert.equal(h.service.state.restartAt, undefined, 'countdown withdrawn');
  const other = harness({ autoDownload: () => true, script: { version: '0.3.1' } });
  other.service.installFailed('0.3.0');
  await other.service.check();
  await settle();
  assert.ok(other.service.state.restartAt, 'another version: the usual countdown');
  h.service.dispose();
  other.service.dispose();
});

test('the desktop wiring: my own PCs\' versions reach the updater, an employee\'s PC does not; a not-landed install of this start does', async () => {
  const listeners: Array<(device: Device) => void> = [];
  let info: SystemInfo = { version: '0.3.6', platform: 'win32', arch: 'x64', dataDir: '', deviceId: 'pc_a', deviceName: 'a', packaged: true, startedAt: 0 };
  const seen: string[] = [];
  const failed: string[] = [];
  const up = siblingUpdates({
    on: (_event, listener) => { listeners.push(listener); return () => {}; },
    subscribe: async () => () => {},
    call: async () => info,
  }, { siblingVersion: (version) => seen.push(version), installFailed: (version) => failed.push(version) });
  const pc = (extra: Partial<Device>): Device => ({ id: 'pc_b', name: 'b', kind: 'pc', role: 'home', fingerprint: 'f', addresses: [], caps: { version: '0.3.8' }, status: 'online', self: false, ...extra });
  for (const listener of listeners) {
    listener(pc({}));
    listener(pc({ personId: 'per_1', caps: { version: '0.4.0' } }));
    listener(pc({ joinedAs: 'employee', caps: { version: '0.4.1' } }));
    listener(pc({ self: true, caps: { version: '0.4.2' } }));
    listener(pc({ caps: {} }));
  }
  assert.deepEqual(seen, ['0.3.8']);
  up();
  await settle();
  assert.deepEqual(failed, [], 'no notice, nothing failed');
  info = { ...info, notice: { id: 'start:1', text: 'The update to 0.3.8 did not install · still on 0.3.6', at: 1, failed: true, to: '0.3.8' } };
  up();
  await settle();
  assert.deepEqual(failed, ['0.3.8']);
});

test('the version order: numbers first, a pre-release before its plain version', () => {
  assert.ok(compareAppVersions('0.3.8', '0.3.6') > 0);
  assert.ok(compareAppVersions('0.3.10', '0.3.9') > 0, 'numbers, not text');
  assert.ok(compareAppVersions('0.3.6-local.3', '0.3.6') < 0);
  assert.ok(compareAppVersions('0.3.6-local.10', '0.3.6-local.9') > 0);
  assert.ok(compareAppVersions('0.3.7-local.1', '0.3.6') > 0);
  assert.equal(compareAppVersions('v0.3.8', '0.3.8'), 0);
});
