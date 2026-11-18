// devices/tools.ts localCaps: what this PC offers linked PCs, without ever asking adb or a phone (the driver answers
// from what it has attached – phone/drivers.ts here()); both phone keys are always sent, so an older run's list is replaced.
// Owns: these assertions only. Never: real adb, browsers or screens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localCaps } from '../../../src/runtime/devices/tools.ts';
import type { ComputerService } from '../../../src/runtime/computer/service.ts';
import type { BrowserService } from '../../../src/runtime/browser/service.ts';
import type { AdbPhone } from '../../../src/runtime/phone/adb.ts';

test('localCaps never asks adb or a phone, and carries the phones attached here', async () => {
  const asked: string[] = [];
  const phone = {
    available: async () => { asked.push('available'); return true; },
    devices: async () => { asked.push('devices'); return [{ serial: 'R5CT', state: 'device' }]; },
    here: () => { asked.push('here'); return { app: ['dev_phone'], adb: ['R5CT'] }; },
  } as unknown as AdbPhone;
  const computer = { canControl: () => true, platform: 'win32' } as unknown as ComputerService;
  const caps = await localCaps({ computer, browser: {} as BrowserService, phone });
  assert.deepEqual(asked, ['here'], 'only what the driver already knows');
  assert.deepEqual(caps.adbPhones, ['R5CT']);
  assert.deepEqual(caps.appPhones, ['dev_phone']);
  assert.equal(caps.computerUse, true);
  assert.equal(caps.os, 'win32');
  assert.equal(typeof caps.browser, 'boolean');
  assert.equal(caps.version, undefined, 'no version given, none sent');
});

test('with no phone attached both keys are sent empty, so a stale list on a linked PC is replaced', async () => {
  const computer = { canControl: () => false, platform: 'win32' } as unknown as ComputerService;
  const phone = { here: () => ({ app: [], adb: [] }) } as unknown as AdbPhone;
  const caps = await localCaps({ computer, browser: {} as BrowserService, phone });
  assert.equal(caps.adbPhones, undefined);
  assert.equal(caps.appPhones, undefined);
  assert.equal('adbPhones' in caps && 'appPhones' in caps, true);
});

test('F25: the caps carry the app version this PC runs', async () => {
  const computer = { canControl: () => false, platform: 'win32' } as unknown as ComputerService;
  const caps = await localCaps({ computer, browser: {} as BrowserService, phone: {} as AdbPhone, version: '0.3.9' });
  assert.equal(caps.version, '0.3.9');
});
