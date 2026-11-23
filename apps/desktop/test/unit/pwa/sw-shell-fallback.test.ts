// B-084 (src/ui/pwa/sw.ts networkFirstShell): a page load that gets a 5xx – the Android app's local entrance answers
// 503 while its link to the PC is down – boots the cached index.html (which reconnects by itself) instead of the error,
// so the native "Can't reach" screen comes only when nothing is cached; an ok page is served and kept; without a
// cached page the 5xx stays as it is. Bundled and run in node:vm like sw.test.ts.
// Owns: these assertions only. Never: a real browser, service worker or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORIGIN = 'http://127.0.0.1:47920';
const code = buildSync({ entryPoints: [path.join(root, 'src/ui/pwa/sw.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;

/** A worker whose network answers `status`; `cachedShell` says whether index.html is in the cache. */
function worker(status: number, cachedShell: boolean) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const kept: string[] = [];
  const caches = {
    open: async () => ({ put: async (key: string) => { kept.push(key); }, match: async () => undefined, add: async () => undefined }),
    match: async (key: string) => (cachedShell && key === '/index.html' ? new Response('cached shell', { status: 200 }) : undefined),
    keys: async () => [],
    delete: async () => true,
  };
  const scope = {
    registration: { showNotification: async () => undefined },
    clients: { matchAll: async () => [], openWindow: async () => undefined, claim: async () => undefined },
    skipWaiting: async () => undefined,
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => { handlers.set(type, fn); },
  };
  const fetch = async () => new Response(status < 300 ? 'fresh shell' : 'Can\'t reach your PC', { status });
  vm.runInContext(code, vm.createContext({ self: scope, URL, Response, Request, JSON, Promise, console, caches, fetch, indexedDB: undefined }));
  const navigate = async () => {
    let response: Promise<Response> | Response | undefined;
    handlers.get('fetch')!({ request: { method: 'GET', url: `${ORIGIN}/`, mode: 'navigate' }, respondWith: (value: Promise<Response> | Response) => { response = value; } });
    const answer = await response!;
    return { status: answer.status, text: await answer.text() };
  };
  return { navigate, kept };
}

test('a 5xx page load boots the cached shell; an ok one is served and kept; no cache keeps the 5xx', async () => {
  assert.deepEqual(await worker(503, true).navigate(), { status: 200, text: 'cached shell' });
  assert.deepEqual(await worker(502, true).navigate(), { status: 200, text: 'cached shell' });
  const ok = worker(200, true);
  assert.deepEqual(await ok.navigate(), { status: 200, text: 'fresh shell' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(ok.kept, ['/index.html']);
  assert.deepEqual(await worker(503, false).navigate(), { status: 503, text: 'Can\'t reach your PC' });
  assert.deepEqual(await worker(404, true).navigate(), { status: 404, text: 'Can\'t reach your PC' }, 'a 4xx is the page\'s own answer');
});
