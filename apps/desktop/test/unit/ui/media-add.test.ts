// B-084 (decision 12) media from and to the phone: Media › "Add files" stores each file and, inside a phone app, tags
// it 'from phone' while keeping its tags (ui/workspace/media-add.ts); MediaView's "Save to phone" hands the bytes to
// the app over its port, a plain browser saves a blob link (no token in its download list), else the same-origin
// /files link with download=1 (ui/workspace/media-save.ts); the
// .tsx files are read as text (a .tsx file does not load here): one fixed plus button with a hidden multi-file field,
// Save on the desktop without the old linked-PC gate, Save to phone / Download off the desktop.
// Owns: these assertions with fakes. Never: a browser, a WebView or the runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { MediaInfo } from '../../../src/shared/model/media.ts';
import type { FileRef } from '../../../src/shared/model/system.ts';
import { PHONE_TAG, addFiles } from '../../../src/ui/workspace/media-add.ts';
import { downloadUrl, saveFile, type SaveDeps } from '../../../src/ui/workspace/media-save.ts';
import { PHONE_DOWNLOAD_MAX } from '../../../src/ui/pwa/phone-download.ts';

const ID = 'b'.repeat(64);
const ref = (name: string, size = 3): FileRef => ({ id: `${name.length}`.padStart(64, 'c'), name, mime: 'image/jpeg', size, createdAt: 0 });

function fakeMedia(tags: Record<string, string[] | undefined> = {}) {
  const calls: Array<{ fileId: string; tags?: string[] }> = [];
  const uploads: string[] = [];
  return {
    calls, uploads,
    upload: async (file: File) => {
      if (file.name === 'broken.jpg') throw new Error('broken.jpg is larger than 20 MB.');
      uploads.push(file.name);
      return ref(file.name);
    },
    describe: async (params: { fileId: string; tags?: string[] }) => {
      calls.push(params);
      return { fileId: params.fileId, tags: params.tags ?? tags[params.fileId] } as MediaInfo;
    },
  };
}

test('desktop: each file is stored, nothing is tagged', async () => {
  const media = fakeMedia();
  const failed = await addFiles([new File(['a'], 'a.jpg'), new File(['bb'], 'bb.png')], { ...media, phone: false });
  assert.deepEqual(failed, []);
  assert.deepEqual(media.uploads, ['a.jpg', 'bb.png']);
  assert.deepEqual(media.calls, []);
});

test('phone app: stored, then tagged from phone; tags it had stay, a tagged file is not written again', async () => {
  const media = fakeMedia({ [ref('old.jpg').id]: ['ops'], [ref('again.jpg').id]: [PHONE_TAG] });
  const failed = await addFiles([new File(['a'], 'a.jpg'), new File(['o'], 'old.jpg'), new File(['g'], 'again.jpg')], { ...media, phone: true });
  assert.deepEqual(failed, []);
  assert.equal(PHONE_TAG, 'from phone');
  assert.deepEqual(media.calls, [
    { fileId: ref('a.jpg').id }, { fileId: ref('a.jpg').id, tags: [PHONE_TAG] },
    { fileId: ref('old.jpg').id }, { fileId: ref('old.jpg').id, tags: ['ops', PHONE_TAG] },
    { fileId: ref('again.jpg').id },
  ]);
});

test('one failing file is reported and the others still go up', async () => {
  const media = fakeMedia();
  const failed = await addFiles([new File(['x'], 'broken.jpg'), new File(['a'], 'a.jpg')], { ...media, phone: true });
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.name, 'broken.jpg');
  assert.match(String(failed[0]?.error), /larger than 20 MB/);
  assert.deepEqual(media.uploads, ['a.jpg']);
});

function saver(options: { port?: boolean; app?: boolean; url?: string | null; browser?: boolean } = {}) {
  const log: string[] = [];
  const deps: SaveDeps = {
    url: (id) => (options.url === undefined ? `https://pc.local/files/${id}?token=t0k` : options.url),
    port: () => options.port ?? false,
    blobs: () => options.browser ?? false,
    fetchBlob: async (url) => { log.push(`fetch ${url}`); return new Blob(['bytes']); },
    toPhone: async (_blob, name) => { log.push(`phone ${name}`); return options.app ?? true; },
    follow: (url, name) => { log.push(`link ${url} ${name}`); },
    saveBlob: (blob, name) => { log.push(`blob ${blob.size} ${name}`); },
  };
  return { deps, log };
}

