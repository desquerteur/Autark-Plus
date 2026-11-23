// The call turn's one log line (src/runtime/rpc/handlers/calls.ts calls.turn): numbers in ms, the two ways it names and
// the answer's model id. Fix after the review of 17.11.2026: heardBy and model were free text of at most 20 and 80
// characters, so a page could put words of the call into the log line.
// Owns: these assertions only. Never: a real device or a call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register as calls } from '../../../src/runtime/rpc/handlers/calls.ts';
import { OWNER, TestClient, rpcFixture, s1Table } from '../rpc/s1-helpers.ts';

const note = (extra: Record<string, unknown> = {}) => ({ callId: 'call_x', heardMs: 900, answerMs: 1800, speakMs: 2000, heardBy: 'plan', answeredBy: 'talker', ...extra });

test('calls.turn takes the ways it knows and a model id, and refuses words', async (t) => {
  const table = s1Table();
  calls(table);
  const f = rpcFixture({ table });
  t.after(f.cleanup);
  const owner = new TestClient(f.server, OWNER);
  assert.deepEqual(await owner.call('calls.turn', note({ model: 'claude-haiku-5-5' })), { ok: true });
  assert.deepEqual(await owner.call('calls.turn', note({ heardBy: 'unknown' })), { ok: true }, 'a take whose way was not reported');
  await assert.rejects(owner.call('calls.turn', note({ heardBy: 'Gerd said the budget' })), /heardBy/);
  await assert.rejects(owner.call('calls.turn', note({ model: 'he asked about the budget' })), /model/);
  await assert.rejects(owner.call('calls.turn', note({ answeredBy: 'somebody' })), /answeredBy/);
});
