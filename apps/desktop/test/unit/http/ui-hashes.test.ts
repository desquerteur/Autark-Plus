// F29: the PC's list of its UI files (src/runtime/http/static.ts at UI_HASHES_PATH) – every file below the UI folder,
// nested ones included, dotfiles left out, each with its SHA-256; a changed file is listed with its new hash at once –
// and the iPhone web app's check against it (src/ui/hosted/ui-hashes.ts): the list the shell keeps from the PC's answer
// passes the PC's real bytes and refuses a tampered file; a body without a list is not kept.
// Owns: these assertions only. Never: a real UI build, a tunnel or a browser.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { StaticFiles } from '../../../src/runtime/http/static.ts';
import { UI_HASHES_PATH, uiHashesOf } from '../../../src/shared/model/ui-hashes.ts';
import { hashesKey, keepUiHashes, keptUiHashes, UiHashCheck, type CacheStore } from '../../../src/ui/hosted/ui-hashes.ts';

const ui = mkdtempSync(path.join(os.tmpdir(), 'wf-ui-hashes-'));
after(() => rmSync(ui, { recursive: true, force: true }));
mkdirSync(path.join(ui, 'chunks'));
mkdirSync(path.join(ui, 'sandbox'));
writeFileSync(path.join(ui, 'index.html'), '<!doctype html><meta name="autark-hosted" content="1">');
writeFileSync(path.join(ui, 'main.js'), 'import "./chunks/a-ABCD1234.js"');
writeFileSync(path.join(ui, 'chunks', 'a-ABCD1234.js'), 'export const a = 1');
writeFileSync(path.join(ui, 'sandbox', 'wf.js'), 'window.wf = {}');
writeFileSync(path.join(ui, '.secret'), 'never listed');

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const SCOPE = 'https://app.example/app/';

async function serving(run: (get: (p: string, method?: string) => Promise<Response>) => Promise<void>): Promise<void> {
  const files = new StaticFiles(ui);
  const server = createServer((req, res) => { void files.serve(req, res, new URL(req.url ?? '/', 'http://x').pathname); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try { await run((p, method = 'GET') => fetch(`http://127.0.0.1:${port}${p}`, { method })); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function memoryCaches(): CacheStore & { data: Map<string, Response> } {
  const data = new Map<string, Response>();
  return { data, open: async () => ({ match: async (key: string) => data.get(key)?.clone(), put: async (key: string, response: Response) => { data.set(key, response); } }) };
}

test('the PC lists the SHA-256 of every file of its UI folder, nested ones included, no dotfiles; a changed file at once', async () => {
  await serving(async (get) => {
    const answer = await get(UI_HASHES_PATH);
    assert.equal(answer.status, 200);
    assert.match(answer.headers.get('content-type') ?? '', /application\/json/);
    const { files } = await answer.json() as { files: Record<string, string> };
    assert.deepEqual(Object.keys(files).sort(), ['chunks/a-ABCD1234.js', 'index.html', 'main.js', 'sandbox/wf.js']);
    assert.equal(files['main.js'], sha('import "./chunks/a-ABCD1234.js"'));
    assert.equal(files['chunks/a-ABCD1234.js'], sha('export const a = 1'));
    writeFileSync(path.join(ui, 'main.js'), 'import "./chunks/b-EFGH5678.js"; // the next version');
    utimesSync(path.join(ui, 'main.js'), new Date(), new Date(Date.now() + 5_000));
    const next = (await (await get(UI_HASHES_PATH)).json() as { files: Record<string, string> }).files;
    assert.equal(next['main.js'], sha('import "./chunks/b-EFGH5678.js"; // the next version'), 'an update of the UI folder is listed with its new hash');
    assert.equal((await get(UI_HASHES_PATH, 'HEAD')).status, 200);
    assert.equal((await get(UI_HASHES_PATH, 'POST')).status, 405);
  });
});

test('the iPhone keeps the PC’s list and passes the PC’s real bytes; a tampered file is refused', async () => {
  await serving(async (get) => {
    const store = memoryCaches();
    assert.equal(await keptUiHashes(store, SCOPE), false);
    assert.equal(await keepUiHashes(store, SCOPE, new Uint8Array(await (await get(UI_HASHES_PATH)).arrayBuffer())), true);
    assert.ok(store.data.has(hashesKey(SCOPE)));
    assert.equal(hashesKey(SCOPE), 'https://app.example/app/ui-hashes.json');
    assert.equal(await keptUiHashes(store, SCOPE), true);
    let asked = 0;
    const check = new UiHashCheck(store, SCOPE, async () => { asked++; return get(UI_HASHES_PATH); });
    assert.equal(await check.held('chunks/a-ABCD1234.js'), true);
    assert.equal(await check.held('evil.js'), false);
    const real = await check.own('chunks/a-ABCD1234.js', await get('/chunks/a-ABCD1234.js'));
    assert.equal(await real?.text(), 'export const a = 1', 'the page gets exactly the bytes checked');
    assert.equal(asked, 0, 'a file that matches needs no round trip');
    assert.equal(await check.own('chunks/a-ABCD1234.js', new Response('steal(localStorage)')), undefined);
    assert.equal(asked, 1, 'the PC was asked for its list before the no');
    assert.equal(await check.own('main.js', new Response('not found', { status: 404 })).then((r) => r?.status), 404, 'an answer that is not ok runs nothing and passes');
    assert.equal(await check.listed('sandbox/wf.js'), true);
    assert.equal(await check.listed('evil.js'), false);
  });
});

test('a body without a list is not kept; rows that are no relative path with a hex hash are left out', async () => {
  const store = memoryCaches();
  assert.equal(await keepUiHashes(store, SCOPE, new TextEncoder().encode('<!doctype html>')), false);
  assert.equal(await keepUiHashes(store, SCOPE, new TextEncoder().encode('{"files":{}}')), false);
  assert.equal(store.data.size, 0);
  const good = sha('x');
  assert.deepEqual([...(uiHashesOf({ files: { 'a.js': good, '/b.js': good, 'c\\d.js': good, 'e.js': 'ABC', 'f.js': good.toUpperCase() } }) ?? [])], [['a.js', good]]);
  assert.equal(uiHashesOf({ files: ['a.js'] }), undefined);
  assert.equal(uiHashesOf(null), undefined);
});
