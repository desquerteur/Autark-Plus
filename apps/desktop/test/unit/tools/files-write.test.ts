// B-080 wave 3 (live 09.11.2026: a receipt screenshot and a 40 kB JSON could not leave a Codex exec script – the only way
// out was the command line, which ends at 32,767 characters: os error 206): files.write (tools/builtin/files.ts) writes
// text as UTF-8 and, with base64: true, bytes – content as plain base64 or a whole data: URL – appended or not, of any
// size up to its schema's bound, since the content travels as an argument.
// Owns: these assertions only. Never: writes outside its temp folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileTools } from '../../../src/runtime/tools/builtin/files.ts';
import type { ToolOutput } from '../../../src/runtime/tools/types.ts';

/** A 1×1 PNG. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201d6b2a2a10000000049454e44ae426082', 'hex');

function world(t: { after(fn: () => void): void }) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'wf-files-write-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const tool = fileTools().find((entry) => entry.name === 'files.write')!;
  const ctx = { services: { paths: { workspace } }, agent: { id: 'ag_a', name: 'Ada' }, runId: 'r1', mode: 'general', signal: new AbortController().signal, status: () => undefined } as never;
  const write = async (args: Record<string, unknown>) => {
    const out = await tool.run(args as never, ctx) as ToolOutput;
    assert.notEqual(out.isError, true, JSON.stringify(out));
    const part = out.content[0];
    return JSON.parse(part.type === 'text' ? part.text : '{}') as { ok: boolean; path: string; bytes: number };
  };
  return { workspace, tool, write };
}

test('files.write: a whole data:image/png URL is written as the exact PNG bytes; bytes is the decoded length', async (t) => {
  const w = world(t);
  const result = await w.write({ path: 'shots/receipt.png', content: `data:image/png;base64,${PNG.toString('base64')}`, base64: true });
  const file = path.join(w.workspace, 'shots', 'receipt.png');
  assert.deepEqual(result, { ok: true, path: file, bytes: PNG.length });
  const written = readFileSync(file);
  assert.deepEqual([...written.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'the PNG signature');
  assert.ok(written.equals(PNG));
});

test('files.write: plain base64 is written as bytes the same way', async (t) => {
  const w = world(t);
  const result = await w.write({ path: 'a.png', content: PNG.toString('base64'), base64: true });
  assert.equal(result.bytes, PNG.length);
  assert.ok(readFileSync(path.join(w.workspace, 'a.png')).equals(PNG));
});

test('files.write: text without base64 stays UTF-8', async (t) => {
  const w = world(t);
  const result = await w.write({ path: 'note.md', content: 'Grüße – ß\n' });
  assert.equal(result.bytes, Buffer.byteLength('Grüße – ß\n'));
  assert.equal(readFileSync(path.join(w.workspace, 'note.md'), 'utf8'), 'Grüße – ß\n');
});

test('files.write: append with base64 appends bytes', async (t) => {
  const w = world(t);
  await w.write({ path: 'bin.dat', content: Buffer.from([1, 2, 3]).toString('base64'), base64: true });
  const result = await w.write({ path: 'bin.dat', content: `data:application/octet-stream;base64,${Buffer.from([0xff, 0x00]).toString('base64')}`, base64: true, append: true });
  assert.equal(result.bytes, 2);
  assert.deepEqual([...readFileSync(path.join(w.workspace, 'bin.dat'))], [1, 2, 3, 0xff, 0x00]);
});

test('files.write: 1 MB of base64 – far past a command line\'s 32,767 characters – is written whole', async (t) => {
  const w = world(t);
  const bytes = Buffer.alloc(768 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
  const content = bytes.toString('base64');
  assert.ok(content.length >= 1024 * 1024);
  const result = await w.write({ path: 'big/blob.bin', content, base64: true });
  assert.equal(result.bytes, bytes.length);
  assert.ok(readFileSync(path.join(w.workspace, 'big', 'blob.bin')).equals(bytes));
});

test('files.write: reachable for every engine (no engine audience), base64 in its schema, content up to 20,000,000 characters', (t) => {
  const w = world(t);
  const tool = w.tool as unknown as { audience?: string; inputSchema: { properties: Record<string, { type: string; maxLength?: number }> }; description: string };
  assert.equal(tool.audience, undefined);
  assert.equal(tool.inputSchema.properties.base64.type, 'boolean');
  assert.equal(tool.inputSchema.properties.content.maxLength, 20_000_000);
  assert.ok(tool.description.startsWith('Creates, overwrites or appends to a file anywhere on this PC, as text or bytes.'), tool.description);
  assert.doesNotMatch(tool.description, /\b(you|must|never|only if|allowed)\b/i, 'first person, facts');
});
