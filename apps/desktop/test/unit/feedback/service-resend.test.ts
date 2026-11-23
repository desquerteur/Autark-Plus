// Feedback 16.11.2026 (owner: "dass das Feedback verloren geht … wäre sehr schlecht"): a person's report whose sealed
// letter is still to go is sent again by itself – at start, after a send that went through, once RESEND_AFTER_MS after a
// send that found no connection – never a refused letter or an agent's report. feedback.create: the device's clientId
// returns the stored report, `client`/`clientDiagnostics` bounded and redacted, the company's folder from the runtime,
// no kind for a person; recordings sealed all or none within FEEDBACK_SEALED_LIMIT (the text always goes), kept from
// the blob clean-up.
// Owns: these assertions. Never: contacts Firebase (fake mailbox), waits for real timers.

import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { RESEND_AFTER_MS, START_FETCH_DELAY_MS, FeedbackService, companySlot } from '../../../src/runtime/feedback/service.ts';
import { OUTBOX, type FeedbackPayload, type OutboxEntry } from '../../../src/runtime/feedback/delivery.ts';
import { generateReceiverKeys, openReport } from '../../../src/runtime/feedback/seal.ts';
import { register as registerApp } from '../../../src/runtime/rpc/handlers/app.ts';
import { HandlerTable, type HandlerContext } from '../../../src/runtime/rpc/table.ts';
import { isReferenced } from '../../../src/runtime/files/references.ts';
import { FeedbackRepo } from '../../../src/runtime/store/feedback.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { AUDIO_DROPPED, FEEDBACK_SEALED_LIMIT } from '../../../src/shared/model/feedback-delivery.ts';
import type { FeedbackReport } from '../../../src/shared/model/system.ts';
import { API_KEY, PROJECT, fakeMailbox, feedbackEnv, type Env } from './fakes.ts';

const envs: Env[] = [];
after(() => { for (const env of envs) env.cleanup(); });
const TAKE = 'c'.repeat(64);
const WEBM = (size: number) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size - 4, 7)]);

function setup() {
  const env = feedbackEnv();
  envs.push(env);
  const team = generateReceiverKeys();
  const receiver = { publicKey: team.publicKey, project: PROJECT, apiKey: API_KEY };
  const box = fakeMailbox();
  const feedback = new FeedbackService({ services: () => env.s, receiver, fetch: box.fetch, os: 'win32 10.0.26300 x64' });
  const opened = (id: string): FeedbackPayload => JSON.parse(openReport(team.privateKey, box.docs.get(id)!).toString('utf8'));
  const status = (id: string) => new FeedbackRepo(env.s.db).get(id)?.status;
  const creates = () => box.calls.filter((call) => call.method === 'POST').length;
  return { env, box, feedback, opened, status, creates, receiver };
}

test('a report that found no connection goes by itself at the next start; a refused one and an agent\'s never do', async (t) => {
  const { env, box, feedback, status, creates, receiver } = setup();
  box.state.create = 'throw';
  const pending = feedback.create({ text: 'Written offline', author: 'human' });
  await assert.rejects(feedback.send(pending.id), /could not be sent right now/);
  const agent = feedback.create({ kind: 'bug', text: 'An agent saw this', author: 'ag_1' });
  await assert.rejects(feedback.send(agent.id), /could not be sent/);
  box.state.create = 403;
  const refused = feedback.create({ text: 'The mailbox refuses this', author: 'human' });
  await assert.rejects(feedback.send(refused.id), /refused this report/);
  assert.equal(new KvRepo(env.s.db).get<OutboxEntry>(OUTBOX, refused.id)?.refused, true);
  box.state.create = null;
  const before = creates();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restarted = new FeedbackService({ services: () => env.s, receiver, fetch: box.fetch }); // like after a restart
  restarted.start();
  t.mock.timers.tick(START_FETCH_DELAY_MS);
  assert.equal(await restarted.resendPending(), 1);
  assert.equal(status(pending.id), 'sent');
  assert.equal(status(agent.id), 'local', 'an agent\'s report waits for the person');
  assert.equal(status(refused.id), 'local', 'a refused letter waits for the person');
  assert.equal(creates() - before, 1);
  const again = await restarted.send(refused.id); // the person's Send still tries it
  assert.equal(again.status, 'sent');
  assert.equal(new KvRepo(env.s.db).get<OutboxEntry>(OUTBOX, refused.id)?.refused, undefined);
});

