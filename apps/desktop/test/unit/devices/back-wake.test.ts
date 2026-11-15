// B-080 (devices/back-wake.ts, tools/registry.ts): a call that could not reach a linked PC says "I hear it here when it
// is back" and notes the agent; the PC turning online (device.upserted) wakes it once in that chat with the note
// "<PC> is reachable again."; a second online event wakes nobody. A call without a chat or task, a refusal and a call
// whose link dropped after the send note nothing; neither does a forwarded call whose error names a third PC (that PC's
// own dial failed there). A real Registry and Bus, fake devices and a recording wake queue.
// Owns: these assertions only. Never: opens sockets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from '../../../src/runtime/bus.ts';
import { wakeWhenBack } from '../../../src/runtime/devices/back-wake.ts';
import { LINK_DROPPED } from '../../../src/runtime/devices/rpc-peer.ts';
import { Registry } from '../../../src/runtime/tools/registry.ts';
import type { ToolContext, ToolDef } from '../../../src/runtime/tools/types.ts';
import type { RuntimeServices, WakeRequest } from '../../../src/runtime/contracts.ts';
import type { Device } from '../../../src/shared/model/devices.ts';
import type { ModeInfo } from '../../../src/shared/model/knowledge.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { agent } from '../chat/harness.ts';

const pc = (id: string, name: string, extra: Partial<Device> = {}): Device => ({
  id, name, kind: 'pc', role: 'home', fingerprint: `fp_${id}`, addresses: [], caps: {}, status: 'offline', self: false, ...extra,
});
const DEVICES = [pc('dev_self', 'office-pc', { self: true, status: 'online' }), pc('dev_nb', 'notebook')];
const MODE = { key: 'computer', name: 'Computer', workspace: 'computer', tools: ['screen.*', 'pc.*'] } as unknown as ModeInfo;
const textOf = (out: { content: Array<{ type: string; text?: string }> }) => out.content.map((part) => part.text ?? '').join('\n');

