// The person's other PCs for "Open on" and the Files cells (src/ui/workspace/linked-pcs.ts, B-081): only the linked CEO
// PCs count (no phone, this PC, an employee's PC, the employer's PC, a revoked or pairing one); one devices.list, then the
// device events keep the list and the names current, and a reconnect reads it again.
// Owns: these assertions only. Never: a real PC, a socket or a window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo } from '../../../src/shared/api/methods.ts';
import type { Device } from '../../../src/shared/model/devices.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';
import { session } from '../../../src/ui/lib/session.ts';
import { isCeoPc, linkedPcs, pcName, rootPcs, watchLinkedPcs, withDevice } from '../../../src/ui/workspace/linked-pcs.ts';

const pc = (id: string, extra: Partial<Device> = {}): Device => ({
  id, name: id, kind: 'pc', role: 'home', fingerprint: `fp_${id}`, addresses: [], caps: {}, status: 'online', self: false, ...extra,
});

test('isCeoPc keeps the person\'s own other PCs only', () => {
  assert.equal(isCeoPc(pc('tower')), true);
  assert.equal(isCeoPc(pc('tower', { status: 'offline', joinedAs: 'ceo' })), true, 'offline still counts (the menu says so)');
  assert.equal(isCeoPc(pc('me', { self: true })), false);
  assert.equal(isCeoPc(pc('phone', { kind: 'phone' })), false);
  assert.equal(isCeoPc(pc('lena', { personId: 'pe_1' })), false, 'an employee\'s PC');
  assert.equal(isCeoPc(pc('boss', { joinedAs: 'employee' })), false, 'the employer\'s PC');
  assert.equal(isCeoPc(pc('old', { status: 'revoked' })), false);
  assert.equal(isCeoPc(pc('new', { status: 'pairing' })), false);
});

test('withDevice adds, replaces in place and takes out', () => {
  const list = [pc('a'), pc('b')];
  assert.deepEqual(withDevice(list, pc('c')).map((d) => d.id), ['a', 'b', 'c']);
  assert.equal(withDevice(list, pc('a', { name: 'Tower' }))[0].name, 'Tower', 'same place');
  assert.deepEqual(withDevice(list, pc('a', { status: 'revoked' })).map((d) => d.id), ['b']);
  assert.deepEqual(withDevice(list, pc('x', { kind: 'phone' })).map((d) => d.id), ['a', 'b']);
});

test('watchLinkedPcs lists once, follows the device events and reads again after a reconnect', async () => {
  const heard = new Map<string, (data: unknown) => void>();
  const opened: Array<() => void> = [];
  let lists = 0;
  let answer: Device[] = [pc('tower', { name: 'Tower' }), pc('me', { self: true }), pc('phone', { kind: 'phone' })];
  Object.assign(rpc, {
    call: async (method: string) => { if (method === 'devices.list') { lists++; return answer; } throw new Error(method); },
    on: (event: string, fn: (data: unknown) => void) => { heard.set(event, fn); return () => undefined; },
    onOpen: (fn: () => void) => { opened.push(fn); return () => undefined; },
  });
  session.value = { kind: 'owner', capabilities: [], secure: true, allowedMethods: [] } as unknown as SessionInfo;
  watchLinkedPcs();
  watchLinkedPcs();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lists, 1, 'idempotent');
  assert.deepEqual(linkedPcs.value.map((d) => d.id), ['tower']);
  assert.equal(pcName('tower'), 'Tower');
  assert.equal(pcName('dev_unknown'), 'another PC');

  heard.get('device.upserted')!(pc('tower', { name: 'Tower', status: 'offline' }));
  assert.equal(linkedPcs.value[0].status, 'offline');
  heard.get('device.upserted')!(pc('laptop', { name: 'Laptop' }));
  assert.deepEqual(linkedPcs.value.map((d) => d.id), ['tower', 'laptop']);
  heard.get('device.removed')!({ id: 'tower' });
  assert.deepEqual(linkedPcs.value.map((d) => d.id), ['laptop']);

  answer = [pc('tower', { name: 'Tower' })];
  opened[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lists, 2);
  assert.deepEqual(linkedPcs.value.map((d) => d.id), ['tower']);
  assert.deepEqual(rootPcs().map((d) => d.id), ['tower'], 'one Files cell per linked CEO PC');
});
