// F23 (owner 16.11.2026: a recording "direkt angehängt an die Nachricht, also nicht transkribiert"): the composer's
// take goes into the draft as an attachment chip (composer/record-take.ts attachTake) – chunked with progress, with the
// chat's id only on a person's device, the draft saved at once and the IndexedDB copy dropped only after that; a failed
// upload rejects and keeps the stored copy for Attach or the next visit; a second Attach while one runs joins it (one
// chip, one upload); Send waits while the chat's composer records, attaches or holds a take (holdsTake). Recordings and
// videos are not bound to the 20 MB of other files. Names carry no ':'.
// Owns: these assertions only. Never: a real runtime (rpc.call is a fake), a real IndexedDB (an in-memory one) or rendering.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- a small in-memory IndexedDB (the store pwa/idb.ts uses)
type Callback = (() => void) | undefined;
interface Request { result?: unknown; onsuccess?: Callback; onerror?: Callback; onupgradeneeded?: Callback }
const data = new Map<string, unknown>();
const later = (fn: () => void) => setTimeout(fn, 0);
const fakeDb = {
  createObjectStore() {},
  close() {},
  transaction() {
    const tx: { oncomplete?: Callback; objectStore?: unknown } = {};
    let pending = 0;
    const done = () => later(() => { if (pending === 0) tx.oncomplete?.(); });
    tx.objectStore = () => ({
      get(key: string) { const req: Request = {}; later(() => { req.result = data.get(key); req.onsuccess?.(); }); return req; },
      put(value: unknown, key: string) { data.set(key, value); },
      delete(key: string) { data.delete(key); },
      openCursor() { const req: Request = {}; pending++; later(() => { req.result = null; req.onsuccess?.(); pending--; done(); }); return req; },
    });
    done();
    return tx;
  },
};
Object.assign(globalThis, {
  IDBKeyRange: { bound: (lower: string, upper: string) => ({ lower, upper }) },
  indexedDB: { open() { const req: Request = {}; later(() => { req.result = fakeDb; req.onupgradeneeded?.(); req.onsuccess?.(); }); return req; } },
});

// ---- the runtime: files.uploadChunk and ui.saveDraft
const { rpc } = await import('../../../src/ui/lib/rpc.ts');
const chunks: Array<Record<string, unknown>> = [];
const saves: Array<Record<string, unknown>> = [];
let failUpload = false;
let gate: Promise<void> | null = null;
(rpc as unknown as { call: unknown }).call = async (method: string, params: Record<string, unknown>) => {
  if (method === 'ui.saveDraft') { saves.push(params); return { ok: true }; }
  if (method !== 'files.uploadChunk') return { ok: true };
  if (gate) await gate;
  if (failUpload) throw new Error('The connection to the PC was lost.');
  chunks.push(params);
  return params.final ? { received: 1, file: { id: 'f'.repeat(64), name: params.name, mime: params.mime, size: 5, createdAt: 1 } } : { received: 1 };
};

const { session } = await import('../../../src/ui/lib/session.ts');
const { draftFor, updateDraft } = await import('../../../src/ui/chat/composer/draft.ts');
const { saveTake, loadTake } = await import('../../../src/ui/pwa/idb.ts');
const { holdTake, releaseTake } = await import('../../../src/ui/blocks/ui/media-devices.ts');
const { MEDIA_MAX_BYTES, attachTake, attachingTake, holdsTake, isMedia, photoName, recordKey, recordName, uploadMedia } = await import('../../../src/ui/chat/composer/record-take.ts');

session.value = { kind: 'owner', capabilities: [], secure: true, allowedMethods: [] };
const take = (text = 'voice', mime = 'audio/webm;codecs=opus') => ({ blob: new Blob([text], { type: mime }), mime });
const store = (chat: string) => saveTake(recordKey(chat), { blob: new Blob(['voice'], { type: 'audio/webm' }), mime: 'audio/webm', seconds: 4, at: Date.now() });

test('a take goes into the draft as a chip: chunked, the draft saved at once, then the stored copy goes', async () => {
  chunks.length = 0; saves.length = 0;
  updateDraft('ch_rec', { text: 'listen', attachments: [{ fileId: 'a'.repeat(64), name: 'plan.pdf', mime: 'application/pdf', size: 3 }] });
  await store('ch_rec');
  assert.ok(await loadTake(recordKey('ch_rec')), 'kept until the draft holds it');
  const progress: number[] = [];
  const attachment = await attachTake('ch_rec', take(), { onProgress: (ratio) => progress.push(ratio), now: new Date(2026, 10, 16, 14, 3) });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].name, 'Recording 2026-11-16 14-03.webm');
  assert.equal(chunks[0].mime, 'audio/webm', 'the codecs parameter is not part of the stored type');
  assert.equal(chunks[0].conversationId, undefined, 'the owner\'s upload carries no chat id');
  assert.deepEqual(progress, [1]);
  assert.equal(attachment.mime, 'audio/webm');
  const draft = draftFor('ch_rec').peek();
  assert.deepEqual(draft.attachments.map((entry) => entry.name), ['plan.pdf', 'Recording 2026-11-16 14-03.webm'], 'after the files already there');
  assert.equal(draft.text, 'listen');
  assert.equal(saves.at(-1)?.conversationId, 'ch_rec');
  assert.equal((saves.at(-1)?.attachments as unknown[]).length, 2, 'the chip is in the saved draft');
  assert.equal(await loadTake(recordKey('ch_rec')), undefined, 'the stored copy went after that');
});

