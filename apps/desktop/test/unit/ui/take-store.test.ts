// B-082 decision 6 (ui/lib/take-store.ts) against a fake key/value store: a held piece is listed and plays at once,
// survives a new page (same storage), works without storage (memory) and with storage that throws, uploads oldest
// first once the link is back (each one leaves the store and is reported), stops at the first failed upload, and a
// piece deleted meanwhile is neither reported nor kept. Held chips use a fileId that no file id can be and the piece's own type.
// Owns: these assertions only. Never: a real IndexedDB or upload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELD_PREFIX, TakeStore, heldAttachment, heldKey, type KeyValue } from '../../../src/ui/lib/take-store.ts';
import type { FileRef } from '../../../src/shared/model/system.ts';

function fakeStorage(fail = false): KeyValue & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const check = () => { if (fail) throw new Error('blocked'); };
  return {
    data,
    get: async (key) => { check(); return data.get(key); },
    set: async (key, value) => { check(); data.set(key, value); },
    remove: async (key) => { check(); data.delete(key); },
    values: async (prefix) => { check(); return [...data.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value); },
  };
}

const wav = (bytes = 100) => new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
const ref = (name: string): FileRef => ({ id: 'f'.repeat(64), name, mime: 'audio/wav', size: 100, createdAt: 1 });

test('a held piece is listed with its owner, plays from its blob and survives a new page', async () => {
  const storage = fakeStorage();
  let clock = 1000;
  const store = new TakeStore(storage, () => clock++);
  const held = await store.hold(wav(), 'Dictation 2026-11-08 10-00.wav', 'chat-1');
  assert.equal(held.owner, 'chat-1');
  assert.equal(held.size, 100);
  assert.deepEqual((await store.list()).map((entry) => entry.key), [held.key]);
  const url = await store.url(held.key);
  assert.match(url ?? '', /^blob:/);
  assert.equal(await store.url(held.key), url, 'one URL per piece');
  const later = new TakeStore(storage);
  assert.deepEqual((await later.list()).map((entry) => entry.name), ['Dictation 2026-11-08 10-00.wav']);
  assert.ok(await later.url(held.key));
});

test('without storage, or with storage that throws, a piece is still held in memory', async () => {
  for (const storage of [null, fakeStorage(true)]) {
    const store = new TakeStore(storage);
    const held = await store.hold(wav(), 'a.wav');
    assert.deepEqual((await store.list()).map((entry) => entry.key), [held.key]);
    await store.drop(held.key);
    assert.deepEqual(await store.list(), []);
  }
});

test('flush uploads oldest first, reports each and forgets it; a failed upload ends the round and keeps the rest', async () => {
  const storage = fakeStorage();
  let clock = 1;
  const store = new TakeStore(storage, () => clock++);
  const first = await store.hold(wav(), 'one.wav', 'chat-1');
  const second = await store.hold(wav(), 'two.wav');
  let down = true;
  const uploaded: string[] = [];
  const upload = async (_blob: Blob, name: string) => { if (down) throw new Error('offline'); return ref(name); };
  await store.flush(upload, (held) => uploaded.push(held.key));
  assert.equal(uploaded.length, 0);
  assert.equal((await store.list()).length, 2);
  down = false;
  await store.flush(upload, (held, file) => uploaded.push(`${held.key}:${file.name}`));
  assert.deepEqual(uploaded, [`${first.key}:one.wav`, `${second.key}:two.wav`]);
  assert.deepEqual(await store.list(), []);
  assert.equal(storage.data.size, 0);
});

test('a piece deleted while it uploads is not reported; two flushes at once run one round', async () => {
  const store = new TakeStore(fakeStorage());
  const held = await store.hold(wav(), 'one.wav', 'chat-1');
  let release!: () => void;
  let uploads = 0;
  const upload = async (_blob: Blob, name: string) => { uploads++; await new Promise<void>((resolve) => { release = resolve; }); return ref(name); };
  const reported: string[] = [];
  const round = store.flush(upload, (entry) => reported.push(entry.key));
  assert.equal(store.flush(upload, (entry) => reported.push(entry.key)), round);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await store.drop(held.key);
  release();
  await round;
  assert.equal(uploads, 1);
  assert.deepEqual(reported, []);
  assert.deepEqual(await store.list(), []);
});

test('a held chip has a fileId no file id can be', () => {
  const chip = heldAttachment({ key: 'k1', name: 'a.wav', size: 5, at: 1 });
  assert.deepEqual(chip, { fileId: `${HELD_PREFIX}k1`, name: 'a.wav', mime: 'audio/wav', size: 5 });
  assert.equal(heldKey(chip.fileId), 'k1');
  assert.equal(heldKey('f'.repeat(64)), undefined);
  assert.doesNotMatch(chip.fileId, /^[A-Za-z0-9_.:@-]{1,128}$/, 'the runtime never keeps it in a draft');
});

test('a held compact piece keeps its own type, also on a new page', async () => {
  const storage = fakeStorage();
  const store = new TakeStore(storage);
  const held = await store.hold(new Blob([new Uint8Array(40)], { type: 'audio/ogg' }), 'Dictation 2026-11-16 10-00.ogg', 'chat-1');
  assert.equal(held.mime, 'audio/ogg');
  assert.equal(heldAttachment(held).mime, 'audio/ogg');
  const [later] = await new TakeStore(storage).list();
  assert.equal(heldAttachment(later).mime, 'audio/ogg');
  assert.equal((await store.hold(wav(), 'a.wav')).mime, 'audio/wav');
});
