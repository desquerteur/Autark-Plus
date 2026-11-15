// The UI's preview cache (lib/files.ts): object URLs of stored files stay up to a byte cap; past it the least recently
// drawn previews no mounted component holds are freed (revokeObjectURL) and load again when drawn. A held preview and
// the one just loaded are never freed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileUrl, fileUrlReady, holdFileUrl, previewLimit, PREVIEW_KEEP } from '../../../src/ui/lib/files.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';

let next = 0; // object URLs stay unique across tests (a preview of an earlier test may be freed in a later one)

function fakeFiles(t: { after(fn: () => void): void }) {
  const real = rpc.call;
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const reads: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = (() => `blob:fake/${++next}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => { revoked.push(url); }) as typeof URL.revokeObjectURL;
  (rpc as unknown as { call: unknown }).call = async (method: string, params: { id: string }) => {
    assert.equal(method, 'files.read');
    reads.push(params.id);
    return { dataBase64: Buffer.from('0123456789').toString('base64'), mime: 'image/png' }; // 10 bytes each
  };
  previewLimit.bytes = 25; // two previews fit, a third frees one
  t.after(() => { (rpc as unknown as { call: unknown }).call = real; URL.createObjectURL = create; URL.revokeObjectURL = revoke; previewLimit.bytes = PREVIEW_KEEP; });
  return { reads, revoked };
}

const id = (c: string) => c.repeat(64);

test('past the cap the least recently drawn preview goes and loads again when drawn', async (t) => {
  const { reads, revoked } = fakeFiles(t);
  const a = await fileUrlReady(id('1'));
  await fileUrlReady(id('2'));
  fileUrl(id('1')); // drawn again: now the most recent
  await fileUrlReady(id('3'));
  assert.equal(revoked.length, 1, 'one preview freed');
  assert.notEqual(revoked[0], a, 'not the one drawn last');
  assert.deepEqual(reads, [id('1'), id('2'), id('3')]);
  await fileUrlReady(id('2'));
  assert.deepEqual(reads.slice(3), [id('2')], 'a freed preview loads again');
});

test('a held preview is never freed; its release frees it once the cap needs it', async (t) => {
  const { revoked } = fakeFiles(t);
  const a = await fileUrlReady(id('4'));
  const release = holdFileUrl(id('4'));
  const b = await fileUrlReady(id('5'));
  const c = await fileUrlReady(id('6'));
  const d = await fileUrlReady(id('7'));
  assert.ok(!revoked.includes(a), 'held: stays although it was drawn first');
  assert.ok(!revoked.includes(d), 'the one just loaded stays');
  assert.ok(revoked.includes(b) && revoked.includes(c));
  release();
  release(); // a second release changes nothing
  assert.ok(!revoked.includes(a), 'released, but the kept bytes fit: it stays');
  const e = await fileUrlReady(id('8'));
  assert.ok(revoked.includes(a), 'released and the cap needs room: the oldest drawn goes');
  assert.ok(!revoked.includes(d) && !revoked.includes(e));
});
