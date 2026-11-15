// B-084 (decision 4) the page side of the one page↔app channel (ui/pwa/native-port.ts): the app's hello is exactly
// 'autark-port' with a port and no source window (an iframe's message never counts); messages are JSON strings both
// ways; the newest port wins; the last 'companies'/'status' and the local 'port' reach a late subscriber.
// Owns: these assertions with a fake MessagePort. Never: a real WebView.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptPort, hasNativePort, isPortHello, onNative, parseNative, resetNativePort, sendNative } from '../../../src/ui/pwa/native-port.ts';

class FakePort {
  sent: unknown[] = [];
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage(data: unknown) { this.sent.push(data); }
  close() { this.closed = true; }
  fromApp(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
const asPort = (fake: FakePort) => fake as unknown as MessagePort;

test('only the app hello counts: the exact string, a port, no frame as source', () => {
  const top = {};
  const port = asPort(new FakePort());
  assert.equal(isPortHello({ data: 'autark-port', ports: [port], source: null }, top), true, 'postWebMessage has no source window');
  assert.equal(isPortHello({ data: 'autark-port', ports: [port], source: top as MessageEventSource }, top), true);
  assert.equal(isPortHello({ data: 'autark-port', ports: [port], source: {} as MessageEventSource }, top), false, 'an agent iframe');
  assert.equal(isPortHello({ data: 'autark-port', ports: [], source: null }, top), false, 'no port');
  assert.equal(isPortHello({ data: 'autark-port2', ports: [port], source: null }, top), false);
  assert.equal(isPortHello({ data: { t: 'autark-port' }, ports: [port], source: null }, top), false);
});

test('no port: sendNative is false; with one it sends a JSON string', () => {
  resetNativePort();
  assert.equal(hasNativePort(), false);
  assert.equal(sendNative({ t: 'add' }), false);
  const fake = new FakePort();
  adoptPort(asPort(fake));
  assert.equal(hasNativePort(), true);
  assert.equal(sendNative({ t: 'switch', id: 'c2' }), true);
  assert.deepEqual(fake.sent, ['{"t":"switch","id":"c2"}']);
});

test('app messages: JSON parsed and dispatched by type, junk dropped, unsubscribe works', () => {
  resetNativePort();
  const fake = new FakePort();
  adoptPort(asPort(fake));
  const got: unknown[] = [];
  const off = onNative('share', (msg) => got.push(msg));
  fake.fromApp('{"t":"share","files":2}');
  fake.fromApp('not json');
  fake.fromApp('{"files":2}');
  fake.fromApp('{"t":"saved","name":"a.pdf"}');
  fake.fromApp({ t: 'share', text: 'hi' });
  off();
  fake.fromApp('{"t":"share","files":1}');
  assert.deepEqual(got, [{ t: 'share', files: 2 }, { t: 'share', text: 'hi' }]);
  assert.equal(parseNative('[1]'), null);
  assert.equal(parseNative('{"t":"port"}')?.t, 'port');
});

test('a late subscriber gets the last companies and status, and port right away; never a forged "port" from the app', () => {
  resetNativePort();
  const fake = new FakePort();
  adoptPort(asPort(fake));
  fake.fromApp('{"t":"companies","list":[{"id":"c1"}]}');
  fake.fromApp('{"t":"status","connected":false}');
  fake.fromApp('{"t":"status","connected":true,"pc":"Office"}');
  fake.fromApp('{"t":"share","files":1}');
  const seen: unknown[] = [];
  onNative('companies', (msg) => seen.push(msg));
  onNative('status', (msg) => seen.push(msg));
  onNative('share', (msg) => seen.push(msg));
  let ports = 0;
  onNative('port', () => { ports++; });
  fake.fromApp('{"t":"port"}');
  assert.deepEqual(seen, [{ t: 'companies', list: [{ id: 'c1' }] }, { t: 'status', connected: true, pc: 'Office' }], 'share is not replayed');
  assert.equal(ports, 1);
});

test('the newest port wins: the old one is closed and its messages ignored; port subscribers hear the new one', () => {
  resetNativePort();
  let ports = 0;
  onNative('port', () => { ports++; });
  const first = new FakePort();
  const second = new FakePort();
  adoptPort(asPort(first));
  const got: unknown[] = [];
  onNative('resume', (msg) => got.push(msg));
  adoptPort(asPort(second));
  assert.equal(first.closed, true);
  assert.equal(ports, 2);
  first.fromApp('{"t":"resume"}');
  second.fromApp('{"t":"resume"}');
  assert.equal(got.length, 1);
  sendNative({ t: 'haptic' });
  assert.deepEqual(first.sent, []);
  assert.deepEqual(second.sent, ['{"t":"haptic"}']);
});

test('a throwing handler does not stop the others', () => {
  resetNativePort();
  const fake = new FakePort();
  adoptPort(asPort(fake));
  let reached = false;
  const error = console.error;
  console.error = () => undefined;
  try {
    onNative('saved', () => { throw new Error('boom'); });
    onNative('saved', () => { reached = true; });
    fake.fromApp('{"t":"saved","name":"x"}');
  } finally { console.error = error; }
  assert.equal(reached, true);
});
