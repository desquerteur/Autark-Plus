// devices/tools.ts localCaps: what this PC offers linked PCs, without ever asking adb (phone.devices
// asks adb itself); a start clears an older run's phone list.
// Owns: these assertions only. Never: real adb, browsers or screens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localCaps } from '../../../src/runtime/devices/tools.ts';
import type { ComputerService } from '../../../src/runtime/computer/service.ts';
import type { BrowserService } from '../../../src/runtime/browser/service.ts';
import type { AdbPhone } from '../../../src/runtime/phone/adb.ts';

test('localCaps never asks adb and clears an older phone list', async () => {
  const asked: string[] = [];
  const phone = {
    available: async () => { asked.push('available'); return true; },
    devices: async () => { asked.push('devices'); return [{ serial: 'R5CT', state: 'device' }]; },
  } as unknown as AdbPhone;
  const computer = { canControl: () => true, platform: 'win32' } as unknown as ComputerService;
  const caps = await localCaps({ computer, browser: {} as BrowserService, phone });
  assert.deepEqual(asked, []);
  assert.equal(caps.adbPhones, undefined);
  assert.equal('adbPhones' in caps, true, 'the key is sent, so a stale list on linked PCs is replaced');
  assert.equal(caps.computerUse, true);
  assert.equal(caps.os, 'win32');
  assert.equal(typeof caps.browser, 'boolean');
  assert.equal(caps.version, undefined, 'no version given, none sent');
});

test('F25: the caps carry the app version this PC runs', async () => {
  const computer = { canControl: () => false, platform: 'win32' } as unknown as ComputerService;
  const caps = await localCaps({ computer, browser: {} as BrowserService, phone: {} as AdbPhone, version: '0.3.9' });
  assert.equal(caps.version, '0.3.9');
});
