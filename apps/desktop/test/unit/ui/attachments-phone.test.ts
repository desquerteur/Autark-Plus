// B-084 G1: a file chip on the phone – everything the media layer shows opens in the chat's area (as on the desktop),
// any other file is saved (the Android app: its Downloads over the port; a browser: a download), and the first tap on a
// chip whose bytes are not loaded yet waits for them (lib/files.ts fileUrlReady) instead of doing nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUrl, fileUrlReady } from '../../../src/ui/lib/files.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';
import { textKind, viewKind } from '../../../src/ui/workspace/media-facts.ts';
import { APP_CSP } from '../../../src/runtime/http/static.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (name: string): string => readFileSync(path.join(ROOT, name), 'utf8');

function fakeFiles(t: { after(fn: () => void): void }, fail = new Set<string>()) {
  const real = rpc.call;
  const create = URL.createObjectURL;
  const reads: string[] = [];
  let next = 0;
  URL.createObjectURL = (() => `blob:fake/${++next}`) as typeof URL.createObjectURL;
  (rpc as unknown as { call: unknown }).call = async (method: string, params: { id: string }) => {
    assert.equal(method, 'files.read');
    reads.push(params.id);
    if (fail.has(params.id)) { fail.delete(params.id); throw new Error('offline'); }
    return { dataBase64: Buffer.from('bytes').toString('base64'), mime: 'application/zip' };
  };
  t.after(() => { (rpc as unknown as { call: unknown }).call = real; URL.createObjectURL = create; });
  return reads;
}

test('a first tap waits for the bytes: fileUrlReady resolves before any preview loaded, one read shared with fileUrl', async (t) => {
  const reads = fakeFiles(t);
  const id = 'f'.repeat(64);
  const url = await fileUrlReady(id);
  assert.match(url, /^blob:fake\//);
  const preview = fileUrl(id);
  await fileUrlReady(id);
  await Promise.resolve();
  assert.equal(preview.value, url, 'the preview signal gets the same object URL');
  assert.deepEqual(reads, [id], 'one files.read for both');
});

test('a failed load is forgotten: the next tap reads again', async (t) => {
  const id = 'e'.repeat(64);
  const reads = fakeFiles(t, new Set([id]));
  await assert.rejects(fileUrlReady(id), /offline/);
  assert.match(await fileUrlReady(id), /^blob:fake\//);
  assert.deepEqual(reads, [id, id]);
});

test('on the phone a chip opens in the chat area for what the media layer shows; other files are saved', () => {
  const source = read('src/ui/chat/Attachments.tsx');
  assert.match(source, /export function opensInPane\(attachment: Attachment, desktop = platform === 'desktop'\): boolean \{/);
  assert.match(source, /if \(desktop\) return attachment\.mime\.startsWith\('image\/'\) \|\| attachment\.mime\.startsWith\('video\/'\);/);
  assert.match(source, /return viewKind\(attachment\.mime, attachment\.name\) !== 'file' \|\| textKind\(attachment\.mime, attachment\.name\) !== null;/);
  // the phone path: the Android app saves as the Media tab does (its /files route), a browser waits for the bytes
  assert.match(source, /if \(isAndroidApp\(\)\) \{ await saveFile\(\{ id: attachment\.fileId,/);
  assert.match(source, /const url = await fileUrlReady\(attachment\.fileId\);/);
  // 17.11.2026 "Could not open file · Failed to fetch": the page's CSP has no connect to blob:, so no fetch() of one here
  assert.doesNotMatch(source, /fetch\(url\)/);
  assert.doesNotMatch(source, /fileUrl\(attachment\.fileId\)\.value;\s*if \(!url\) return;/, 'no silent first tap');
  // what the layer shows (pure viewKind): image, video, recording, PDF – a zip is saved
  assert.deepEqual(['image/png', 'video/mp4', 'audio/ogg', 'application/pdf', 'application/zip'].map((mime) => viewKind(mime, 'x')), ['image', 'video', 'audio', 'pdf', 'file']);
  assert.equal(viewKind('application/octet-stream', 'clip.mov'), 'video', 'by its name too');
});

test('Settings › Devices › Connection reaches my phone: no platform gate, the can() gates stay', () => {
  const group = read('src/ui/settings/DevicesGroup.tsx');
  assert.match(group, /\{can\('settings\.update'\) && can\('remote\.relay'\) && <ConnectionGroup /);
  assert.doesNotMatch(group, /platform === 'desktop' && can\('settings\.update'\)/);
});

test('17.11.2026: an agent Markdown or text attachment reads in the phone Media tab; the desktop keeps its own app', () => {
  // opensInPane (Attachments.tsx, JSX – read as source): the desktop's rule is unchanged, the phone adds textKind
  const phone = (mime: string, name: string) => viewKind(mime, name) !== 'file' || textKind(mime, name) !== null;
  assert.equal(phone('text/markdown', 'PROMPT-GROSSE-SITZUNG.md'), true, 'phone: in the chat area');
  assert.equal(phone('text/plain', 'notes.txt'), true);
  assert.equal(phone('application/zip', 'data.zip'), false, 'a zip is still saved');
  assert.equal(textKind('text/markdown', 'x.md'), 'markdown');
  assert.equal(textKind('application/octet-stream', 'README.markdown'), 'markdown', 'by its name too');
  assert.equal(textKind('text/plain; charset=utf-8', 'a'), 'plain');
  assert.equal(textKind('application/json', 'a'), 'plain');
  assert.equal(textKind('application/pdf', 'a.pdf'), null, 'a PDF stays the PDF view');
  assert.equal(textKind('image/png', 'a.md.png'), null);
  assert.equal(textKind('application/zip', 'a.zip'), null);
  const view = read('src/ui/workspace/MediaView.tsx');
  assert.match(view, /else if \(text\) stage = <TextStage file=\{file\} kind=\{text\} \/>;/);
  assert.match(view, /rpc\.call\('files\.read', \{ id: file\.id, maxBytes: TEXT_VIEW_MAX \}\)/);
});

test('17.11.2026: the app page may read its own blob: URLs (connect-src)', () => {
  assert.match(APP_CSP, /connect-src 'self' ws: wss: blob:( https:\/\/firestore\.googleapis\.com)?(;|$)/); // 18.11.: the phone's own feedback upload
});
