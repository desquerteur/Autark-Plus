// Files and settings between the CEO's PCs (devices/sync/files.ts, settings.ts): two temporary data folders on a fake
// mesh. The synced roots arrive whole (and nothing else), a removal travels as a tombstone, a change the data folder's
// watcher hands over goes at once (its tap: also the app's own writes, never in an owner's way); settings travel as
// patches without devices, phone access and the window layout (sync-settings.test.ts: per section). Where Windows
// refuses the rename, the pulled file is copied over the target; a pull that failed leaves the link-up incomplete, so
// the next one offers the file again (B-087: so does a link that went during it – no page is sent, so none dials). A
// stored file's bytes come from a CEO PC when first needed (blobs.ts); B-080: its arrival is reported to that store's
// listener (the media library probes it). B-087: a failed pull is tried again while the PC stays linked; a file saved
// here while its pull ran stays and goes out, so does a change here an older offer meets; a SYSTEM.md written again
// with the same bytes is a new version (no other file), and a pulled one is taken over at once as an echo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync, renameSync, type FSWatcher } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { WorkforceError } from '../../../src/shared/errors.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { Settings } from '../../../src/shared/model/system.ts';
import { DevicesRepo, type DeviceRecord } from '../../../src/runtime/devices/repo.ts';
import { FileSync } from '../../../src/runtime/devices/sync/files.ts';
import { replaceWithSync } from '../../../src/runtime/devices/sync/file-io.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { needBlob, onArrival } from '../../../src/runtime/devices/sync/blobs.ts';
import { settingsPatch } from '../../../src/runtime/devices/sync/settings.ts';
import { Stamps } from '../../../src/runtime/devices/sync/stamps.ts';
import { deepMerge } from '../../../src/runtime/settings/validate.ts';
import { RootWatcher, type WatchFn } from '../../../src/runtime/root/watcher.ts';
import { ManualClock, memoryDb, recordingBus, silentLog } from './fakes.ts';

const record = (id: string, extra: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id, name: id, kind: 'pc', role: 'home', fingerprint: `fp_${id}`, addresses: [], caps: {}, status: 'online', self: false, ...extra,
});

const settingsOf = (name: string, width: number) => ({
  profile: { name }, preferences: { theme: name ? 'dark' : 'system', sidebarWidth: width }, devices: { peer: 'lan', peerPort: width }, pwa: { enabled: false, bind: 'lan' },
}) as unknown as Settings;

type Handlers = Map<string, (params: unknown, from: string) => Promise<unknown>>;

async function makePc(pcs: Map<string, { handlers: Handlers }>, id: string, settings: Settings) {
  const root = await mkdtemp(path.join(os.tmpdir(), `sync-${id}-`));
  const data = path.join(root, 'data');
  const workspace = path.join(root, 'workspace');
  await mkdir(data, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const db = memoryDb();
  const { bus } = recordingBus();
  const repo = new DevicesRepo(db);
  repo.upsert(record(id, { self: true }));
  const handlers = new Map<string, (params: unknown, from: string) => Promise<unknown>>();
  const store = { current: settings };
  const blobs = path.join(data, 'blobs');
  const fileRows = new Set<string>(); // the `files` rows here (blob metadata)
  const s = {
    db, bus, clock: new ManualClock(), log: silentLog, paths: { data, workspace, blobs },
    files: { get: (fileId: string) => (fileRows.has(fileId) ? { id: fileId } : undefined), path: (fileId: string) => path.join(blobs, fileId.slice(0, 2), fileId.slice(2, 4), fileId) },
    settings: { get: () => store.current, update: (patch: unknown) => { store.current = deepMerge(store.current, patch); bus.emit('settings.updated', store.current); return store.current; } },
    devices: {
      online: (peer: string) => pcs.has(peer),
      call: async (peer: string, method: string, params: unknown) => {
        const target = pcs.get(peer);
        if (!target) throw new WorkforceError('unavailable', 'offline');
        return target.handlers.get(method)!(JSON.parse(JSON.stringify(params)), id);
      },
    },
  } as unknown as RuntimeServices;
  const stamps = new Stamps(db, s.clock);
  const files = new FileSync(s, stamps);
  handlers.set('sync.file', (params, from) => files.receive(params, from));
  const pc = { id, root, data, workspace, repo, files, handlers, store, s, fileRows, stamps };
  pcs.set(id, pc);
  return pc;
}
type Pc = Awaited<ReturnType<typeof makePc>>;

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
/** Polls until `check` holds (parallel test runs slow the sync down; a fixed sleep made this test flaky). */
async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check()) && Date.now() < end) await settle(25);
}
const readOr = (file: string) => readFile(file, 'utf8').catch(() => undefined);
/** Waits until `check` holds (a scan gathers 1 s first; a busy machine adds more), at most 10 s. */
const until = async (check: () => Promise<boolean>) => { for (const end = Date.now() + 10_000; !(await check()) && Date.now() < end;) await settle(10); };

