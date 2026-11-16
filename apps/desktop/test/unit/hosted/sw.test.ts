// The iPhone web app's service worker (src/ui/hosted/sw.ts) in node:vm, bundled with esbuild like the build does: a PC
// path reaches the shell window over a MessagePort and streams back; chunks are cache-first; main.js revalidates with
// its ETag (304 → the copy) and falls back to the copy without a tunnel; no copy and no tunnel → 503; navigations get the
// shell, a sandbox frame goes to the PC; a duplicate push is still shown, quietly; a clear still shows a notice on Apple's
// push service and only closes on any other (B-087: the hosted app in Chrome or Edge); a tap opens the app's scope plus
// the route, never the origin root. F29: with the PC's list kept, a file on it and every script reach the page only with
// the listed bytes – a tampered file or an unlisted script is a 403 and the shell is told, a tampered copy is fetched
// anew, a PC that updated after the start is asked for its list, and data paths pass unchecked.
// Owns: these assertions. Never: a real browser or push service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORIGIN = 'https://site.example';
const SCOPE = `${ORIGIN}/autark/app/`;
const code = buildSync({ entryPoints: [path.join(root, 'src/ui/hosted/sw.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;

/** Values from the vm realm, compared as plain JSON. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

type Handler = (event: Record<string, unknown>) => void;
type Answer = (message: { path: string; headers: Array<[string, string]>; method: string }) => Array<Record<string, unknown>>;

function fakeCaches(seed: Record<string, Response> = {}) {
  const store = new Map<string, Response>(Object.entries(seed));
  const open = async () => ({
    match: async (key: string | { url: string }) => store.get(typeof key === 'string' ? key : key.url)?.clone(),
    put: async (key: string, response: Response) => { store.set(key, response); },
    add: async () => undefined,
  });
  return { store, caches: { open, delete: async () => true, keys: async () => [] } };
}

const APPLE = 'https://web.push.apple.com/QA_iphone';
const FCM = 'https://fcm.googleapis.com/fcm/send/chrome_1';

function worker(options: { answer?: Answer; seed?: Record<string, Response>; open?: Array<{ tag: string; data?: unknown; close(): void }>; endpoint?: string } = {}) {
  const handlers = new Map<string, Handler>();
  const asked: Array<{ path: string; headers: Array<[string, string]>; method: string }> = [];
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const posted: unknown[] = [];
  const shell = {
    id: 'c1', url: `${SCOPE}#/home`, type: 'window', focused: true,
    focus: async () => undefined,
    postMessage: (message: { type?: string; path: string; headers: Array<[string, string]>; method: string }, ports?: Array<{ postMessage(m: unknown): void }>) => {
      if (message?.type !== 'hosted.fetch') { posted.push(message); return; }
      asked.push(message);
      for (const reply of (options.answer ?? (() => [{ t: 'error', offline: true }]))(message)) ports![0].postMessage(reply);
    },
  };
  const { store, caches } = fakeCaches(options.seed);
  const scope = {
    registration: {
      scope: SCOPE,
      showNotification: async (title: string, shownOptions: Record<string, unknown>) => { shown.push({ title, options: shownOptions }); },
      getNotifications: async (filter?: { tag?: string }) => (options.open ?? []).filter((n) => !filter?.tag || n.tag === filter.tag),
      pushManager: { getSubscription: async () => (options.endpoint ? { endpoint: options.endpoint } : null) },
    },
    clients: { get: async (id: string) => (id === 'c1' ? shell : undefined), matchAll: async () => [shell], openWindow: async (url: string) => { opened.push(url); }, claim: async () => undefined },
    skipWaiting: async () => undefined,
    location: new URL(`${SCOPE}sw.js`),
    addEventListener: (type: string, fn: Handler) => { handlers.set(type, fn); },
  };
  const shellFetch = async (input: string) => new Response(`shell ${input}`, { status: 200 });
  vm.runInContext(code, vm.createContext({ self: scope, URL, Request, Response, Headers, ReadableStream, MessageChannel, Uint8Array, TypeError, TextDecoder, JSON, Promise, console, caches, crypto, fetch: shellFetch, setTimeout, clearTimeout }));
  const request = (url: string, init: { mode?: string; method?: string; headers?: Record<string, string>; destination?: string } = {}) => ({
    url, method: init.method ?? 'GET', mode: init.mode ?? 'cors', destination: init.destination ?? '', headers: new Headers(init.headers ?? {}), arrayBuffer: async () => new ArrayBuffer(0),
  });
  const fetchVia = async (url: string, init: { mode?: string; clientId?: string; destination?: string } = {}): Promise<Response | undefined> => {
    let response: Promise<Response> | Response | undefined;
    handlers.get('fetch')!({ request: request(url, init), clientId: init.clientId ?? 'c1', respondWith: (value: Promise<Response> | Response) => { response = value; } });
    return response ? await response : undefined;
  };
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const pending: Array<Promise<unknown>> = [];
    handlers.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };
  return { fetchVia, dispatch, asked, shown, opened, posted, store };
}

const okAnswer = (body: string, headers: Array<[string, string]> = []): Answer => () => [
  { t: 'head', status: 200, statusText: 'OK', headers: [['content-type', 'text/plain'], ...headers] },
  { t: 'chunk', data: new TextEncoder().encode(body.slice(0, 3)).buffer },
  { t: 'chunk', data: new TextEncoder().encode(body.slice(3)).buffer },
  { t: 'end' },
];

test('a PC path goes to the shell window over a MessagePort and streams back; root files are kept with their ETag', async () => {
  const sw = worker({ answer: okAnswer('body{color:red}', [['etag', '"v1"']]) });
  const response = await sw.fetchVia(`${SCOPE}main.css`);
  assert.equal(response?.status, 200);
  assert.equal(await response!.text(), 'body{color:red}');
  assert.equal(sw.asked[0].path, '/main.css', 'the PC\'s own path');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(sw.store.has(`${SCOPE}main.css`), 'kept for an offline start');
  const rpc = worker({ answer: okAnswer('{"id":1}') });
  assert.equal(await (await rpc.fetchVia(`${SCOPE}rpc`))!.text(), '{"id":1}');
  assert.equal(rpc.store.size, 0, '/rpc is never cached');
});

test('chunks are cache-first; main.js revalidates (304 → copy) and falls back to its copy without a tunnel; else 503', async () => {
  const seed = { [`${SCOPE}chunks/a-X.js`]: new Response('chunk'), [`${SCOPE}main.js`]: new Response('old main', { headers: { etag: '"v1"' } }) };
  const cached = worker({ seed, answer: () => [{ t: 'head', status: 304, headers: [] }, { t: 'end' }] });
  assert.equal(await (await cached.fetchVia(`${SCOPE}chunks/a-X.js`))!.text(), 'chunk');
  assert.equal(cached.asked.length, 0, 'no round trip for an immutable chunk');
  assert.equal(await (await cached.fetchVia(`${SCOPE}main.js`))!.text(), 'old main');
  assert.deepEqual(plain(cached.asked[0].headers.find(([name]) => name === 'If-None-Match')), ['If-None-Match', '"v1"']);
  const offline = worker({ seed });
  assert.equal(await (await offline.fetchVia(`${SCOPE}main.js`))!.text(), 'old main', 'no tunnel: the copy');
  const none = worker();
  const missing = await none.fetchVia(`${SCOPE}main.js`);
  assert.equal(missing!.status, 503);
  assert.match(await missing!.text(), /not reachable/);
});

test('navigations get the shell; a sandbox frame is the PC\'s; other origins and paths are not touched', async () => {
  const sw = worker({ answer: okAnswer('<html>app</html>') });
  assert.equal(await (await sw.fetchVia(`${SCOPE}#/chat/c1`, { mode: 'navigate' }))!.text(), `shell ${SCOPE}`);
  assert.equal(await (await sw.fetchVia(`${SCOPE}settings`, { mode: 'navigate' }))!.text(), `shell ${SCOPE}`);
  assert.equal(await (await sw.fetchVia(`${SCOPE}sandbox/app?m=x&i=0`, { mode: 'navigate', clientId: '' }))!.text(), '<html>app</html>');
  assert.equal(sw.asked.at(-1)!.path, '/sandbox/app?m=x&i=0');
  assert.equal(await sw.fetchVia(`${ORIGIN}/autark/download/`), undefined);
  assert.equal(await sw.fetchVia('https://other.example/autark/app/main.js'), undefined);
});

test('pushes always show a notice on iOS: a duplicate quietly, a clear quietly; a tap opens the scope plus the route', async () => {
  const closed: string[] = [];
  const open = [{ tag: 'chat:c1', data: { id: 'n1' }, close: () => closed.push('chat:c1') }];
  const sw = worker({ open, endpoint: APPLE });
  const push = (payload: unknown) => sw.dispatch('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  await push({ title: 'Mara', body: 'Done', tag: 'chat:c1', id: 'n1', url: '/#/chat/c1' });
  assert.equal(sw.shown.length, 1, 'shown although another PC showed it already');
  assert.equal(sw.shown[0].options.silent, true);
  assert.equal(sw.shown[0].options.renotify, false);
  assert.equal(sw.shown[0].options.icon, '/autark/app/app-icon.png');
  await push({ clear: 'chat:c1', tag: 'chat:c1', title: 'Mara', body: 'Done', silent: true });
  assert.equal(sw.shown.length, 2, 'a clear still shows a notice (iOS revokes silent pushes)');
  assert.ok(closed.length >= 2);
  assert.deepEqual(sw.posted.filter((m) => (m as { type?: string }).type === 'wf.wake').length, 2, 'every push wakes the shell');
  await sw.dispatch('notificationclick', { notification: { data: { url: '/#/chat/c9' }, close: () => undefined } });
  assert.deepEqual(plain(sw.posted.at(-1)), { type: 'wf.navigate', url: `${SCOPE}#/chat/c9` });
});

test('B-087: in Chrome or Edge (not Apple’s push service) a clear closes the notice and shows none – no dismissed notice comes back, no blank one', async () => {
  const closed: string[] = [];
  const open = [{ tag: 'chat:c1', data: { id: 'n1' }, close: () => closed.push('chat:c1') }];
  const sw = worker({ open, endpoint: FCM });
  const push = (payload: unknown) => sw.dispatch('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  await push({ clear: 'chat:c1', tag: 'chat:c1', title: 'Mara', body: 'Done', silent: true, id: 'n1' }); // read on the PC
  await push({ clear: 'chat:c1' }); // a ring ended (runtime/calls/ring.ts)
  assert.equal(sw.shown.length, 0, 'nothing shown again');
  assert.deepEqual(closed, ['chat:c1', 'chat:c1'], 'each clear closes the tag’s notice');
  assert.equal(sw.posted.filter((m) => (m as { type?: string }).type === 'wf.wake').length, 2, 'every push still wakes the shell');
  const none = worker({ open: [] });
  await none.dispatch('push', { data: { json: () => ({ clear: 'chat:c2' }), text: () => '' } });
  assert.equal(none.shown.length, 0, 'no subscription found: nothing shown either');
});

const KEPT = `${SCOPE}ui-hashes.json`;
const hashed = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([file, body]) => [file, createHash('sha256').update(body).digest('hex')]));
const keptList = (files: Record<string, string>) => new Response(JSON.stringify({ files: hashed(files) }));
/** The PC over the tunnel: `served` by path, its list (`listed`) at /ui-hashes.json, anything else a 404. */
const pcAnswer = (served: Record<string, string>, listed: Record<string, string> = served): Answer => (message) => {
  const body = message.path === '/ui-hashes.json' ? JSON.stringify({ files: hashed(listed) }) : served[message.path.slice(1)];
  return body === undefined ? [{ t: 'head', status: 404, statusText: 'Not Found', headers: [] }, { t: 'end' }] : okAnswer(body)(message);
};
const refusals = (posted: unknown[]) => plain(posted.filter((m) => (m as { type?: string }).type === 'hosted.refused'));
const PC_FILES = { 'main.js': 'import "./chunks/a-X.js"', 'chunks/a-X.js': 'export const a = 1', 'main.css': 'body{}' };

test('F29: a listed file reaches the page with the PC’s bytes and is kept; a tampered one is a 403 that says why, and the shell is told', async () => {
  const sw = worker({ seed: { [KEPT]: keptList(PC_FILES) }, answer: pcAnswer({ ...PC_FILES, 'main.js': 'steal(localStorage)' }, PC_FILES) });
  const chunk = await sw.fetchVia(`${SCOPE}chunks/a-X.js`, { destination: 'script' });
  assert.equal(chunk!.status, 200);
  assert.equal(await chunk!.text(), 'export const a = 1');
  const main = await sw.fetchVia(`${SCOPE}main.js`, { destination: 'script' });
  assert.equal(main!.status, 403);
  assert.match(await main!.text(), /did not run main\.js: it is not one of your PC’s own files/);
  assert.deepEqual(refusals(sw.posted), [{ type: 'hosted.refused', file: 'main.js' }]);
  assert.ok(sw.asked.some((m) => m.path === '/ui-hashes.json'), 'the PC was asked for its own list before the no');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(sw.store.has(`${SCOPE}chunks/a-X.js`), 'the checked chunk is kept');
  assert.ok(!sw.store.has(`${SCOPE}main.js`), 'the tampered file is never kept');
});

test('F29: a script or stylesheet the PC does not list is refused without fetching it; data paths pass unchecked', async () => {
  const sw = worker({ seed: { [KEPT]: keptList(PC_FILES) }, answer: pcAnswer({ ...PC_FILES, 'evil.js': 'x', 'files/ab12': 'photo' }, PC_FILES) });
  const evil = await sw.fetchVia(`${SCOPE}evil.js`, { destination: 'script' });
  assert.equal(evil!.status, 403);
  assert.ok(!sw.asked.some((m) => m.path === '/evil.js'), 'never fetched');
  const style = await sw.fetchVia(`${SCOPE}other.css`, { destination: 'style' });
  assert.equal(style!.status, 403, 'a stylesheet counts as code too');
  assert.deepEqual((refusals(sw.posted) as Array<{ file: string }>).map((m) => m.file), ['evil.js', 'other.css']);
  assert.equal(await (await sw.fetchVia(`${SCOPE}files/ab12`, { destination: 'image' }))!.text(), 'photo');
});

test('F29: a tampered copy counts as none – fetched anew, checked and kept; with no tunnel it is not used', async () => {
  const seed = { [KEPT]: keptList(PC_FILES), [`${SCOPE}chunks/a-X.js`]: new Response('steal()') };
  const sw = worker({ seed, answer: pcAnswer(PC_FILES) });
  assert.equal(await (await sw.fetchVia(`${SCOPE}chunks/a-X.js`, { destination: 'script' }))!.text(), 'export const a = 1');
  assert.ok(sw.asked.some((m) => m.path === '/chunks/a-X.js'), 'the PC was asked for the file');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await sw.store.get(`${SCOPE}chunks/a-X.js`)!.clone().text(), 'export const a = 1');
  const offline = worker({ seed: { [KEPT]: keptList(PC_FILES), [`${SCOPE}main.js`]: new Response('steal()') } });
  const main = await offline.fetchVia(`${SCOPE}main.js`, { destination: 'script' });
  assert.equal(main!.status, 503, 'no tunnel and no copy of the PC’s own: not reachable, never the tampered copy');
});

test('F29: the PC updated after this start – its new files pass: the worker asks the PC for its list and keeps it', async () => {
  const next = { ...PC_FILES, 'main.js': 'import "./chunks/b-Y.js"', 'chunks/b-Y.js': 'export const b = 2' };
  const sw = worker({ seed: { [KEPT]: keptList(PC_FILES), [`${SCOPE}main.js`]: new Response(PC_FILES['main.js'], { headers: { etag: '"v1"' } }) }, answer: pcAnswer(next) });
  const main = await sw.fetchVia(`${SCOPE}main.js`, { destination: 'script' });
  assert.equal(await main!.text(), next['main.js']);
  assert.equal((await sw.fetchVia(`${SCOPE}chunks/b-Y.js`, { destination: 'script' }))!.status, 200);
  assert.deepEqual(refusals(sw.posted), []);
  assert.deepEqual(plain(await sw.store.get(KEPT)!.clone().json()), { files: hashed(next) }, 'the PC’s new list is kept');
});

test('F29: without a kept list and without a PC to ask, a script is refused, never run unchecked', async () => {
  const sw = worker();
  const main = await sw.fetchVia(`${SCOPE}main.js`, { destination: 'script' });
  assert.equal(main!.status, 403);
  assert.deepEqual(refusals(sw.posted), [{ type: 'hosted.refused', file: 'main.js' }]);
});
