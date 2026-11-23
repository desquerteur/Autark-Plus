// B-080 (mail-no-tool-no-ledger, live 06.–08.11.: tools.find "mail IMAP SMTP send" answered chat.send and devices.*):
// a mail query while no app.<id>.send is usable adds the line on where my mail tools come from – in the found answer and
// in "Nothing fits" –, never for other queries or once a mailbox is connected (G1); the mail tools say "email" and Sent,
// so tools.find ranks app.<id>.send first for "send email smtp".
// Owns: these assertions only. Never: real mailboxes, engines or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaTools, rankTools } from '../../../src/runtime/tools/builtin/tools-meta.ts';
import { MAIL_TOOLS } from '../../../src/runtime/apps/mail/index.ts';
import { appToolDefs } from '../../../src/runtime/apps/tools.ts';
import { GENERAL_MODE } from '../../../src/runtime/modes/service.ts';
import type { AppToolHost, Connector } from '../../../src/runtime/apps/types.ts';
import type { ToolContext, ToolOutput, ToolSpec } from '../../../src/runtime/tools/types.ts';

const spec = (name: string, description: string): ToolSpec => ({ name, description, inputSchema: { type: 'object' } });
const PLAIN = [
  spec('chat.send', 'Post a message in a chat or my 1:1 with someone.'),
  spec('devices.send', 'Send a file to a linked PC.'),
  spec('calendar.add', 'Add an event to the calendar.'),
];
const BOX: Connector = { id: 'hello', name: 'hello', transport: 'mail', enabled: true, fingerprint: 'f', mail: { address: 'hello@example.com', password: 'secret://pw' } };
const HOST: AppToolHost = { state: () => ({ connector: BOX, status: 'ok' }), call: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
const MAILBOX = appToolDefs(BOX, MAIL_TOOLS, HOST).map((def) => spec(def.name, def.description));
const HINT = /My mail tools \(app\.<name>\.send, reply, search, read\) come from a mailbox in <data>\/connectors\/mail\.json – address plus password as secret:\/\/<id>, skill connect-apps/;

async function find(query: string, specs: readonly ToolSpec[]): Promise<string> {
  const tool = metaTools.find((item) => item.name === 'tools.find')!;
  const services = { modes: { get: () => GENERAL_MODE }, tools: { specsFor: () => [...specs] }, db: undefined };
  const out: ToolOutput = await tool.run({ query }, { agent: { id: 'ag_nora' }, runId: 'run_1', mode: 'general', services, signal: new AbortController().signal, status() {} } as unknown as ToolContext);
  return String((out.content[0] as { text: string }).text);
}

test('a mail query without a usable mailbox: the line in the found answer and in "Nothing fits"', async () => {
  const found = await find('mail IMAP SMTP send', PLAIN);
  assert.match(found, /^Tools for "mail IMAP SMTP send"/);
  assert.match(found, HINT);
  assert.ok(found.includes('connectors/mail.json') && found.includes('connect-apps'));
  const nothing = await find('IMAP', PLAIN);
  assert.match(nothing, /^Nothing fits "IMAP"/);
  assert.match(nothing, HINT);
  assert.match(await find('E-Mail senden', PLAIN), HINT);
});

test('no line for other work or once app.<id>.send is usable; "send email smtp" ranks the mailbox\'s send first', async () => {
  assert.doesNotMatch(await find('Kalender Termin', PLAIN), HINT);
  assert.doesNotMatch(await find('send a file', PLAIN), HINT);
  const specs = [...MAILBOX, ...PLAIN];
  assert.ok(MAILBOX.some((item) => item.name === 'app.hello.send'));
  assert.doesNotMatch(await find('mail IMAP SMTP send', specs), HINT);
  assert.equal(rankTools(specs, 'send email smtp', 3)[0]?.name, 'app.hello.send');
});

test('the mail tools say email and that Sent is the record of what was sent', () => {
  const described = (name: string) => MAIL_TOOLS.find((tool) => tool.name === name)!.description ?? '';
  for (const name of ['send', 'search']) {
    assert.match(described(name), /email/, name);
    assert.match(described(name), /Sent|"sent"/, name);
  }
  assert.match(described('search'), /^Finds emails in a folder \(default INBOX\), newest first\. "sent" holds every mail sent from this mailbox by any of us/);
  assert.match(described('send'), /^Sends an email from this mailbox over its SMTP server and keeps the copy in Sent, the record of everything sent from here\./);
});
