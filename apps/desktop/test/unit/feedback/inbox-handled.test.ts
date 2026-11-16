// Owns: feedback 16.11.2026 (owner) – the team marks a report done / not relevant, a marked report goes by itself
// 7 days later (never an unmarked one), and a flood of unopenable letters cannot fill the team's PC.
// Never: contacts Google (fake mailbox).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { FeedbackService } from '../../../src/runtime/feedback/service.ts';
import { RECEIVER_KEY_ID, SERVICE_ACCOUNT_ID, SETUP_KEY, UNREADABLE_DIR, UNREADABLE_KEEP } from '../../../src/runtime/feedback/inbox.ts';
import { generateReceiverKeys, sealReport } from '../../../src/runtime/feedback/seal.ts';
import { FEEDBACK_HANDLED_KEEP_MS, INBOX_DIR } from '../../../src/shared/model/feedback-delivery.ts';
import { register as registerInbox } from '../../../src/runtime/rpc/handlers/feedback-inbox.ts';
import { HandlerTable, type HandlerContext } from '../../../src/runtime/rpc/table.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { API_KEY, PROJECT, fakeMailbox, feedbackEnv, serviceAccount, type Env } from './fakes.ts';

const envs: Env[] = [];
after(() => { for (const env of envs) env.cleanup(); });
const DAY = 24 * 60 * 60 * 1000;
const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

async function team() {
  const env = feedbackEnv();
  envs.push(env);
  const keys = generateReceiverKeys();
  const account = serviceAccount();
  const box = fakeMailbox({ accountKey: account.publicKey });
  await env.vault.save({ id: RECEIVER_KEY_ID, label: 'Feedback team key', kind: 'token', value: keys.privateKey });
  await env.vault.save({ id: SERVICE_ACCOUNT_ID, label: 'Feedback mailbox service account', kind: 'token', value: account.text });
  new KvRepo(env.s.db).set(SETUP_KEY.ns, SETUP_KEY.key, { project: PROJECT, publicKey: keys.publicKey, apiKey: API_KEY }, 1);
  const letter = (docId: string, text: string, key = keys.publicKey) => box.docs.set(docId, sealReport(key, Buffer.from(JSON.stringify({ v: 1, id: docId, text, createdAt: 1, appVersion: '0.3.7', os: 'win32' }))));
  const feedback = new FeedbackService({ services: () => env.s, receiver: null, fetch: box.fetch });
  return { env, box, letter, feedback, dir: path.join(env.data, INBOX_DIR) };
}

test('mark: done / not relevant / cleared; a marked report goes 7 days after its mark, an unmarked one stays', async () => {
  const { env, letter, feedback } = await team();
  for (const n of [1, 2, 3]) letter(id(n), `report ${n}`);
  await feedback.inbox.fetch();
  const marked = feedback.inbox.mark(id(1), 'done');
  assert.deepEqual(marked.handled, { as: 'done', at: env.clock.now() });
  feedback.inbox.mark(id(2), 'irrelevant');
  feedback.inbox.mark(id(2), null);
  assert.equal(feedback.inbox.list().find((item) => item.id === id(2))?.handled, undefined, 'cleared');
  feedback.inbox.mark(id(3), 'irrelevant');
  env.clock.advance(FEEDBACK_HANDLED_KEEP_MS - 1);
  assert.equal(feedback.inbox.list().length, 3, 'not before its time');
  env.clock.advance(1);
  assert.deepEqual(feedback.inbox.list().map((item) => item.id), [id(2)], 'only the unmarked report is left');
  env.clock.advance(365 * DAY);
  assert.deepEqual(feedback.inbox.list().map((item) => item.id), [id(2)], 'an unmarked report never goes by itself');
  assert.equal(FEEDBACK_HANDLED_KEEP_MS, 7 * DAY);
  assert.throws(() => feedback.inbox.mark(id(9), 'done'), /not in the inbox/);
});

test('the RPC: feedback.inboxMark checks its params', async () => {
  const { feedback } = await team();
  const table = new HandlerTable();
  registerInbox(table);
  const ctx = { extras: { feedback } } as unknown as HandlerContext;
  const call = (params: unknown) => Promise.resolve().then(() => table.get('feedback.inboxMark')!.handler(params as never, ctx));
  await assert.rejects(call({ id: id(1), as: 'spam' }), /parameter "as"/);
  await assert.rejects(call({ id: '../x', as: 'done' }), /report id/);
  await assert.rejects(call({ id: id(1), as: 'done', extra: 1 }), /params\.extra/);
  await assert.rejects(call({ id: id(1), as: 'done' }), /not in the inbox/);
});

test('spam guard: up to UNREADABLE_KEEP unopenable letters are kept on the PC and stay in the mailbox; a flood beyond is deleted there', async () => {
  const { box, letter, feedback, dir } = await team();
  const stranger = generateReceiverKeys().publicKey;
  for (let n = 1; n <= UNREADABLE_KEEP + 15; n++) letter(id(n), 'junk', stranger);
  const result = await feedback.inbox.fetch();
  assert.equal(result.unreadable, UNREADABLE_KEEP + 15);
  assert.equal(box.docs.size, UNREADABLE_KEEP, 'the kept ones stay for a team PC with the newer key, the flood beyond is deleted');
  assert.equal(readdirSync(path.join(dir, UNREADABLE_DIR)).length, UNREADABLE_KEEP, 'the PC keeps only a few');
  const reads = box.log.filter((line) => line.startsWith('get')).length;
  await feedback.inbox.fetch();
  assert.equal(box.log.filter((line) => line.startsWith('get')).length, reads, 'the kept copies mark them seen: not read again');
  letter(id(99), 'more junk', stranger);
  await feedback.inbox.fetch();
  assert.equal(readdirSync(path.join(dir, UNREADABLE_DIR)).length, UNREADABLE_KEEP, 'still capped');
  assert.equal(box.docs.has(id(99)), false, 'beyond the cap: deleted in the mailbox');
  // Old kept letters go after their keep time.
  const old = path.join(dir, UNREADABLE_DIR, `${id(1)}.wfb`);
  assert.ok(existsSync(old));
  utimesSync(old, new Date(0), new Date(0));
  feedback.inbox.list();
  assert.equal(existsSync(old), false);
});