test('a failed upload rejects and keeps the stored copy; the next Attach goes in once', async () => {
  updateDraft('ch_fail', { text: '', attachments: [] });
  await store('ch_fail');
  failUpload = true;
  await assert.rejects(attachTake('ch_fail', take()), /connection to the PC was lost/);
  failUpload = false;
  assert.equal(draftFor('ch_fail').peek().attachments.length, 0, 'no chip');
  assert.ok(await loadTake(recordKey('ch_fail')), 'the take waits for Attach or the next visit');
  assert.equal(attachingTake('ch_fail'), undefined, 'nothing is on its way any more');
  await attachTake('ch_fail', take());
  assert.equal(draftFor('ch_fail').peek().attachments.length, 1);
  await attachTake('ch_fail', take());
  assert.equal(draftFor('ch_fail').peek().attachments.length, 1, 'the same bytes (one file id) are one chip');
});

test('a second Attach while one runs joins it: one upload, one chip; Send waits meanwhile', async () => {
  chunks.length = 0;
  updateDraft('ch_twice', { text: '', attachments: [] });
  let open!: () => void;
  gate = new Promise((resolve) => { open = resolve; });
  const first = attachTake('ch_twice', take());
  const second = attachTake('ch_twice', take('other'));
  assert.equal(first, second, 'the same job');
  assert.ok(attachingTake('ch_twice'));
  assert.equal(holdsTake('ch_twice'), true, 'Send waits while it attaches');
  assert.equal(holdsTake('ch_other'), false, 'another chat sends');
  open();
  gate = null;
  await Promise.all([first, second]);
  assert.equal(chunks.length, 1, 'one upload');
  assert.equal(draftFor('ch_twice').peek().attachments.length, 1, 'one chip');
  assert.equal(holdsTake('ch_twice'), false);
});

test('Send waits while the chat\'s recorder holds a take (the take guard under the composer\'s key)', () => {
  const holder = {};
  holdTake(recordKey('ch_guard'), holder, () => undefined);
  assert.equal(holdsTake('ch_guard'), true);
  releaseTake(recordKey('ch_guard'), holder);
  assert.equal(holdsTake('ch_guard'), false);
  assert.equal(recordKey('ch_guard'), 'compose:ch_guard', 'never an ask widget\'s key');
});

test('a person\'s device uploads with the chat\'s id; a camera file keeps its own name', async (t) => {
  t.after(() => { session.value = { kind: 'owner', capabilities: [], secure: true, allowedMethods: [] }; });
  session.value = { kind: 'person', capabilities: [], secure: true, allowedMethods: [] } as unknown as typeof session.value;
  chunks.length = 0;
  updateDraft('ch_person', { text: '', attachments: [] });
  const file = new File(['clip'], 'VID_20261116_140300.mp4', { type: 'video/mp4' });
  await attachTake('ch_person', { blob: file, mime: file.type });
  assert.equal(chunks[0].conversationId, 'ch_person');
  assert.equal(chunks[0].name, 'VID_20261116_140300.mp4');
  assert.equal(chunks[0].mime, 'video/mp4');
});

test('a take above what one chunked upload carries is refused before a byte goes, and waits for Retake', async () => {
  chunks.length = 0;
  updateDraft('ch_big', { text: '', attachments: [] });
  await store('ch_big');
  const big = { size: MEDIA_MAX_BYTES + 1, type: 'video/webm', slice: () => { throw new Error('read'); } } as unknown as Blob;
  await assert.rejects(uploadMedia(big, 'Video.webm', 'ch_big'), /larger than 300 MB/);
  assert.equal(chunks.length, 0);
  assert.ok(await loadTake(recordKey('ch_big')), 'the stored take stays');
});

test('names and kinds: no colon in a name; recordings and videos are media, pictures and documents are not', () => {
  const at = new Date(2026, 0, 2, 3, 4);
  assert.equal(recordName('video/webm', at), 'Video 2026-01-02 03-04.webm');
  assert.equal(recordName('audio/mp4', at), 'Recording 2026-01-02 03-04.m4a');
  assert.equal(recordName('video/mp4', at), 'Video 2026-01-02 03-04.mp4');
  assert.equal(recordName('video/quicktime', at), 'Video 2026-01-02 03-04.mov');
  assert.equal(photoName(at), 'Photo 2026-01-02 03-04.jpg');
  assert.ok(![recordName('audio/webm', at), photoName(at)].some((name) => name.includes(':')));
  assert.deepEqual(['audio/webm', 'video/mp4', 'image/jpeg', 'application/pdf', ''].map((type) => isMedia({ type })), [true, true, false, false, false]);
});
