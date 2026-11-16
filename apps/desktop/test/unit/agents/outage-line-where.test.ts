// Owns: feedback 16.11.2026 F24 – the Paused line names this PC once other PCs are linked (src/runtime/agents/outage-line.ts).
// Never: runs a turn or reads a real device list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pausedLine, pausedWhere } from '../../../src/runtime/agents/outage-line.ts';

const pc = (name: string, self: boolean, status = 'online'): Record<string, unknown> => ({ id: name, name, kind: 'pc', self, status });
const devices = (list: unknown[]) => ({ self: () => (list as Array<{ self: boolean }>).find((d) => d.self), list: () => list }) as never;

test('pausedWhere: a lone PC, a phone or a revoked PC give no name; a linked PC does', () => {
  assert.equal(pausedWhere({}), undefined, 'no device service');
  assert.equal(pausedWhere({ devices: devices([pc('server', true)]) }), undefined);
  assert.equal(pausedWhere({ devices: devices([pc('server', true), { ...pc('phone', false), kind: 'phone' }]) }), undefined);
  assert.equal(pausedWhere({ devices: devices([pc('server', true), pc('notebook', false, 'revoked')]) }), undefined);
  assert.equal(pausedWhere({ devices: devices([pc('office-pc', true), pc('laptop', false, 'offline')]) }), 'office-pc');
});

test('the Paused line carries the PC name only with another PC linked', () => {
  const lines: string[] = [];
  const chats = { status: (_id: string, status: { text: string }) => { lines.push(status.text); } } as never;
  const reason = 'Every account that can run a suitable model is limited right now.';
  pausedLine({ chats }, 'ch_1', reason, {});
  pausedLine({ chats, devices: devices([pc('office-pc', true), pc('laptop', false)]) }, 'ch_1', reason, {});
  assert.deepEqual(lines, [
    `Paused: ${reason} – continues by itself`,
    `Paused on office-pc: ${reason} – continues by itself`,
  ]);
});