test('settings travel as a patch: devices, phone access and the window layout stay on each PC, a removed key goes', () => {
  const local = { ...settingsOf('', 300), voice: { vocabulary: ['Autark'], ttsVoice: 'old' } } as unknown as Settings;
  const incoming = { profile: { name: 'Lena' }, preferences: { theme: 'dark' }, voice: { vocabulary: ['Autark', 'Teydra'] } };
  assert.deepEqual(settingsPatch(local, incoming), { profile: { name: 'Lena' }, preferences: { theme: 'dark' }, voice: { vocabulary: ['Autark', 'Teydra'], ttsVoice: null } });
  assert.deepEqual(settingsPatch(local, incoming, true), { profile: { name: 'Lena' }, preferences: { theme: 'dark' }, voice: { vocabulary: ['Autark', 'Teydra'] } }, 'at the first link what only this PC has stays');
});

test('synced roots arrive whole, a removal follows, a watcher tap sends a change at once – and the settings come along', async (t) => {
  const pcs = new Map<string, Pc>();
  const a = await makePc(pcs, 'dev_a', settingsOf('Lena', 300));
  const b = await makePc(pcs, 'dev_b', settingsOf('', 260));
  t.after(async () => { for (const pc of [a, b]) await rm(pc.root, { recursive: true, force: true }); });
  a.repo.upsert(record('dev_b'));
  b.repo.upsert(record('dev_a', { joinedAs: 'ceo' }));
  const put = async (base: string, rel: string, text: string) => { await mkdir(path.dirname(path.join(base, rel)), { recursive: true }); await writeFile(path.join(base, rel), text); };
  await put(a.data, 'agents/ag_1/SYSTEM.md', '# Mara\nWrites.');
  await put(a.data, 'memory/notes/a.md', 'first note');
  await put(a.data, 'theme.css', ':root { --accent: teal; }');
  await put(a.workspace, 'skills/report/SKILL.md', '# Report');
  await put(a.data, 'agents/README.md', 'generated map');
  await put(a.data, 'connectors/status.json', '{}');
  await put(a.data, 'logs/runtime.log', 'never');
  const watcher = new RootWatcher({ root: a.data, clock: a.s.clock, watch: false, debounceMs: 1 }); // the data folder's watcher, without the OS
  watcher.register('memory', () => {});
  a.files.attach((listener) => watcher.tap(listener));
  b.files.attach();

  assert.ok(await a.files.catchUp('dev_b', undefined));
  assert.equal(await readFile(path.join(b.data, 'agents/ag_1/SYSTEM.md'), 'utf8'), '# Mara\nWrites.');
  assert.equal(await readFile(path.join(b.data, 'memory/notes/a.md'), 'utf8'), 'first note');
  assert.equal(await readFile(path.join(b.data, 'theme.css'), 'utf8'), ':root { --accent: teal; }');
  assert.equal(await readFile(path.join(b.workspace, 'skills/report/SKILL.md'), 'utf8'), '# Report');
  for (const rel of ['agents/README.md', 'connectors/status.json', 'logs/runtime.log']) assert.equal(existsSync(path.join(b.data, rel)), false, rel);
  assert.equal(b.store.current.profile.name, 'Lena', 'the PC that joined takes the settings');
  assert.equal((b.store.current.preferences as { sidebarWidth: number }).sidebarWidth, 260, 'its window layout stays');
  assert.equal(b.store.current.devices.peerPort, 260, 'its devices section stays');

  const clock = a.s.clock as ManualClock;
  const cursor = clock.now();
  clock.set(cursor + 1000);
  await rm(path.join(a.data, 'memory/notes/a.md'));
  assert.ok(await a.files.catchUp('dev_b', cursor));
  assert.equal(existsSync(path.join(b.data, 'memory/notes/a.md')), false, 'the removal travels');

  await put(a.data, 'memory/notes/b.md', 'second note');
  watcher.nudge('memory', ['notes', 'b.md']);
  watcher.flush();
  await eventually(async () => (await readOr(path.join(b.data, 'memory/notes/b.md'))) === 'second note');
  assert.equal(await readFile(path.join(b.data, 'memory/notes/b.md'), 'utf8'), 'second note', 'a change the watcher hands over goes at once');
  watcher.stop();

  a.s.settings.update({ profile: { name: 'Lena Berg' } });
  await eventually(() => b.store.current.profile.name === 'Lena Berg');
  assert.equal(b.store.current.profile.name, 'Lena Berg', 'a settings change goes at once');
});

