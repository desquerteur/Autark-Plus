// B-084 (decision 11/12) GET /files/<sha256>?download=1: the same bytes with `Content-Disposition: attachment` and the
// stored name, so a phone's "Save to phone" link (ui/workspace/media-save.ts) or the Android app's DownloadListener
// saves the file instead of showing it; without it the answer stays inline. Real HttpServer on loopback.
// Owns: these assertions. Never: the other /files rules (server.test.ts, files-pull.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineDisposition } from '../../../src/runtime/http/files.ts';
import { BLOB_ID, BLOB_TEXT, DEVICE_TOKEN, fixture, request } from './fixture.ts';

test('download=1 answers attachment with the stored name; without it inline', async () => {
  const f = fixture();
  try {
    const { port } = await f.server.listen();
    const saved = await request(port, { path: `/files/${BLOB_ID}?token=${DEVICE_TOKEN}&download=1` });
    assert.equal(saved.status, 200);
    assert.equal(saved.text, BLOB_TEXT);
    assert.equal(saved.headers['content-disposition'], `attachment; filename="clip _.webm"; filename*=UTF-8''clip%20%C3%A4.webm`);
    assert.match(String(saved.headers['content-security-policy']), /sandbox/, 'the protective headers stay');
    const shown = await request(port, { path: `/files/${BLOB_ID}?token=${DEVICE_TOKEN}` });
    assert.match(String(shown.headers['content-disposition']), /^inline; /);
    const other = await request(port, { path: `/files/${BLOB_ID}?token=${DEVICE_TOKEN}&download=yes` });
    assert.match(String(other.headers['content-disposition']), /^inline; /, 'only download=1 saves');
    assert.equal((await request(port, { path: `/files/${BLOB_ID}?download=1` })).status, 401, 'still no file without a token');
  } finally {
    await f.close();
  }
});

test('the disposition keeps quotes and control characters out of the name', () => {
  assert.equal(inlineDisposition('a"b\\c\n.pdf', 'attachment'), `attachment; filename="a_b_c_.pdf"; filename*=UTF-8''a_b_c_.pdf`);
  assert.equal(inlineDisposition(''), `inline; filename="file"; filename*=UTF-8''file`);
});
