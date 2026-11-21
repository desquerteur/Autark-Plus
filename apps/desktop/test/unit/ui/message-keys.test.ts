// Keys in a message's text on screen (owner 16.11.2026: "Willst du das sehen wirklich?", "einfach markieren";
// src/ui/chat/message-keys.ts, MessageItem.tsx, MessageActions.tsx, composer/send.ts): a key shows masked until the
// person asks to see it, with one line under the text (Show/Hide in one fixed cell, Save as secret); Save as secret and a
// marked piece call secrets.fromMessage; a send whose message comes back with new handles says so once.
// Owns: these assertions. Never: renders (the components are read as text).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Message } from '../../../src/shared/model/chat.ts';
import type { SessionInfo } from '../../../src/shared/api/methods.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';
import { session } from '../../../src/ui/lib/session.ts';
import { toasts } from '../../../src/ui/lib/toasts.ts';

const calls: Array<[string, unknown]> = [];
(rpc as unknown as { onOpen: unknown }).onOpen = () => () => undefined;
(rpc as unknown as { call: unknown }).call = async (method: string, params: unknown) => { calls.push([method, params]); return { ids: ['sec_api-key'] }; };
const { canSaveFrom, keysIn, keysLine, markedSecret, maskedBody, noteSavedKeys, saveAsSecret } = await import('../../../src/ui/chat/message-keys.ts');

const KEY = 'sk-proj-Ab12Cd34Ef56Gh78Ij90KlMn12Op34Qr56';
const read = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
const message = (patch: Partial<Message> = {}): Message => ({
  id: 'msg_k', conversationId: 'cv_keys', seq: 3, authorId: 'ag_mara', authorKind: 'agent', kind: 'text', body: `Here it is: ${KEY} – keep it.`, attachments: [],
  mentions: [], priority: 'normal', state: 'final', silent: false, meta: {}, createdAt: 1, ...patch,
}) as Message;

test('a key in the text shows masked; status lines and task cards have none to show', () => {
  const keys = keysIn(message());
  assert.equal(keys.length, 1);
  assert.equal(maskedBody(message().body, keys), 'Here it is: sk-p•••••••• – keep it.');
  assert.deepEqual(keysIn(message({ kind: 'status' })), []);
  assert.deepEqual(keysIn(message({ body: 'no key, only secret://sec_api-key' })), []);
  assert.equal(keysLine(1), 'A key is hidden here');
  assert.equal(keysLine(2), '2 keys are hidden here');
});

test("Save as secret: the owner and a phone allowed to; never a colleague's words or a message still being written", () => {
  session.value = { kind: 'owner', allowedMethods: [], capabilities: [] } as unknown as SessionInfo;
  assert.equal(canSaveFrom(message()), true);
  assert.equal(canSaveFrom(message({ authorId: 'per_anna000000', authorKind: 'human' })), false);
  assert.equal(canSaveFrom(message({ state: 'streaming' })), false);
  assert.equal(markedSecret(message(), '  it is  '), 'it is', 'a marked piece of its own text');
  assert.equal(markedSecret(message(), 'not in it'), '');
  assert.equal(markedSecret(message(), '   '), '');
  const handled = message({ body: 'OpenAI key: secret://sec_openai-key' });
  for (const piece of ['sec_openai-key', 'sec_openai', 'secret://sec_openai-key']) assert.equal(markedSecret(handled, piece), '', `a handle is stored already: ${piece}`);
  assert.equal(markedSecret(handled, 'OpenAI key'), 'OpenAI key');
  session.value = { kind: 'device', allowedMethods: ['messages.list'], capabilities: [] } as unknown as SessionInfo;
  assert.equal(canSaveFrom(message()), false, 'a phone without secrets.fromMessage');
  assert.equal(markedSecret(message(), 'it is'), '');
  session.value = null;
});

test('Save as secret and a marked piece call secrets.fromMessage; a send with new handles says so once', async () => {
  calls.length = 0;
  assert.equal(await saveAsSecret(message()), true);
  assert.equal(await saveAsSecret(message(), 'Here it'), true);
  assert.deepEqual(calls, [['secrets.fromMessage', { messageId: 'msg_k' }], ['secrets.fromMessage', { messageId: 'msg_k', value: 'Here it' }]]);
  toasts.value = [];
  noteSavedKeys(`key ${KEY}`, 'key secret://sec_api-key');
  noteSavedKeys('plain text', 'plain text');
  noteSavedKeys('already secret://sec_a', 'already secret://sec_a');
  assert.deepEqual(toasts.value.map((toast) => toast.title), ['Saved 1 key in Secrets']);
});

test('the message shows the masked text and the line; the menu offers Save as secret for a marked piece; send notes stored keys', () => {
  const item = read('src/ui/chat/MessageItem.tsx');
  assert.match(item, /<MessageBody message=\{visible\} \/>/);
  assert.match(item, /keys\.length > 0 && !editing && <KeysLine/);
  assert.match(item, /class="text-button message-keys-show"/, 'Show and Hide share one fixed cell');
  assert.match(read('src/ui/chat/MessageActions.tsx'), /markedSecret\(message, selected\)[\s\S]{0,120}'Save as secret'/);
  assert.match(read('src/ui/chat/composer/send.ts'), /noteSavedKeys\(body, sent\?\.body \?\? body\)/);
  assert.match(read('src/ui/styles/chat.css'), /\.message-keys \.message-keys-show \{ min-width: 34px;/);
});