test('the data folder watcher\'s tap hears every handed-over path – the app\'s own writes too – and never stops an owner', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sync-tap-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let fire: ((name: string) => void) | undefined;
  const watch: WatchFn = (_target, _options, listener) => {
    fire = (name) => listener('change', name);
    return Object.assign(new EventEmitter(), { close: () => {} }) as unknown as FSWatcher;
  };
  const watcher = new RootWatcher({ root: dir, clock: new ManualClock(), watch, debounceMs: 1, recursive: true });
  const owner: string[] = [];
  const tapped: string[] = [];
  watcher.register('memory', (event) => { owner.push(event.parts?.join('/') ?? '*'); });
  const off = watcher.tap((name, parts) => { tapped.push([name, ...(parts ?? [])].join('/')); });
  watcher.tap(() => { throw new Error('a broken tap'); });
  watcher.start();
  t.after(() => watcher.stop());
  const file = path.join(dir, 'memory', 'a.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'written by the app');
  watcher.wrote(file, 'written by the app');
  const event = (name: string) => { fire!(name); watcher.flush(); };

  event('memory/a.md');
  event('logs/runtime.log');
  assert.deepEqual(owner, [], 'the owner skips the app\'s own write');
  assert.deepEqual(tapped, ['memory/a.md'], 'the tap hears it; a path no owner has is not handed over');

  await writeFile(file, 'edited outside');
  event('memory/a.md');
  assert.deepEqual(owner, ['a.md'], 'a broken tap never stops the owner');
  assert.deepEqual(tapped, ['memory/a.md', 'memory/a.md']);

  off();
  event('memory/a.md');
  assert.equal(tapped.length, 2, 'off ends it');
});

test('where Windows refuses the rename the pulled file is copied over; a failed pull leaves the link-up incomplete and comes again', async (t) => {
  const pcs = new Map<string, Pc>();
  const a = await makePc(pcs, 'dev_a', settingsOf('Lena', 300));
  const b = await makePc(pcs, 'dev_b', settingsOf('', 260));
  t.after(async () => { for (const pc of [a, b]) await rm(pc.root, { recursive: true, force: true }); });
  a.repo.upsert(record('dev_b'));
  b.repo.upsert(record('dev_a', { joinedAs: 'ceo' }));
  await mkdir(path.join(a.data, 'agents/ag_1'), { recursive: true });
  await writeFile(path.join(a.data, 'agents/ag_1/agent.json'), '{"name":"Mara"}');
  await mkdir(path.join(b.data, 'agents/ag_1'), { recursive: true });
  await writeFile(path.join(b.data, 'agents/ag_1/agent.json'), '{}');
  await utimes(path.join(b.data, 'agents/ag_1/agent.json'), new Date(2026, 0, 1), new Date(2026, 0, 1)); // B's is older

  const refuse = (code: string) => () => { throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code }); };
  b.files.move = refuse('ENOSPC');
  assert.equal(await a.files.catchUp('dev_b', undefined), false, 'a pull that failed: the link-up is incomplete');
  assert.equal(await readFile(path.join(b.data, 'agents/ag_1/agent.json'), 'utf8'), '{}');
  assert.deepEqual((await readdir(path.join(b.data, 'agents/ag_1'))).filter((name) => name.endsWith('.tmp')), [], 'no temp file stays');

  b.files.move = refuse('EPERM'); // the next link-up (the cursor did not move): the rename is refused, the copy works
  assert.equal(await a.files.catchUp('dev_b', undefined), true);
  assert.equal(await readFile(path.join(b.data, 'agents/ag_1/agent.json'), 'utf8'), '{"name":"Mara"}');
  assert.deepEqual((await readdir(path.join(b.data, 'agents/ag_1'))).filter((name) => name.endsWith('.tmp')), []);
});

