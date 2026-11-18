// Feedback 17.11.2026 (src/main/crash-guard.ts): an error nobody caught in the main process is one line in main.log and
// no dialog – Electron shows its default dialog only when the app has no uncaughtException listener of its own.
// Owns: these assertions only. Never: Electron or a real process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { REPEAT_MS, describeError, guardMainErrors } from '../../../src/main/crash-guard.ts';

function rig() {
  const source = new EventEmitter();
  const lines: string[] = [];
  const clock = { now: 1_000_000 };
  guardMainErrors(source as never, (line) => lines.push(line), () => clock.now);
  return { source, lines, clock };
}

test('an uncaught exception is one line with its name, message and file:line:column – and the guard listens, so no dialog', () => {
  const r = rig();
  assert.equal(r.source.listenerCount('uncaughtException'), 1);
  assert.equal(r.source.listenerCount('unhandledRejection'), 1);
  const error = new TypeError('Object has been destroyed');
  error.stack = 'TypeError: Object has been destroyed\n    at Zr.pass (D:\\Apps\\Autark\\resources\\app.asar\\app\\main.cjs:510:1701)\n    at Timeout._onTimeout (C:\\x\\main.cjs:510:2300)';
  assert.doesNotThrow(() => r.source.emit('uncaughtException', error, 'uncaughtException'));
  assert.deepEqual(r.lines, ['unhandled exception: TypeError: Object has been destroyed (main.cjs:510:1701)']);
  assert.ok(!r.lines[0]!.includes('Apps') && !r.lines[0]!.includes('\\'), 'no folders of the install or the PC');
});

test('a rejection of any kind is logged too – an Error, a string, an object, nothing', () => {
  const r = rig();
  for (const reason of [new Error('boom'), 'plain text', { code: 1 }, undefined, null]) assert.doesNotThrow(() => r.source.emit('unhandledRejection', reason));
  assert.equal(r.lines.length, 4, 'an object and null read the same ("object"): one line within a minute');
  assert.match(r.lines[0]!, /^unhandled rejection: Error: boom/);
  assert.match(r.lines[1]!, /^unhandled rejection: string: plain text/);
  assert.match(r.lines[2]!, /^unhandled rejection: object$/);
});

test('the same error every 100 ms is one line a minute with a count, not a line each time', () => {
  const r = rig();
  const error = new TypeError('Object has been destroyed');
  for (let i = 0; i < 400; i++) { r.source.emit('uncaughtException', error, 'uncaughtException'); r.clock.now += 100; }
  assert.equal(r.lines.length, 1, '40 s of the same error: the first line only');
  r.clock.now += REPEAT_MS;
  r.source.emit('uncaughtException', error, 'uncaughtException');
  assert.equal(r.lines.length, 2);
  assert.match(r.lines[1]!, /– 399 more since the last line$/);
  r.source.emit('uncaughtException', new Error('another one'), 'uncaughtException');
  assert.equal(r.lines.length, 3, 'a different error is never held back');
});

test('a long token-like run in a message is masked and a long message is cut; a failing log never throws out of the guard', () => {
  const secret = 'sk-ant-api03-' + 'A1b2C3d4'.repeat(6);
  const line = describeError(new Error(`request failed for ${secret} ${'x '.repeat(300)}`), 'exception');
  assert.ok(!line.includes(secret) && line.includes('…'));
  assert.ok(line.length < 260);
  const source = new EventEmitter();
  guardMainErrors(source as never, () => { throw new Error('disk full'); });
  assert.doesNotThrow(() => source.emit('uncaughtException', new Error('x'), 'uncaughtException'));
});
