// Owner 16.11.2026 ("Wenn eine Mail reinkommt, dann sollt ihr richtig arbeiten können und nicht irgendwie komplett
// gesperrt sein"): a run a mail started calls every tool through the real Registry like any other run – the hub's chat,
// task, knowledge and schedule tools, the shell and files, tools.call – and the mailbox's own tools answer it as they
// answer the person (search, any message, send, a reply with Reply-To and `all`), its sends with Auto-Submitted (B-059).
// What stays: the IDLE identity of a new message comes only from the selected UIDVALIDITY and the FETCH UID.
// Owns: these assertions. Never: contacts a mailbox, provider, socket or vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../../../src/runtime/tools/registry.ts';
import { appToolDefs } from '../../../src/runtime/apps/tools.ts';
import { MAIL_TOOLS } from '../../../src/runtime/apps/mail/tools.ts';
import { AUTO_REPLY_ARG } from '../../../src/runtime/apps/mail/loops.ts';
import { noticedMessageId } from '../../../src/runtime/apps/mail/idle.ts';
import { ctxFor, setup, tool } from './helpers.ts';
import type { AppToolHost, Connector } from '../../../src/runtime/apps/types.ts';

const GEN = '11111111-1111-4111-8111-111111111111';
const id = 'INBOX/77/42';
const origin = { source: 'app:box', label: 'New mail in me@example.invalid', mailProvenance: { appId: 'box', generation: GEN, messageIds: [id] } };

function fixture() {
  const h = setup();
  h.services.apps = { mailGeneration: () => GEN, list: () => [{ id: 'box', transport: 'mail', status: 'ok' }] } as never;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const connector = { id: 'box', name: 'Fixture', transport: 'mail' } as Connector;
  const host = {
    state: () => ({ connector, status: 'connected' }),
    call: async (_app: string, name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { content: [{ type: 'text', text: 'fixture accepted' }] };
    },
  } as unknown as AppToolHost;
  const registry = new Registry({ services: () => h.services });
  for (const def of appToolDefs(connector, MAIL_TOOLS, host)) registry.register(def);
  return { h, registry, ctx: ctxFor(h, { origin }), calls };
}

test('a run a mail started calls every tool, directly and through tools.call', async () => {
  const f = fixture();
  let effects = 0;
  const targets = ['shell.exec', 'files.read', 'browser.open', 'tasks.create', 'chat.send', 'knowledge.find', 'schedules.create'];
  for (const name of targets) f.registry.register(tool(name, 'read', { run: async () => { effects++; return { content: [] }; } }));
  let n = 0;
  for (const name of targets) {
    const direct = await f.registry.call(name, {}, f.ctx, `direct${n}`);
    assert.notEqual(direct.isError, true, `${name}: ${JSON.stringify(direct.content)}`);
    const nested = await f.registry.call('tools.call', { name, args: {} }, f.ctx, `nested${n++}`);
    assert.notEqual(nested.isError, true, `nested ${name}: ${JSON.stringify(nested.content)}`);
  }
  assert.equal(effects, targets.length * 2);
});

test('the mailbox\'s own tools work in that run as for the person: search, another message, send, reply to all', async () => {
  const f = fixture();
  const steps: Array<[string, Record<string, unknown>]> = [
    ['app.box.search', { unread: true }], ['app.box.read', { id: 'INBOX/77/99' }],
    ['app.box.send', { to: 'maria@client.example', subject: 'Offer', text: 'Here it is.' }], ['app.box.reply', { id, text: 'Thank you.', all: true }],
  ];
  for (const [name, args] of steps) {
    const out = await f.registry.call(name, args, f.ctx, name);
    assert.notEqual(out.isError, true, `${name}: ${JSON.stringify(out.content)}`);
  }
  assert.deepEqual(f.calls.map((call) => call.name), ['search', 'read', 'send', 'reply']);
  const reply = f.calls[3].args;
  assert.equal(reply.all, true, 'reply to all stays the agent\'s choice');
  assert.equal(reply[AUTO_REPLY_ARG], true, 'B-059: a send of a run a mail started carries Auto-Submitted');
  assert.deepEqual(Object.keys(reply).filter((key) => key.startsWith('_') && key !== AUTO_REPLY_ARG), [], 'no runtime switch beside it');
});

test('trusted IDLE identity requires selected UIDVALIDITY and FETCH UID; envelope text cannot mint it', () => {
  assert.equal(noticedMessageId(77, new Map([['UID', '42']])), id);
  assert.equal(noticedMessageId(undefined, new Map([['UID', '42']])), undefined);
  assert.equal(noticedMessageId(77, new Map([['ENVELOPE', 'INBOX/77/42']])), undefined);
  for (const uid of ['0', '-1', '42 OR ALL', '1.5']) assert.equal(noticedMessageId(77, new Map([['UID', uid]])), undefined);
});