test('B-087: a link that goes during the link-up gets no further page (none dials); the next link-up offers the rest', async (t) => {
  const pcs = new Map<string, Pc>();
  const a = await makePc(pcs, 'dev_a', settingsOf('Lena', 300));
  const b = await makePc(pcs, 'dev_b', settingsOf('', 260));
  t.after(async () => { for (const pc of [a, b]) await rm(pc.root, { recursive: true, force: true }); });
  a.repo.upsert(record('dev_b'));
  b.repo.upsert(record('dev_a', { joinedAs: 'ceo' }));
  await mkdir(path.join(a.data, 'agents/ag_1'), { recursive: true });
  await writeFile(path.join(a.data, 'agents/ag_1/agent.json'), '{"name":"Mara"}');
  const ops: unknown[] = [];
  const devices = a.s.devices as { call(peer: string, method: string, params: unknown): Promise<unknown> };
  const call = devices.call;
  devices.call = async (peer, method, params) => { ops.push((params as { op?: unknown }).op); const answer = await call(peer, method, params); pcs.delete('dev_b'); return answer; }; // the link goes after the settings
  assert.equal(await a.files.catchUp('dev_b', undefined), false, 'incomplete: the cursor stays');
  assert.deepEqual(ops, ['settings'], 'no page after it');
  devices.call = call;
  pcs.set('dev_b', b);
  assert.equal(await a.files.catchUp('dev_b', undefined), true, 'the next link-up');
  assert.equal(await readFile(path.join(b.data, 'agents/ag_1/agent.json'), 'utf8'), '{"name":"Mara"}');
});

test('a stored file\'s bytes come from a CEO PC when first needed – checked by their hash, never from an employee\'s PC', async (t) => {
  const pcs = new Map<string, Pc>();
  const a = await makePc(pcs, 'dev_a', settingsOf('Lena', 300));
  const b = await makePc(pcs, 'dev_b', settingsOf('', 260));
  t.after(async () => { for (const pc of [a, b]) await rm(pc.root, { recursive: true, force: true }); });
  a.repo.upsert(record('dev_b'));
  b.repo.upsert(record('dev_a', { joinedAs: 'ceo' }));
  const bytes = Buffer.from('a picture of Lena');
  const id = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.dirname(a.s.files.path(id)), { recursive: true });
  await writeFile(a.s.files.path(id), bytes);
  a.fileRows.add(id);
  b.fileRows.add(id); // its row arrived with the rows (tables.ts), its bytes not yet

  assert.equal(await needBlob(b.s, id), true);
  assert.deepEqual(await readFile(b.s.files.path(id)), bytes, 'the bytes are there');
  assert.equal(await needBlob(b.s, id), true, 'there already: no second pull');
  const other = createHash('sha256').update('nobody has this').digest('hex');
  b.fileRows.add(other);
  assert.equal(await needBlob(b.s, other), false, 'no CEO PC has it');
  assert.equal(existsSync(b.s.files.path(other)), false);
  assert.deepEqual(await readdir(path.join(b.s.paths.blobs, 'tmp')), [], 'no part file stays');

  a.repo.upsert(record('dev_b', { personId: 'per_lena000001' })); // now an employee's PC
  await assert.rejects(a.files.receive({ op: 'blob', id, offset: 0 }, 'dev_b'), (error: unknown) => error instanceof WorkforceError && error.code === 'forbidden');
});