test('after a send that found no connection one timer tries again RESEND_AFTER_MS later; a send that goes through sends the rest', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { box, feedback, status } = setup();
  box.state.create = 'throw';
  const first = feedback.create({ text: 'First', author: 'human' });
  const second = feedback.create({ text: 'Second', author: 'human' });
  await assert.rejects(feedback.send(first.id));
  await assert.rejects(feedback.send(second.id));
  box.state.create = null;
  t.mock.timers.tick(RESEND_AFTER_MS - 1);
  assert.equal(status(first.id), 'local', 'not before its time');
  t.mock.timers.tick(1);
  assert.equal(await feedback.resendPending(), 2, 'both went in one pass');
  assert.deepEqual([status(first.id), status(second.id)], ['sent', 'sent']);
  box.state.create = 'throw';
  const third = feedback.create({ text: 'Third', author: 'human' });
  await assert.rejects(feedback.send(third.id));
  box.state.create = null;
  const fourth = feedback.create({ text: 'Fourth', author: 'human' });
  await feedback.send(fourth.id); // the way out works again
  await feedback.resendPending();
  assert.equal(status(third.id), 'sent', 'the waiting report went along without waiting for the timer');
  const posts = box.calls.filter((call) => call.method === 'POST').length;
  t.mock.timers.tick(RESEND_AFTER_MS);
  await feedback.resendPending();
  assert.equal(box.calls.filter((call) => call.method === 'POST').length, posts, 'nothing waits: no further try');
});

test('feedback.create: a person needs no kind; the same clientId returns the stored report; client facts bounded and redacted; the company folder', async () => {
  const { env, feedback, opened } = setup();
  const app = env.s.host.app as { companies?: { first: string; dir: string } };
  app.companies = { first: env.data, dir: path.join(env.data, '..', 'Autark Companies') };
  const report = feedback.create({
    text: 'Phone report', clientId: 'fbc_1m7abc', author: 'human',
    client: `Android app 0.3.15 ·\n Android 16 · SM-S918B · key sk-proj-AbCdEfGhIjKlMnOpQrStUv123 ${'x'.repeat(600)}`,
    clientDiagnostics: `java.lang.IllegalStateException at C:\\Users\\alex\\x\n${'y'.repeat(20_000)}`,
  });
  assert.equal(report.kind, undefined);
  assert.equal(report.context.client!.length, 400);
  assert.match(report.context.client!, /^Android app 0\.3\.15 · Android 16 · SM-S918B · key /);
  assert.equal(report.context.client!.includes('sk-proj-AbCd'), false);
  assert.equal(report.context.clientDiagnostics!.length, 12_000);
  assert.equal(report.context.clientDiagnostics!.includes('alex'), false);
  assert.equal(report.context.company, 'first');
  assert.equal(feedback.create({ text: 'Phone report again', clientId: 'fbc_1m7abc', author: 'human' }).id, report.id, 'the device\'s retry after a lost answer');
  assert.equal(feedback.list().length, 1);
  const stored = new FeedbackRepo(env.s.db).get(report.id)!;
  assert.equal(stored.kind, undefined, 'stored without a kind');
  assert.equal(stored.context.clientId, 'fbc_1m7abc');
  const payload = opened((await feedback.send(report.id)).receiptId!);
  assert.equal(payload.kind, undefined, 'the letter claims no kind');
  assert.equal(payload.client, report.context.client);
  assert.equal(payload.company, 'first');
  assert.match(payload.clientDiagnostics!, /^java\.lang\.IllegalStateException/);
  assert.equal(payload.dictated, undefined);
  assert.throws(() => feedback.create({ text: 'An agent must say what it is', author: 'ag_1' }), /Choose bug, idea, change or praise/);
  const agent = feedback.create({ kind: 'idea', text: 'Agent idea', author: 'ag_1', clientId: 'fbc_1m7abc', client: 'ignored' });
  assert.notEqual(agent.id, report.id, 'a clientId is a person\'s');
  assert.equal(agent.context.client, undefined);
  assert.equal(companySlot({ host: { app: { companies: { first: '/d/Autark', dir: '/d/Autark Companies' } } }, paths: { data: '/d/Autark Companies/company-2' } } as never), 'company-2');
  assert.equal(companySlot({ host: { app: {} }, paths: { data: '/d/x' } } as never), undefined, 'no companies (headless, tests): left out');
});

