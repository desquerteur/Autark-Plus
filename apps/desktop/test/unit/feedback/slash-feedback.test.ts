// 16.11.2026 (system-Q2: "/feedback text" in a chat only saved the report and never sent it): it saves and sends like
// the feedback menu's Send, without claiming a kind, and says so in one toast – the report number, or that a report
// which found no connection goes by itself, or why it stays saved.
// Owns: these assertions. Never: a real runtime (rpc.call is a fake) or rendering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationSummary } from '../../../src/shared/model/chat.ts';
import { rpc, RpcError } from '../../../src/ui/lib/rpc.ts';

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
let sendError: unknown;
(rpc as unknown as { call: unknown }).call = async (method: string, params: Record<string, unknown>) => {
  calls.push({ method, params });
  if (method === 'feedback.create') return { id: 'fb_1', text: params.text, author: 'human', status: 'local', createdAt: 1, context: { version: '0.3.9', os: 'win32' } };
  if (method === 'feedback.send') {
    if (sendError) throw sendError;
    return { id: 'fb_1', status: 'sent', receiptId: 'c0fd8641-9cb7-46f5-b790-b6be9ba14381', createdAt: 1 };
  }
  return { ok: true };
};
const { runSlash } = await import('../../../src/ui/chat/composer/slash.ts');
const { session } = await import('../../../src/ui/lib/session.ts');
const { toasts } = await import('../../../src/ui/lib/toasts.ts');

const ctx = { chat: { id: 'ch_1' } as ConversationSummary, openModelMenu: () => undefined, setLevel: () => undefined, send: async () => true };
const last = () => toasts.value[toasts.value.length - 1];

test('"/feedback text" saves and sends the report; the toast names its number', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the toasts' own expiry
  session.value = { kind: 'owner', capabilities: [], secure: true, allowedMethods: [] };
  calls.length = 0;
  assert.equal(await runSlash({ name: 'feedback', arg: 'The sidebar flickers' }, ctx), true, 'the field clears');
  assert.deepEqual(calls.map((call) => call.method), ['feedback.create', 'feedback.send']);
  assert.deepEqual(calls[0].params, { text: 'The sidebar flickers', view: 'chat', conversationId: 'ch_1' }, 'no kind is claimed');
  assert.deepEqual(calls[1].params, { id: 'fb_1' });
  assert.equal(last().title, 'Feedback sent · No. C0FD8641');
});

test('"/feedback text" that finds no connection stays saved and goes by itself; another failure says why', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  session.value = { kind: 'owner', capabilities: [], secure: true, allowedMethods: [] };
  sendError = new RpcError({ code: 'unavailable', message: 'Feedback could not be sent right now; try again later.', details: { reason: 'offline' } });
  assert.equal(await runSlash({ name: 'feedback', arg: 'Offline report' }, ctx), true, 'saved: the field clears');
  assert.deepEqual({ title: last().title, body: last().body }, { title: 'Feedback saved', body: 'Not sent yet – it goes by itself when the connection is back.' });
  sendError = new RpcError({ code: 'unavailable', message: 'Sending feedback is not set up in this version.', details: { reason: 'not_set_up' } });
  await runSlash({ name: 'feedback', arg: 'No sender' }, ctx);
  assert.deepEqual({ title: last().title, body: last().body }, { title: 'Feedback saved', body: 'Sending feedback is not set up in this version.' });
  sendError = undefined;
});

test('"/feedback text" where this connection may not send only saves it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  session.value = { kind: 'device', capabilities: ['chat'], secure: true, allowedMethods: ['feedback.create'] } as never;
  calls.length = 0;
  assert.equal(await runSlash({ name: 'feedback', arg: 'From a limited device' }, ctx), true);
  assert.deepEqual(calls.map((call) => call.method), ['feedback.create']);
  assert.equal(last().title, 'Feedback saved');
});
