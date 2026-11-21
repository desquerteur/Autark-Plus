// Owns: real mail-action/SMTP checkpoints with a changing local contact list and memory-only socket.
// Never: opens a network connection, uses real mail/accounts, or changes the production connector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMailTool, type MailContext } from '../../../src/runtime/apps/mail/actions.ts';

class MemorySmtp extends Duplex {
  connecting = false;
  localAddress = '127.0.0.1';
  commands: string[] = [];
  body = '';
  private data = false;
  private beforeReply: (command: string) => void;
  constructor(beforeReply: (command: string) => void) { super(); this.beforeReply = beforeReply; this.push('220 fixture\r\n'); }
  override _read(): void {}
  override _write(chunk: Buffer, _encoding: string, done: (error?: Error | null) => void): void {
    const value = chunk.toString();
    if (this.data) {
      this.body += value;
      if (this.body.endsWith('\r\n.\r\n')) { this.data = false; this.push('250 accepted\r\n'); }
    } else {
      const line = value.trim();
      this.commands.push(line.startsWith('AUTH') ? 'AUTH <fixture>' : line);
      queueMicrotask(() => {
        this.beforeReply(line);
        if (line.startsWith('EHLO')) this.push('250-fixture\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH')) this.push('235 authenticated\r\n');
        else if (line === 'DATA') { this.data = true; this.push('354 continue\r\n'); }
        else this.push(line === 'QUIT' ? '221 bye\r\n' : '250 ok\r\n');
      });
    }
    done();
  }
}

async function scenario(stage: 'RCPT' | 'DATA', recipientField: 'to' | 'cc' | 'bcc', stop: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), 'contact-race-'));
  const file = path.join(dir, 'dnc.json');
  const blocked = 'one@student.university.invalid';
  const allowed = 'other@student.university.invalid';
  const set = (addresses: string[]) => writeFileSync(file, JSON.stringify([{ status: 'DNC', addresses }]));
  set([]);
  let updated = false, sentCopies = 0, generationChecks = 0;
  const smtp = new MemorySmtp((command) => {
    if (!updated && (stage === 'RCPT' ? command.startsWith('RCPT') : command === 'DATA')) {
      updated = true; set([blocked]);
    }
  });
  const ctx = {
    target: { address: 'owner@example.invalid', contactStopFile: file,
      assertCurrent: () => { generationChecks++; },
      smtp: { host: 'fixture.invalid', port: 465, tls: 'implicit' },
      login: async () => ({ user: 'fixture', password: 'synthetic' }) },
    mailbox: { special: async () => ({ name: 'Sent' }), append: async () => { sentCopies++; } },
    sockets: { tls: () => smtp as unknown as Socket }, timeoutMs: 1000,
  } as unknown as MailContext;
  try {
    const destination = stop ? blocked : allowed;
    const result = await runMailTool(ctx, 'send', {
      to: recipientField === 'to' ? destination : 'safe@example.invalid',
      ...(recipientField === 'to' ? {} : { [recipientField]: destination }), text: 'Synthetic body',
    });
    assert.equal(updated, true);
    assert.ok(generationChecks >= 4, 'generation guard remains active alongside stop checks');
    if (stop) {
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /explicit contact stop/);
      assert.equal(smtp.body, '', 'no body or final dot is handed to SMTP');
      assert.equal(sentCopies, 0);
      assert.equal(smtp.commands.includes('DATA'), stage === 'DATA');
    } else {
      assert.notEqual(result.isError, true);
      assert.match(smtp.body, /Synthetic body/);
      assert.equal(sentCopies, 1, 'exact-address stop does not block university siblings');
    }
  } finally { smtp.destroy(); rmSync(dir, { recursive: true }); }
}

for (const stage of ['RCPT', 'DATA'] as const) {
  for (const field of ['to', 'cc', 'bcc'] as const) {
    test(`new contact stop during ${stage} wait blocks ${field} before body, memory-only`, () => scenario(stage, field, true));
  }
  test(`new exact-address stop during ${stage} still permits university sibling`, () => scenario(stage, 'to', false));
}