test('B-080: a CEO PC without a live link is asked too (devices.call dials it) – a gap in a flapping link no longer ends the pull', async (t) => {
  const pcs = new Map<string, Pc>();
  const a = await makePc(pcs, 'dev_a', settingsOf('Lena', 300));
  const b = await makePc(pcs, 'dev_b', settingsOf('', 260));
  t.after(async () => { for (const pc of [a, b]) await rm(pc.root, { recursive: true, force: true }); });
  a.repo.upsert(record('dev_b'));
  b.repo.upsert(record('dev_a', { joinedAs: 'ceo', status: 'offline' }));
  const asked: string[] = [];
  const devices = b.s.devices as { online(peer: string): boolean; call(peer: string, method: string, params: unknown): Promise<unknown> };
  const call = devices.call.bind(devices);
  devices.online = () => false; // the link is down this moment
  devices.call = (peer, method, params) => { asked.push(peer); return call(peer, method, params); };
  const bytes = Buffer.from('the APK from the notebook');
  const id = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.dirname(a.s.files.path(id)), { recursive: true });
  await writeFile(a.s.files.path(id), bytes);
  a.fileRows.add(id);
  b.fileRows.add(id);
  assert.equal(await needBlob(b.s, id), true);
  assert.deepEqual(await readFile(b.s.files.path(id)), bytes);
  assert.ok(asked.includes('dev_a'), 'the CEO PC was asked although it was not online');
});

test('B-080 F4: bytes a pull put in place are reported to that file store\'s arrival listener, once', async (t) => {
  const pcs = new Map<string, Pc>();
  const a = await makePc(pcs, 'dev_a', settingsOf('Lena', 300));
  const b = await makePc(pcs, 'dev_b', settingsOf('', 260));
  t.after(async () => { for (const pc of [a, b]) await rm(pc.root, { recursive: true, force: true }); });
  a.repo.upsert(record('dev_b'));
  b.repo.upsert(record('dev_a', { joinedAs: 'ceo' }));
  const heard: string[] = [];
  const elsewhere: string[] = [];
  onArrival(b.s.files, (id) => heard.push(id));
  onArrival(a.s.files, (id) => elsewhere.push(id));
  const bytes = Buffer.from('a dictation recorded on the notebook');
  const id = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.dirname(a.s.files.path(id)), { recursive: true });
  await writeFile(a.s.files.path(id), bytes);
  a.fileRows.add(id);
  b.fileRows.add(id);
  assert.equal(await needBlob(b.s, id), true);
  assert.deepEqual(heard, [id], 'the media library hears it and probes it');
  assert.equal(await needBlob(b.s, id), true);
  assert.deepEqual(heard, [id], 'already here: no second arrival');
  assert.deepEqual(elsewhere, [], 'another runtime\'s store hears nothing');
});

/** Two linked CEO PCs whose agents/ag_1 folder exists on both. */
async function linkedPair(t: { after(fn: () => Promise<void>): void }) {
  const pcs = new Map<string, Pc>();
  const a = await makePc(pcs, 'dev_a', settingsOf('Lena', 300));
  const b = await makePc(pcs, 'dev_b', settingsOf('', 260));
  t.after(async () => { for (const pc of [a, b]) await rm(pc.root, { recursive: true, force: true }); });
  a.repo.upsert(record('dev_b'));
  b.repo.upsert(record('dev_a', { joinedAs: 'ceo' }));
  for (const pc of [a, b]) await mkdir(path.join(pc.data, 'agents/ag_1'), { recursive: true });
  const at = (pc: Pc, rel: string) => path.join(pc.data, ...rel.split('/'));
  const put = async (pc: Pc, rel: string, text: string, when?: Date) => { await writeFile(at(pc, rel), text); if (when) await utimes(at(pc, rel), when, when); };
  const read = (pc: Pc, rel: string) => readFile(at(pc, rel), 'utf8').catch(() => undefined);
  return { pcs, a, b, put, read };
}
const OLD = new Date(2026, 0, 1);

test('B-087: a pull that failed is tried again while its PC stays linked', async (t) => {
  const { a, b, put, read } = await linkedPair(t);
  await put(a, 'agents/ag_1/agent.json', '{"name":"Mara"}');
  await put(b, 'agents/ag_1/agent.json', '{}', OLD);
  b.files.retryMs = [30, 30];
  b.files.move = () => { b.files.move = undefined; throw Object.assign(new Error('ENOSPC: no space left on device, rename'), { code: 'ENOSPC' }); };
  assert.equal(await a.files.catchUp('dev_b', undefined), false, 'the link-up is still incomplete');
  await until(async () => await read(b, 'agents/ag_1/agent.json') === '{"name":"Mara"}');
  assert.equal(await read(b, 'agents/ag_1/agent.json'), '{"name":"Mara"}', 'tried again without a new link-up');
});