test('download link: the stream URL plus download=1', () => {
  assert.equal(downloadUrl(ID, (id) => `https://pc.local/files/${id}?token=t`), `https://pc.local/files/${ID}?token=t&download=1`);
  assert.equal(downloadUrl(ID, (id) => `/files/${id}`), `/files/${ID}?download=1`);
  assert.equal(downloadUrl(ID, () => null), null);
});

test('Save to phone: the app takes the bytes over its port', async () => {
  const { deps, log } = saver({ port: true });
  assert.equal(await saveFile(ref('photo.jpg'), deps), 'phone');
  assert.deepEqual(log, [`fetch https://pc.local/files/${ref('photo.jpg').id}?token=t0k`, 'phone photo.jpg']);
});

test('Save to phone: without a port, too large, or the app refusing → the download link', async () => {
  const id = ref('photo.jpg').id;
  const link = `link https://pc.local/files/${id}?token=t0k&download=1 photo.jpg`;
  const none = saver();
  assert.equal(await saveFile(ref('photo.jpg'), none.deps), 'link');
  assert.deepEqual(none.log, [link]);
  const big = saver({ port: true });
  assert.equal(await saveFile(ref('photo.jpg', PHONE_DOWNLOAD_MAX + 1), big.deps), 'link');
  assert.deepEqual(big.log, [link], 'never fetched into memory');
  const refused = saver({ port: true, app: false });
  assert.equal(await saveFile(ref('photo.jpg'), refused.deps), 'link');
  assert.deepEqual(refused.log.slice(1), ['phone photo.jpg', link]);
});

test('Download in a plain browser: the bytes go through a blob link, the token URL never reaches the download list', async () => {
  const id = ref('photo.jpg').id;
  const browser = saver({ browser: true });
  assert.equal(await saveFile(ref('photo.jpg'), browser.deps), 'link');
  assert.deepEqual(browser.log, [`fetch https://pc.local/files/${id}?token=t0k`, 'blob 5 photo.jpg']);
  const big = saver({ browser: true });
  assert.equal(await saveFile(ref('photo.jpg', PHONE_DOWNLOAD_MAX + 1), big.deps), 'link');
  assert.deepEqual(big.log, [`link https://pc.local/files/${id}?token=t0k&download=1 photo.jpg`], 'a big file streams to disk');
});

test('no file route on this page: saving says so', async () => {
  await assert.rejects(saveFile(ref('a.jpg'), saver({ url: null }).deps), /can't be saved here/);
});

const source = (file: string) => readFileSync(new URL(`../../../src/ui/workspace/${file}`, import.meta.url), 'utf8');

test('MediaLibrary: one fixed Add files button in the search row, a hidden multi-file field, spinner in the same box', () => {
  const view = source('MediaLibrary.tsx');
  const row = view.slice(view.indexOf('<div class="pane-search">'), view.indexOf('<div class="new-tab">'));
  assert.match(row, /<AddFiles \/>/);
  assert.match(view, /class="icon-button small" aria-label="Add files"/);
  assert.match(view, /busy \? <Spinner size=\{16\}[^>]*\/> : <Icon name="plus" size=\{16\} \/>/);
  assert.match(view, /<input ref=\{input\} type="file" multiple hidden/);
  assert.match(view, /phone: isPhoneApp\(\)/);
  assert.match(view, /toastError\(error, `Couldn't add \$\{name\}`\)/);
});

test('MediaView: Save on the desktop for stored and linked-PC files, Save to phone / Download off the desktop', () => {
  const view = source('MediaView.tsx');
  assert.doesNotMatch(view, /&& !device &&/, 'the linked-PC gate is gone');
  assert.match(view, /const local = Boolean\(path\) && !device;/);
  assert.match(view, /\{canOpen && !local && <button[^>]*onClick=\{\(\) => open\(true\)\}>Save<\/button>\}/);
  assert.match(view, /\{!desktop && <button[^>]*disabled=\{!file \|\| saving\}[^>]*>\{isPhoneApp\(\) \? 'Save to phone' : 'Download'\}<\/button>\}/);
});
