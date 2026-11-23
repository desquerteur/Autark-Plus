// B-087 acceptPeer (http/peer.ts): 'peer connected' is an info line only for a link the mesh kept; a dial the mesh closed
// at once (the other link of a race stays: mesh.accept resolves undefined) is a debug line – agents watch these lines
// (live 09.11. 11:29: 20 'peer connected' lines for links that never existed). Fake socket and mesh.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { acceptPeer } from '../../../src/runtime/http/peer.ts';
import type { Logger } from '../../../src/runtime/contracts.ts';

test('B-087: only a kept link logs "peer connected"', async () => {
  const lines: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];
  const line = (level: string) => (message: string, data?: Record<string, unknown>) => { lines.push({ level, message, data }); };
  const log: Logger = { debug: line('debug'), info: line('info'), warn: line('warn'), error: line('error') };
  for (const kept of [undefined, 'dev_peer00000001']) {
    const ws = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1, CONNECTING: 0, close: () => undefined });
    acceptPeer(ws as never, { mesh: { accept: async () => kept }, log: () => log }, '100.64.0.7');
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lines.filter((entry) => entry.level === 'info'), [{ level: 'info', message: 'peer connected', data: { deviceId: 'dev_peer00000001', remote: '100.64.0.7' } }]);
  assert.deepEqual(lines.filter((entry) => entry.level === 'debug').map((entry) => entry.message), ['peer link not kept (the other link stays)']);
});
