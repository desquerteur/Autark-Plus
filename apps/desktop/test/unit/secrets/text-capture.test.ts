// Keys in chat text (owner 16.11.2026: "dass irgendwie sogar Token erkennt … das in Secrets einzubandeln … einfach
// markieren"; src/shared/secrets/token-patterns.ts, src/runtime/secrets/text-capture.ts): a key the person sends is
// stored before the message and the message carries its handle (a retry or the same key again stores nothing new);
// prose like "password: hello" and short or word-like strings are no key; an agent's own wf keeps its words; a message
// that still holds a key – or a piece the person marks – goes in through secrets.fromMessage (secure link only) and its
// author's text then shows the handle; an agent does the same with secrets.save and the message's seq. Review 16.11.:
// Stripe keys count, Bearer/Basic prose and slugs do not, an app fence keeps its key, a handle is never stored as a
// value, and a refused edit stores nothing.
// Owns: these assertions. Never: a real keychain (the vault's host is a fake).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SecretVault } from '../../../src/runtime/secrets/service.ts';
import { register as security } from '../../../src/runtime/rpc/handlers/security.ts';
import { HandlerTable } from '../../../src/runtime/rpc/table.ts';
import { redactText } from '../../../src/shared/secrets/redact-text.ts';
import { secretTools } from '../../../src/runtime/tools/builtin/secrets.ts';
import { findKeys, handleCount, maskKey } from '../../../src/shared/secrets/token-patterns.ts';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';
import { agent } from '../chat/harness.ts';
import { OWNER, S1_MODULES, rpcFixture } from '../rpc/s1-helpers.ts';

const host = {
  encrypt: async (plain: string) => Uint8Array.from(Buffer.from(plain, 'utf8'), (byte) => byte ^ 0x5a),
  decrypt: async (cipher: Uint8Array) => Buffer.from(Uint8Array.from(cipher, (byte) => byte ^ 0x5a)).toString('utf8'),
};
const SK = 'sk-proj-Ab12Cd34Ef56Gh78Ij90KlMn12Op34Qr56';
// Stripe-shaped samples are put together at run time: a literal one in the source trips secret scanners (GitHub push protection).
const stripe = (kind: string, rest: string) => [kind, rest].join('_');
const STRIPE = stripe('sk', 'live_51HxYzAbCdEfGh1234567890abcdef');
const RESTRICTED = stripe('rk', 'test_51HxYzAbCdEfGh1234567890');
const PUBLISHABLE = stripe('pk', 'live_51HxYzAbCdEfGh1234567890');
const GH = 'ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3';
const AIZA = 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const PHONE = (secure: boolean): ClientScope => ({ kind: 'device', deviceId: 'dev_phone', capabilities: ['todo', 'chat', 'tasks'], secure });

function rig() {
  const table = new HandlerTable();
  for (const register of [...S1_MODULES, security]) register(table);
  const f = rpcFixture({ table });
  f.org.add(agent('ag_ava', 'Ava'));
  const vault = new SecretVault({ db: f.db, host, clock: f.clock });
  Object.assign(f.services, { secrets: vault });
  const chat = f.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  const send = (body: string, clientId: string, scope: ClientScope = OWNER) => f.server.call('messages.send', { conversationId: chat.id, body, clientId }, scope) as Promise<Message>;
  return { ...f, vault, chat, send };
}

test('keys by their shape: typed prefixes with generated characters; prose, short and word-like strings are none', () => {
  const text = `OpenAI: ${SK}\ngh ${GH} google ${AIZA}\nAuthorization: Bearer ${JWT}`;
  assert.deepEqual(findKeys(text).map((key) => [key.value, key.name, key.kind]), [
    [SK, 'API key', 'api_key'], [GH, 'GitHub token', 'token'], [AIZA, 'Google API key', 'api_key'], [JWT, 'Token', 'token'],
  ], 'one key per place, the JWT after Bearer once');
  for (const prose of ['password: hello', 'passwort = Sommer2024', 'sk-abc123', 'Bearer authentication-required-here', 'a task-list-for-the-whole-team-2024', 'risk-assessment-framework-2024x']) {
    assert.deepEqual(findKeys(prose), [], prose);
  }
  assert.deepEqual(findKeys(`use secret://${GH.toLowerCase()} here`), [], 'a handle is no key');
  const app = `Map:\n\`\`\`app title="Map"\n<script src="https://maps.example/js?key=${AIZA}"></script>\n\`\`\`\nand ${GH}`;
  assert.deepEqual(findKeys(app).map((key) => key.value), [GH], "an app's own web key stays its page's");
  assert.equal(maskKey(findKeys(SK)[0]), 'sk-p••••••••');
  assert.equal(handleCount('a secret://sec_a and secret://sec-b'), 2);
  const report = redactText(`key ${SK} and Authorization: Bearer abcdefghijklmnop`);
  assert.equal(report.includes(SK) || report.includes('abcdefghijklmnop'), false, 'the feedback redactor still takes every match of the shared list');
});