test('recordings are sealed with the report and kept from the clean-up; too long, the letter goes without them and says so', async () => {
  const { env, feedback, opened } = setup();
  env.addFile(TAKE, 'video/webm', WEBM(2_000)); // the store names WebM by its magic bytes
  const spoken = feedback.create({ text: 'Spoken', audioFileIds: [TAKE, TAKE], screenshotFileId: env.shot.id, author: 'human' });
  assert.deepEqual(spoken.audioFileIds, [TAKE]);
  assert.equal(isReferenced(env.s.db, TAKE), true, 'the blob clean-up leaves a report\'s recording');
  const sent = await feedback.send(spoken.id);
  const payload = opened(sent.receiptId!);
  assert.deepEqual(payload.audio, [{ mime: 'audio/webm', base64: WEBM(2_000).toString('base64') }]);
  assert.equal(payload.dictated, true);
  assert.equal(sent.deliveryWarning, undefined);
  const LONG = 'd'.repeat(64);
  env.addFile(LONG, 'audio/webm', WEBM(800_000));
  const long = feedback.create({ text: 'Spoken for minutes', audioFileIds: [LONG], screenshotFileId: env.shot.id, author: 'human' });
  const without = await feedback.send(long.id);
  const letter = opened(without.receiptId!);
  assert.equal(letter.audio, undefined);
  assert.equal(letter.dictated, true, 'the team still reads it as dictated');
  assert.equal(letter.text, 'Spoken for minutes');
  assert.ok(letter.screenshot, 'the screenshot still goes');
  assert.equal(without.deliveryWarning, AUDIO_DROPPED);
  assert.equal(new FeedbackRepo(env.s.db).get(long.id)?.deliveryWarning, AUDIO_DROPPED);
  assert.ok(FEEDBACK_SEALED_LIMIT < 800_000 * 4 / 3);
  env.addFile('e'.repeat(64), 'image/png', Buffer.from([0x89, 0x50]));
  assert.throws(() => feedback.create({ text: 'x', audioFileIds: ['e'.repeat(64)], author: 'human' }), /WebM or MP4/);
  assert.throws(() => feedback.create({ text: 'x', audioFileIds: ['f'.repeat(64)], author: 'human' }), /recording was not found/);
});

test('RPC feedback.create: kind optional, the new params checked and passed on as the person\'s', async () => {
  const table = new HandlerTable();
  registerApp(table);
  const seen: unknown[] = [];
  const ctx = { extras: { feedback: { create: (input: unknown) => { seen.push(input); return { id: 'fb_1' } as FeedbackReport; } } } } as unknown as HandlerContext;
  const call = (params: unknown) => Promise.resolve().then(() => table.get('feedback.create')!.handler(params as never, ctx));
  await call({ text: 'No kind', clientId: 'abc-1_2', client: 'Android app', clientDiagnostics: 'trace\nline', audioFileIds: [TAKE] });
  assert.deepEqual(seen[0], {
    kind: undefined, text: 'No kind', screenshotFileId: undefined, annotationFileId: undefined, view: undefined, conversationId: undefined,
    audioFileIds: [TAKE], clientId: 'abc-1_2', client: 'Android app', clientDiagnostics: 'trace\nline', author: 'human',
  });
  await assert.rejects(call({ text: 'x', kind: 'rant' }), /parameter "kind"/);
  await assert.rejects(call({ text: 'x', clientId: 'a b' }), /parameter "clientId"/);
  await assert.rejects(call({ text: 'x', clientId: 'a'.repeat(65) }), /parameter "clientId"/);
  await assert.rejects(call({ text: 'x', audioFileIds: [TAKE, TAKE, TAKE, TAKE, TAKE] }), /parameter "audioFileIds"/);
  await assert.rejects(call({ text: 'x', audioFileIds: ['nope'] }), /parameter "audioFileIds"/);
  await assert.rejects(call({ text: 'x', client: 'c'.repeat(2_000) }), /parameter "client"/);
  await call({ text: 'A long user agent is kept to 400 by the service', client: 'c'.repeat(1_500) });
  assert.equal(seen.length, 2);
});