function rig(failure: () => Error) {
  const wakes: WakeRequest[] = [];
  const bus = new Bus((error) => { throw error; });
  const services = {
    bus,
    wakes: { wake: (request: WakeRequest) => { wakes.push(request); } },
    devices: { self: () => DEVICES[0], list: () => DEVICES, online: () => false, call: async () => { throw failure(); } },
    modes: { get: () => MODE },
    runs: { item: () => ({ id: 'ri_1' }), updateItem: () => undefined },
    db: { get: () => undefined },
    secrets: { redact: (text: string) => text },
    files: { put: async () => ({ id: 'file_1' }) },
    org: { list: () => [], get: () => undefined },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as RuntimeServices;
  const registry = new Registry({ services: () => services });
  const shell: ToolDef = {
    name: 'screen.shell', description: 'a remote tool', inputSchema: { type: 'object' }, category: 'read', remote: true,
    describe: () => ({ summary: 'Run', reversible: true, external: false }),
    run: async () => ({ content: [{ type: 'text', text: 'ran here' }] }),
  };
  // A tool of this PC that asks a linked PC itself (as devices.send_file does with files.put).
  const ask: ToolDef = {
    name: 'pc.ask', description: 'asks the notebook', inputSchema: { type: 'object' }, category: 'read',
    describe: () => ({ summary: 'Ask', reversible: true, external: false }),
    run: async (_args, ctx) => { await ctx.services.devices.call('dev_nb', 'files.put', {}); return { content: [] }; },
  };
  registry.register(shell);
  registry.register(ask);
  const off = wakeWhenBack(services);
  const base = (extra: Partial<ToolContext> = {}) => ({ agent: agent('ag_lena', 'Lena'), runId: 'run_1', mode: 'computer', signal: new AbortController().signal, status: () => {}, ...extra });
  const online = (status: Device['status'] = 'online') => bus.emit('device.upserted', { ...DEVICES[1], status });
  return { registry, wakes, base, online, off };
}

const unreachable = () => new WorkforceError('unavailable', 'notebook is not reachable (last seen 3 min ago).', { details: { deviceId: 'dev_nb', reachable: false } });

test('an unreachable PC: the failure says I hear it when it is back, and its coming online wakes me once in that chat', async () => {
  const t = rig(unreachable);
  try {
    const out = await t.registry.call('screen.shell', { device: 'notebook' }, t.base({ conversationId: 'conv_1' }), 'call_1');
    assert.equal(out.isError, true);
    assert.equal(textOf(out), 'notebook is not reachable (last seen 3 min ago). I hear it here when it is back.');
    await t.registry.call('screen.shell', { device: 'notebook' }, t.base({ conversationId: 'conv_1' }), 'call_2'); // asked again: still one entry
    t.online('connecting');
    t.online('offline');
    assert.deepEqual(t.wakes, [], 'not online yet');
    t.online();
    assert.deepEqual(t.wakes, [{
      agentId: 'ag_lena', reason: 'event', conversationId: 'conv_1', taskId: undefined,
      note: 'notebook is reachable again.', coalesceKey: 'device-back:dev_nb:conv_1',
    }]);
    t.online();
    assert.equal(t.wakes.length, 1, 'a second online event wakes nobody');
  } finally { t.off(); }
});

test('a tool of this PC that could not reach the linked PC (invoke\'s catch) wakes me in its task too', async () => {
  const t = rig(unreachable);
  try {
    const out = await t.registry.call('pc.ask', {}, t.base({ taskId: 'task_1' }), 'call_1');
    assert.match(textOf(out), /I hear it here when it is back\.$/);
    t.online();
    assert.deepEqual(t.wakes.map((wake) => [wake.taskId, wake.coalesceKey]), [['task_1', 'device-back:dev_nb:task:task_1']]);
  } finally { t.off(); }
});

test('nothing is noted without a chat or task, for a refusal, or when the link dropped after the send', async () => {
  for (const failure of [
    unreachable,
    () => new WorkforceError('unavailable', 'notebook is not reachable (last seen 3 min ago).', { details: { deviceId: 'dev_nb', reachable: false, refused: true } }),
    () => new WorkforceError('unavailable', LINK_DROPPED),
  ]) {
    const t = rig(failure);
    try {
      const ctx = failure === unreachable ? t.base() : t.base({ conversationId: 'conv_1' });
      const out = await t.registry.call('screen.shell', { device: 'notebook' }, ctx, 'call_1');
      assert.equal(out.isError, true);
      assert.doesNotMatch(textOf(out), /I hear it here/);
      t.online();
      assert.deepEqual(t.wakes, []);
    } finally { t.off(); }
  }
});

test('a forwarded call that failed on that PC\'s own dial of a third PC is a plain failure; one naming no PC notes the PC it went to', async () => {
  // devices.send_file {device: notebook, to: laptop}: the notebook could not reach the laptop – this PC may reach it, so no wake would come.
  const third = rig(() => new WorkforceError('unavailable', 'laptop is not reachable (last seen 1 min ago).', { details: { deviceId: 'dev_lap', reachable: false } }));
  try {
    const out = await third.registry.call('screen.shell', { device: 'notebook' }, third.base({ conversationId: 'conv_1' }), 'call_1');
    assert.equal(out.isError, true);
    assert.equal(textOf(out), 'laptop is not reachable (last seen 1 min ago).');
    third.online();
    assert.deepEqual(third.wakes, [], 'nothing was noted for the notebook either');
  } finally { third.off(); }

  const unnamed = rig(() => new WorkforceError('unavailable', 'The linked device is offline.', { details: { reachable: false } }));
  try {
    const out = await unnamed.registry.call('screen.shell', { device: 'notebook' }, unnamed.base({ conversationId: 'conv_1' }), 'call_1');
    assert.equal(textOf(out), 'The linked device is offline. I hear it here when it is back.');
    unnamed.online();
    assert.deepEqual(unnamed.wakes.map((wake) => wake.coalesceKey), ['device-back:dev_nb:conv_1']);
  } finally { unnamed.off(); }
});