test("the person's message: a key is stored before the message, which carries its handle; a retry and the same key again store nothing new", async (t) => {
  const f = rig();
  t.after(f.cleanup);
  const message = await f.send(`OpenAI key: ${SK}\nand ${GH} for the CI`, 'req_1');
  assert.equal(message.body.includes(SK) || message.body.includes(GH), false, message.body);
  assert.equal(handleCount(message.body), 2);
  const stored = f.vault.list();
  assert.deepEqual(stored.map((info) => [info.label, info.kind, info.conversationId]).sort(), [['GitHub token', 'token', f.chat.id], ['OpenAI key', 'api_key', f.chat.id]],
    'named by the words before it, else its kind ("and" says nothing)');
  const github = stored.find((info) => info.kind === 'token')!;
  assert.equal(github.description, `and secret://${github.id} for the CI`, 'its line, with the handle');
  assert.equal(await f.vault.use(github.id, 'ag_ava'), GH);
  assert.equal(f.chats.message(message.id)!.body, message.body, 'stored with the handles');

  const again = await f.send(`OpenAI key: ${SK}\nand ${GH} for the CI`, 'req_1');
  assert.equal(again.id, message.id, 'the double-send guard answers');
  const twice = await f.send(`the same key ${SK} once more`, 'req_2');
  assert.equal(twice.body, `the same key secret://${stored.find((info) => info.kind === 'api_key')!.id} once more`);
  assert.equal(f.vault.list().length, 2, 'nothing new');

  const plain = await f.send('password: hello – no key here', 'req_3');
  assert.equal(plain.body, 'password: hello – no key here');
  const edited = await f.server.call('messages.edit', { id: plain.id, body: `token ${AIZA}` }, OWNER) as Message;
  assert.match(edited.body, /^token secret:\/\/sec_token$/, 'an edit stores a key too');
});

test("an agent's own wf keeps its words; secrets.fromMessage stores a key there over a secure link and the message shows the handle", async (t) => {
  const f = rig();
  t.after(f.cleanup);
  const posted = await f.send(`Your new key: ${SK}`, 'req_ava', { kind: 'owner', agentId: 'ag_ava' });
  assert.equal(posted.authorId, 'ag_ava');
  assert.equal(posted.body, `Your new key: ${SK}`, "an agent's line is its own");
  await assert.rejects(f.server.call('secrets.fromMessage', { messageId: posted.id }, PHONE(false)), /./, 'plain LAN http');
  const { ids } = await f.server.call('secrets.fromMessage', { messageId: posted.id }, PHONE(true)) as { ids: string[] };
  assert.equal(ids.length, 1);
  const after = f.chats.message(posted.id)!;
  assert.equal(after.body, `Your new key: secret://${ids[0]}`);
  assert.ok(after.editedAt !== undefined, 'edited as its author');
  assert.equal(f.vault.list()[0].label, 'Your new key');
  await assert.rejects(f.server.call('secrets.fromMessage', { messageId: posted.id }, OWNER), /holds no key/);
});

test('a marked piece of a message goes in as a whole value; a piece that is not there on its own is refused', async (t) => {
  const f = rig();
  t.after(f.cleanup);
  const old = f.chats.send({ conversationId: f.chat.id, body: 'Wifi password: Sommer2024!x and the IBAN DE89370400440532013000', authorId: 'human', authorKind: 'human' });
  await assert.rejects(f.server.call('secrets.fromMessage', { messageId: old.id, value: 'Winter2025' }, OWNER), /not in this message/);
  await assert.rejects(f.server.call('secrets.fromMessage', { messageId: old.id, value: 'ommer2024' }, OWNER), /not in this message/, 'only inside a longer word');
  const one = await f.server.call('secrets.fromMessage', { messageId: old.id, value: ' Sommer2024!x ' }, OWNER) as { ids: string[] };
  const two = await f.server.call('secrets.fromMessage', { messageId: old.id, value: 'DE89370400440532013000' }, OWNER) as { ids: string[] };
  assert.equal(f.chats.message(old.id)!.body, `Wifi password: secret://${one.ids[0]} and the IBAN secret://${two.ids[0]}`);
  assert.deepEqual(f.vault.list().map((info) => [info.label, info.kind]).sort(), [['Wifi password', 'password'], ['and the IBAN', 'card']]);
});

