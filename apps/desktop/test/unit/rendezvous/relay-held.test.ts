// 18.11.2026: the meeting server's fallback tunnel has a daily budget and an emergency stop. A tunnel the server closes
// with code 'quota' marks the fallback as held for the server's UTC day (RelayState.held, shown in Settings), and the
// mark is gone on the next day. Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { generateEd25519, rawPublic, signEd25519 } from '../../../src/runtime/devices/keys.ts';
import { RelayClient } from '../../../src/runtime/devices/rendezvous/relay-client.ts';
import { silentLog } from '../devices/fakes.ts';

class FakeWs extends EventEmitter {
  sent: Array<Record<string, unknown>> = [];
  send(data: string | Buffer): void { if (typeof data === 'string') this.sent.push(JSON.parse(data)); }
  ping(): void { /* none */ }
  close(): void { this.emit('close', 1006); }
  terminate(): void { this.emit('close', 1006); }
  frame(value: Record<string, unknown>): void { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
}

test('a tunnel closed for the daily budget holds the fallback until the next UTC day', () => {
  const keys = generateEd25519();
  let clock = Date.parse('2026-11-18T22:00:00Z');
  const sockets: FakeWs[] = [];
  const client = new RelayClient({
    identity: { publicKey: rawPublic(keys.publicKey), sign: (data: Uint8Array) => signEd25519(keys.privateKey, data) },
    log: silentLog, now: () => clock, random: () => 0.5,
    timers: { set: () => 0, clear: () => undefined },
    socket: () => { const ws = new FakeWs(); sockets.push(ws); return ws as unknown as WebSocket; },
    events: { changed: () => undefined, presence: () => undefined, incoming: () => undefined, pair: async () => ({ ok: true }) },
  });
  client.configure('ws://127.0.0.1:9');
  sockets[0].frame({ t: 'challenge', v: 1, n: 'n' });
  sockets[0].frame({ t: 'ready', fp: 'me', online: [] });
  assert.equal(client.state().held, undefined);
  sockets[0].frame({ t: 'closed', tid: 7, code: 'quota' });
  assert.equal(client.state().held, 'quota');
  sockets[0].frame({ t: 'closed', tid: 8, code: 'closed' });
  assert.equal(client.state().held, 'quota', 'an ordinary close changes nothing');
  clock = Date.parse('2026-11-19T00:00:05Z');
  assert.equal(client.state().held, undefined, 'the server starts a new day at 0');
  client.stop();
});
