// B-082: the runtime's /turn/<name> route (src/runtime/http/static.ts) for a phone's conversation page – the ort files
// next to the app's package.json and the two turn models from <data>/models/speech, by fixed name only; every other
// name, a model not downloaded and any path trick is a 404; the PWA's CSP lets WebAssembly compile and nothing else.
// Owns: these assertions only. Never: onnxruntime or a real model.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { APP_CSP, StaticFiles } from '../../../src/runtime/http/static.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'wf-turn-'));
after(() => rmSync(root, { recursive: true, force: true }));
const ui = path.join(root, 'app', 'ui');
const dist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const data = path.join(root, 'data');
mkdirSync(ui, { recursive: true });
mkdirSync(dist, { recursive: true });
mkdirSync(path.join(data, 'models', 'speech', 'silero-vad'), { recursive: true });
writeFileSync(path.join(ui, 'index.html'), '<!doctype html><title>Workforce</title>');
writeFileSync(path.join(dist, 'ort-wasm-simd-threaded.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
writeFileSync(path.join(dist, 'ort-wasm-simd-threaded.mjs'), 'export default 1');
writeFileSync(path.join(dist, 'ort.node.min.js'), 'not served');
writeFileSync(path.join(data, 'models', 'speech', 'silero-vad', 'silero_vad.onnx'), 'silero');
writeFileSync(path.join(data, 'secret.txt'), 'top secret');

async function serving(files: StaticFiles, run: (get: (p: string) => Promise<Response>) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => { void files.serve(req, res, new URL(req.url ?? '/', 'http://x').pathname); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try { await run((p) => fetch(`http://127.0.0.1:${port}${p}`)); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('/turn/ serves the ort wasm and loader and a downloaded model by fixed name; everything else is a 404', async () => {
  await serving(new StaticFiles(ui, () => data), async (get) => {
    const wasm = await get('/turn/ort-wasm-simd-threaded.wasm');
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal((await wasm.arrayBuffer()).byteLength, 4);
    assert.equal((await get('/turn/ort-wasm-simd-threaded.mjs')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    const silero = await get('/turn/silero_vad.onnx');
    assert.equal(silero.status, 200);
    assert.equal(await silero.text(), 'silero');
    assert.equal((await get('/turn/smart-turn-v3.2-cpu.onnx')).status, 404, 'not downloaded yet');
    for (const p of ['/turn/ort.node.min.js', '/turn/index.html', '/turn/..%2fdata%2fsecret.txt', '/turn/%2e%2e%2f%2e%2e%2fdata%2fsecret.txt', '/turn/', '/turn/silero-vad/silero_vad.onnx']) {
      const response = await get(p);
      assert.equal(response.status, 404, p);
      assert.doesNotMatch(await response.text(), /top secret|Workforce/, p);
    }
  });
});

test('/turn/ without a data folder serves the ort files only; the app CSP allows WebAssembly, not eval', async () => {
  await serving(new StaticFiles(ui), async (get) => {
    assert.equal((await get('/turn/ort-wasm-simd-threaded.wasm')).status, 200);
    assert.equal((await get('/turn/silero_vad.onnx')).status, 404);
  });
  assert.match(APP_CSP, /script-src 'self' 'wasm-unsafe-eval'(;|$)/);
  assert.doesNotMatch(APP_CSP, /'unsafe-eval'/);
});