test("an agent's secrets.save with a message's seq puts the handle in that message", async (t) => {
  const f = rig();
  t.after(f.cleanup);
  const line = f.chats.postAgentMessage(f.chat.id, 'ag_ava', 'run_1', { body: `Found the Stripe key ${SK} on the page.`, state: 'final' });
  const ctx = { agent: { id: 'ag_ava', name: 'Ava' }, runId: 'run_1', mode: 'general', services: f.services, signal: new AbortController().signal, status() {}, conversationId: f.chat.id } as unknown as ToolContext;
  const save = secretTools.find((entry) => entry.name === 'secrets.save')!;
  const out = JSON.stringify(await save.run({ name: 'Stripe key', description: 'Stripe API', value: SK, seq: line.seq }, ctx));
  assert.match(out, new RegExp(`Message #${line.seq} shows the handle now`));
  const id = f.vault.list()[0].id;
  assert.equal(f.chats.message(line.id)!.body, `Found the Stripe key secret://${id} on the page.`);
  const again = JSON.stringify(await save.run({ name: 'Stripe key', description: 'Stripe API', value: SK, seq: 999 }, ctx));
  assert.match(again, /already stored/);
  assert.match(again, /No message #999/);
});

test('Stripe secret and restricted keys are keys (a publishable pk_ key is public)', async (t) => {
  assert.deepEqual(findKeys(`Stripe secret: ${STRIPE} and ${RESTRICTED} but ${PUBLISHABLE}`).map((key) => [key.value, key.name]), [
    [STRIPE, 'Stripe key'], [RESTRICTED, 'Stripe key'],
  ]);
  const f = rig();
  t.after(f.cleanup);
  const message = await f.send(`Stripe secret: ${STRIPE}`, 'req_stripe');
  assert.equal(message.body, `Stripe secret: secret://${f.vault.list()[0]?.id}`);
  assert.equal(f.vault.list()[0].kind, 'api_key');
});

test('Bearer/Basic prose, paths and slugs are no key in chat; the feedback redactor keeps its broad rule', () => {
  for (const prose of [
    'see the basic example.com/api/v2/items page', 'docker image rk-api-deployment-7d9f8b6c5', 'branch pk-2024-annual-report-final',
    'Basic version-2.3.4-release', 'the Bearer\nREADME2024.final.md.backup',
  ]) assert.deepEqual(findKeys(prose), [], prose);
  assert.deepEqual(findKeys('Authorization: Bearer abcd1234efgh5678ijkl9012 and Basic dXNlcjpwYXNzd29yZDEyMw==').map((key) => key.value),
    ['abcd1234efgh5678ijkl9012', 'dXNlcjpwYXNzd29yZDEyMw=='], 'a credential after Bearer or Basic on its line');
  assert.equal(redactText('see the basic example.com/api/v2/items page'), 'see the basic [token] page', 'reports keep the broad rule');
});

test("saving a key leaves an app's own fence as written (secrets.fromMessage and secrets.save with seq)", async (t) => {
  const f = rig();
  t.after(f.cleanup);
  const fence = `\`\`\`app title="Map"\n<script src="https://maps.example/js?key=${AIZA}"></script>\n\`\`\``;
  const line = f.chats.postAgentMessage(f.chat.id, 'ag_ava', 'run_1', { body: `Map:\n${fence}\nI used your key ${AIZA} above.`, state: 'final' });
  const { ids } = await f.server.call('secrets.fromMessage', { messageId: line.id }, OWNER) as { ids: string[] };
  assert.equal(f.chats.message(line.id)!.body, `Map:\n${fence}\nI used your key secret://${ids[0]} above.`, 'the app keeps its key');
  assert.equal(f.vault.list()[0].label, 'I used your key', 'named from the words outside the app');
  const other = f.chats.postAgentMessage(f.chat.id, 'ag_ava', 'run_2', { body: `${fence}\nand ${AIZA}`, state: 'final' });
  const ctx = { agent: { id: 'ag_ava', name: 'Ava' }, runId: 'run_2', mode: 'general', services: f.services, signal: new AbortController().signal, status() {}, conversationId: f.chat.id } as unknown as ToolContext;
  await secretTools.find((entry) => entry.name === 'secrets.save')!.run({ name: 'Maps key', description: 'Maps', value: AIZA, seq: other.seq }, ctx);
  assert.equal(f.chats.message(other.id)!.body, `${fence}\nand secret://${ids[0]}`, "secrets.save with seq leaves the app's key too");
});

test('a marked piece of a handle is refused: the handle stays whole and nothing is stored', async (t) => {
  const f = rig();
  t.after(f.cleanup);
  const mine = await f.send(`OpenAI key: ${SK}`, 'req_h');
  const handle = /secret:\/\/(\S+)/.exec(mine.body)![1];
  for (const value of [handle, handle.slice(0, 10), `secret://${handle}`]) {
    await assert.rejects(f.server.call('secrets.fromMessage', { messageId: mine.id, value }, OWNER), /handle/, value);
  }
  assert.equal(f.chats.message(mine.id)!.body, mine.body);
  assert.equal(f.vault.list().length, 1);
});

test('an edit the handler refuses stores no key (a phone or the PC on an agent\'s message)', async (t) => {
  const f = rig();
  t.after(f.cleanup);
  const line = f.chats.postAgentMessage(f.chat.id, 'ag_ava', 'run_3', { body: 'plain words', state: 'final' });
  await assert.rejects(f.server.call('messages.edit', { id: line.id, body: `x ${GH}` }, PHONE(false)), /Only your own messages/);
  await assert.rejects(f.server.call('messages.edit', { id: line.id, body: `x ${GH}` }, OWNER), /Only your own messages/);
  assert.equal(f.vault.list().length, 0);
});
