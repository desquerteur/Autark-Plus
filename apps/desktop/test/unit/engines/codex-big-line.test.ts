// 18.11.2026 (live, a maintainer's PC, task_1sgy01ys): Codex made three images for the plan-image call (PNG 1536x1024, 3.4 MB each) and
// every call failed with "The Codex connection closed.": the app-server sends a generated image as ONE line of base64 (4.5 MB),
// readJsonLines closed every connection at a line over 4 MB ("line_too_long"), and the closed connection's app-server kept
// running (server.ts only forgot its lease) – four of them, and a thread delete on the new one found "already has an active writer".
// Now: the Codex connection takes a line up to CODEX_LINE_MAX, a longer one still closes it, and a closed connection ends its process.
// Owns: these assertions only. Never: a real Codex (scripted app-server over fakes.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { CodexEngine } from '../../../src/runtime/engines/codex/engine.ts';
import { CodexServer } from '../../../src/runtime/engines/codex/server.ts';
import { CODEX_LINE_MAX, readJsonLines } from '../../../src/runtime/engines/shared.ts';
import { FakeChild, account, fakeFinder, fakeSpawn, testSupervisor, tick, turnInput } from './fakes.ts';

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 600 && !done(); i++) await tick();
}

const MB = 1024 * 1024;
/** A base64-looking payload of about `bytes` characters (a PNG's base64). */
const payload = (bytes: number) => 'iVBORw0KGgo'.padEnd(bytes, 'A');

test('readJsonLines: a 6 MB line in 64 KB chunks ends the stream at the default limit and passes at the Codex limit', async () => {
  const line = `${JSON.stringify({ method: 'item/completed', params: { result: payload(6 * MB) } })}\n`;
  for (const [limit, expectBad] of [[undefined, true], [CODEX_LINE_MAX, false]] as const) {
    const stream = new PassThrough();
    const messages: unknown[] = [];
    const bad: string[] = [];
    readJsonLines(stream, (m) => messages.push(m), (r) => bad.push(r), limit);
    for (let at = 0; at < line.length; at += 64 * 1024) stream.write(line.slice(at, at + 64 * 1024));
    await tick();
    assert.equal(bad.length > 0, expectBad, `limit ${limit ?? 'default'}`);
    assert.equal(messages.length, expectBad ? 0 : 1, `limit ${limit ?? 'default'}: the message`);
  }
});

test('readJsonLines: a line over the Codex limit still ends the stream, and lines around a long one stay in order', async () => {
  const stream = new PassThrough();
  const seen: unknown[] = [];
  const bad: string[] = [];
  readJsonLines(stream, (m) => seen.push((m as { n: number }).n), (r) => bad.push(r), 2 * MB);
  stream.write(`${JSON.stringify({ n: 1 })}\n${JSON.stringify({ n: 2, x: payload(MB) })}\n${JSON.stringify({ n: 3 })}\n{"n":4,"x":"`);
  await tick();
  assert.deepEqual(seen, [1, 2, 3]);
  for (let i = 0; i < 3; i++) stream.write(payload(MB));
  await tick();
  assert.deepEqual(bad, ['line_too_long']);
});

/** A scripted app-server whose image turn ends with ONE line holding a 4.5 MB image (the original case). */
function imageServer(imageChars: number) {
  const children: FakeChild[] = [];
  const { spawn, calls } = fakeSpawn(({ child }) => {
    children.push(child);
    child.onLine = (msg) => {
      if (!msg.method) return;
      if (msg.method === 'initialize') child.send({ id: msg.id, result: { userAgent: 'fake' } });
      else if (msg.method === 'thread/start') child.send({ id: msg.id, result: { thread: { id: 'thr_img' } } });
      else if (msg.method === 'turn/start') {
        child.send({ id: msg.id, result: { turn: { id: 'turn_1', status: 'inProgress' } } });
        const params = { threadId: 'thr_img', turnId: 'turn_1' };
        const line = `${JSON.stringify({ method: 'item/completed', params: { ...params, item: { id: 'img_1', type: 'imageGeneration', status: 'completed', result: payload(imageChars) } } })}\n`;
        for (let at = 0; at < line.length; at += 64 * 1024) child.stdout.write(line.slice(at, at + 64 * 1024)); // a pipe delivers 64 KB at a time
        child.send({ method: 'turn/completed', params: { threadId: 'thr_img', turn: { id: 'turn_1', status: 'completed' } } });
      } else child.send({ id: msg.id, result: {} });
    };
  });
  return { spawn, calls, children };
}