test('B-087: a file saved here while its pull ran stays and goes out; a change here an older offer meets goes out too', async (t) => {
  const { a, b, put, read } = await linkedPair(t);
  await put(a, 'agents/ag_1/agent.json', '{"name":"Mara"}');
  await put(b, 'agents/ag_1/agent.json', '{}', OLD);
  b.files.retryMs = [30];
  const devices = b.s.devices as { call(peer: string, method: string, params: unknown): Promise<unknown> };
  const call = devices.call;
  devices.call = async (peer, method, params) => {
    const answer = await call(peer, method, params);
    if ((params as { op?: unknown }).op === 'get') { devices.call = call; await put(b, 'agents/ag_1/agent.json', '{"name":"Mara B"}'); } // saved here meanwhile
    return answer;
  };
  await a.files.catchUp('dev_b', undefined);
  await until(async () => await read(a, 'agents/ag_1/agent.json') === '{"name":"Mara B"}');
  assert.equal(await read(b, 'agents/ag_1/agent.json'), '{"name":"Mara B"}', 'the save here stays');
  assert.equal(await read(a, 'agents/ag_1/agent.json'), '{"name":"Mara B"}', 'and reaches the other PC');

  await put(b, 'agents/ag_1/agent.json', '{"name":"Mara C"}'); // not scanned yet when A offers its older state
  await a.files.catchUp('dev_b', undefined);
  await until(async () => await read(a, 'agents/ag_1/agent.json') === '{"name":"Mara C"}');
  assert.equal(await read(a, 'agents/ag_1/agent.json'), '{"name":"Mara C"}');
});

test('B-087: a SYSTEM.md written again with the same bytes is a new version; a pulled one is taken over as an echo', async (t) => {
  const { a, b, put, read } = await linkedPair(t);
  await put(b, 'agents/ag_1/SYSTEM.md', 'Write short.\n', OLD);
  await a.files.catchUp('dev_b', undefined); // nothing on A yet
  await b.files.catchUp('dev_a', undefined); // A takes B's
  await put(a, 'agents/ag_1/SYSTEM.md', 'Write long.\n'); // a linked PC's newer edit, not offered yet
  await put(b, 'agents/ag_1/SYSTEM.md', 'Write short.\n'); // B saves back to what its file says, later
  const seen: Array<[string, boolean]> = [];
  (a.s as { agentCore?: unknown }).agentCore = { rowAhead: () => false, arrived: (id: string) => { seen.push([id, a.stamps.echo.has(`agents/${id}`)]); } };
  await b.files.catchUp('dev_a', undefined);
  await a.files.catchUp('dev_b', undefined);
  assert.equal(await read(b, 'agents/ag_1/SYSTEM.md'), 'Write short.\n', 'the later save back wins');
  assert.equal(await read(a, 'agents/ag_1/SYSTEM.md'), 'Write short.\n');
  assert.deepEqual(seen, [['ag_1', true]], 'the agent core took the pulled SYSTEM.md over at once, as an echo');
  assert.equal(a.stamps.echo.size, 0);

  // Any other file: the same bytes written again later are no new version – A's real edit before it wins.
  await put(a, 'agents/ag_1/agent.json', '{}');
  await a.files.catchUp('dev_b', undefined);
  assert.equal(await read(b, 'agents/ag_1/agent.json'), '{}');
  await put(a, 'agents/ag_1/agent.json', '{"x":1}');
  await settle(20);
  await put(b, 'agents/ag_1/agent.json', '{}');
  await b.files.catchUp('dev_a', undefined);
  await a.files.catchUp('dev_b', undefined);
  await until(async () => await read(b, 'agents/ag_1/agent.json') === '{"x":1}');
  assert.equal(await read(b, 'agents/ag_1/agent.json'), '{"x":1}');
  assert.equal(await read(a, 'agents/ag_1/agent.json'), '{"x":1}');
});

test('B-087: two offers of one new file at once both end well; two failures at once keep the first quick try', async (t) => {
  const { a, b, put, read } = await linkedPair(t);
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const offer = (text: string) => ({ op: 'have', entries: [{ rel: 'agents/ag_1/agent.json', sha: sha(text), at: Date.now() + 60_000 }] });
  const devices = b.s.devices as { call(peer: string, method: string, params: unknown): Promise<unknown> };
  const call = devices.call;
  devices.call = async (peer, method, params) => { await settle(30); return call(peer, method, params); }; // a slow link: both pulls run at once
  await put(a, 'agents/ag_1/agent.json', '{"name":"Mara 2"}');
  const both = await Promise.all([b.files.receive(offer('{"name":"Mara 2"}'), 'dev_a'), b.files.receive(offer('{"name":"Mara 2"}'), 'dev_a')]) as Array<{ failed: number }>;
  assert.deepEqual(both.map((answer) => answer.failed), [0, 0], 'the second finds that version in place: no failure, the link-up completes');
  assert.equal(await read(b, 'agents/ag_1/agent.json'), '{"name":"Mara 2"}');

  await put(a, 'agents/ag_1/agent.json', '{"name":"Mara 3"}');
  b.files.retryMs = [40, 60_000];
  let refusals = 2;
  b.files.move = (from, to) => { if (refusals-- > 0) throw Object.assign(new Error('ENOSPC: no space left on device, rename'), { code: 'ENOSPC' }); renameSync(from, to); };
  const failed = await Promise.all([b.files.receive(offer('{"name":"Mara 3"}'), 'dev_a'), b.files.receive(offer('{"name":"Mara 3"}'), 'dev_a')]) as Array<{ failed: number }>;
  assert.deepEqual(failed.map((answer) => answer.failed), [1, 1], 'both pulls failed');
  await until(async () => await read(b, 'agents/ag_1/agent.json') === '{"name":"Mara 3"}');
  assert.equal(await read(b, 'agents/ag_1/agent.json'), '{"name":"Mara 3"}', 'the first try after 40 ms, not the second step');
});

test('B-087: a planned try takes the newest offer; the same bytes with a later time are kept; a big copy waits for its next try', async (t) => {
  const { a, b, put, read } = await linkedPair(t);
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const offer = (text: string, at: number) => ({ op: 'have', entries: [{ rel: 'agents/ag_1/agent.json', sha: sha(text), at }] });
  const now = Date.now();
  b.files.retryMs = [1_000, 60_000]; // the second offer comes well before the first try
  let refusals = 2;
  b.files.move = (from, to) => { if (refusals-- > 0) throw Object.assign(new Error('ENOSPC: no space left on device, rename'), { code: 'ENOSPC' }); renameSync(from, to); };
  await put(a, 'agents/ag_1/agent.json', '{"v":1}');
  await b.files.receive(offer('{"v":1}', now + 1_000), 'dev_a'); // fails: a try is planned for v1
  await put(a, 'agents/ag_1/agent.json', '{"v":2}');
  await b.files.receive(offer('{"v":2}', now + 2_000), 'dev_a'); // fails too: the planned try now takes v2
  await until(async () => await read(b, 'agents/ag_1/agent.json') === '{"v":2}');
  assert.equal(await read(b, 'agents/ag_1/agent.json'), '{"v":2}', 'the newest offer, at the first step');

  const entry = () => new KvRepo(b.s.db).get<{ at: number }>('sync.files', 'agents/ag_1/agent.json')!.at;
  await b.files.receive(offer('{"v":2}', now + 9_000), 'dev_a');
  assert.equal(entry(), now + 9_000, 'the same bytes, a later time: kept');

  const temp = path.join(b.data, 'big.tmp');
  const target = path.join(b.data, 'big.bin');
  const busy = () => { throw Object.assign(new Error('EBUSY: resource busy or locked, rename'), { code: 'EBUSY' }); };
  await writeFile(temp, Buffer.alloc(5 * 1024 * 1024));
  assert.throws(() => replaceWithSync(temp, target, busy), /EBUSY/, 'over 4 MiB: no long synchronous copy');
  await writeFile(temp, 'small');
  replaceWithSync(temp, target, busy);
  assert.equal(await readFile(target, 'utf8'), 'small', 'a small one is copied over');
});