test('an image turn whose result is one 4.5 MB line is done with the image, not "The Codex connection closed."', async () => {
  const fake = imageServer(Math.ceil(3.4 * MB * 4 / 3));
  const engine = new CodexEngine({ supervisor: testSupervisor(fake.spawn), finder: fakeFinder({ codex: '/bin/codex' }), cwd: '/tmp', version: '0.2.0', realpath: async (dir) => dir });
  const result = await engine.run({ ...turnInput().input, nativeTools: 'image', tools: [] });
  assert.equal(result.stop, 'done', result.error?.message);
  assert.equal(result.files?.length, 1);
  assert.ok((result.files?.[0].dataBase64?.length ?? 0) > 4 * MB, 'the image came through whole');
  assert.equal(fake.calls.length, 1, 'one app-server');
  await engine.dispose();
});

test('a closed connection ends its app-server, logs why, and the next call starts exactly one new one', async () => {
  const fake = imageServer(8);
  const warned: Array<[string, Record<string, unknown>]> = [];
  const server = new CodexServer({
    key: 'acc_test', executable: { command: '/bin/codex', prefixArgs: [], path: '/bin/codex' } as never, supervisor: testSupervisor(fake.spawn),
    cwd: '/tmp', version: '0.2.0', log: (message, data) => warned.push([message, data]),
  });
  const rpc = await server.rpc();
  const first = fake.children[0];
  // the app-server sends a line over every limit: the connection breaks
  first.stdout.write(`{"method":"x","params":{"d":"${payload(CODEX_LINE_MAX + MB)}`);
  await until(() => rpc.isClosed);
  assert.ok(rpc.isClosed, 'the connection closed');
  await until(() => first.killed || first.exitCode !== null);
  assert.ok(first.killed || first.exitCode !== null, 'its app-server was ended with it');
  assert.equal(warned.length, 1);
  assert.equal(warned[0][0], 'codex connection closed');
  assert.match(String(warned[0][1].reason), /line_too_long/);
  const again = await server.rpc();
  assert.equal(again.isClosed, false);
  assert.equal(fake.calls.length, 2, 'a new app-server, not one more beside the old one');
  await server.dispose();
  assert.ok(account().id);
});

test('a plan image call removes its thread\'s saved images with the thread (thread/delete leaves them); a path-like ref is never followed', async () => {
  const { mkdirSync, mkdtempSync, existsSync, writeFileSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { codexImage } = await import('../../../src/runtime/media/codex-image.ts');
  const home = mkdtempSync(path.join(os.tmpdir(), 'wf-codex-image-home-'));
  const uuid = '01a1eddc-cebd-79f2-b42c-157159e35cc9';
  mkdirSync(path.join(home, 'generated_images', uuid), { recursive: true });
  writeFileSync(path.join(home, 'generated_images', uuid, 'exec-1.png'), 'x');
  mkdirSync(path.join(home, 'generated_images', 'keep'), { recursive: true });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString('base64');
  let ref = uuid;
  const deleted: string[] = [];
  const engine = {
    run: async () => ({ text: '', stop: 'done', files: [{ name: 'i.png', dataBase64: png }], session: { ref } }),
    deleteSession: async (_a: unknown, r: string) => { deleted.push(r); return 'deleted'; },
  };
  const model = { id: 'codex:gpt-6-luna', engine: 'codex', model: 'gpt-6-luna', available: true, accounts: [], tier: 'low', relCost: 1 };
  const services = { accounts: {}, catalog: { list: () => [model] }, engines: { get: () => engine }, paths: { temp: home }, log: { warn() {}, info() {}, debug() {}, error() {} } } as never;
  try {
    const acct = { ...account(), home };
    await codexImage(services, acct, { prompt: 'x' });
    assert.deepEqual(deleted, [uuid]);
    assert.equal(existsSync(path.join(home, 'generated_images', uuid)), false, 'the thread\'s images are gone');
    assert.equal(existsSync(path.join(home, 'generated_images', 'keep')), true, 'other folders stay');
    ref = '../keep';
    await codexImage(services, acct, { prompt: 'x' });
    assert.equal(existsSync(path.join(home, 'generated_images', 'keep')), true, 'a path-like ref is not followed');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
