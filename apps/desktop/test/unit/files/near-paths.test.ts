// Similar existing paths for a missing one (src/runtime/files/near-paths.ts, B-081): the likeness of two names, and the
// search on a temp tree – a typo in a middle folder, a wrong extension, nothing similar, a missing root, the bounds.
// Owns: these assertions only. Never: network, Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { likeness, NEAR_MAX, nearPaths } from '../../../src/runtime/files/near-paths.ts';

function tree() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wf-near-'));
  mkdirSync(path.join(dir, 'Proactive Agent Workforce', 'code', 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'Proactive Agent Workforce', 'code', 'docs', 'BUILD_LOG.md'), '');
  writeFileSync(path.join(dir, 'Proactive Agent Workforce', 'code', 'docs', 'OFFEN.md'), '');
  writeFileSync(path.join(dir, 'notes.md'), '');
  writeFileSync(path.join(dir, 'notes.txt'), '');
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('likeness: case, accents and separators do not count; a typo still scores, an unrelated name does not', () => {
  assert.equal(likeness('README.md', 'readme.md'), 1, 'case only');
  assert.equal(likeness('Müller', 'muller'), 1);
  assert.equal(likeness('build-log', 'BUILD_LOG'), 1);
  assert.ok(likeness('docx', 'docs') >= 0.5);
  assert.ok(likeness('Proactiv Agent', 'Proactive Agent Workforce') >= 0.5);
  assert.equal(likeness('src', 'srcc'), 0.9, 'one is the start of the other');
  assert.equal(likeness('report', 'my-report'), 0.8, 'one inside the other');
  assert.ok(likeness('a', 'apple') < 0.5, 'a single letter is no start');
  assert.ok(likeness('invoice.pdf', 'holiday.jpg') < 0.5);
  assert.equal(likeness('', 'x'), 0);
});

test('nearPaths follows a typo in a middle folder down to the real path, and names the nearest folder last', async (t) => {
  const { dir, done } = tree();
  t.after(done);
  const near = await nearPaths(path.join(dir, 'Proactiv Agent Workforce', 'code', 'docs', 'BUILD_LOG.md'));
  assert.equal(near[0].path, path.join(dir, 'Proactive Agent Workforce', 'code', 'docs', 'BUILD_LOG.md'));
  assert.equal(near[0].folder, false);
  assert.deepEqual(near.at(-1), { name: path.basename(dir), path: dir, folder: true });

  const ext = await nearPaths(path.join(dir, 'notes.mdx'));
  assert.equal(ext[0].path, path.join(dir, 'notes.md'), 'the closer sibling first');
  assert.ok(ext.some((entry) => entry.path === path.join(dir, 'notes.txt')), 'the other extension too');

  const folder = await nearPaths(path.join(dir, 'Proactive Agent Workforce', 'cod'));
  assert.deepEqual(folder[0], { name: 'code', path: path.join(dir, 'Proactive Agent Workforce', 'code'), folder: true });
});

test('nothing similar gives only the nearest folder; deeper matches that stop keep the folder they reached', async (t) => {
  const { dir, done } = tree();
  t.after(done);
  assert.deepEqual(await nearPaths(path.join(dir, 'zzqq', 'x.md')), [{ name: path.basename(dir), path: dir, folder: true }]);
  const partial = await nearPaths(path.join(dir, 'Proactive Agent Workforce', 'kode', 'qqzz.md'));
  assert.equal(partial[0].path, path.join(dir, 'Proactive Agent Workforce', 'code'), 'the folder the match reached');
  assert.equal(partial.at(-1)?.path, path.join(dir, 'Proactive Agent Workforce'));
});

test('a missing root gives nothing; an answer holds at most NEAR_MAX rows', async (t) => {
  const { dir, done } = tree();
  t.after(done);
  if (process.platform === 'win32') {
    const free = 'QRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`).find((root) => !existsSync(root));
    if (free) assert.deepEqual(await nearPaths(path.join(free, 'a', 'b.md')), []);
  }
  for (let i = 0; i < 12; i++) writeFileSync(path.join(dir, `report-${i}.md`), '');
  const many = await nearPaths(path.join(dir, 'report.md'));
  assert.equal(many.length, NEAR_MAX);
  assert.equal(many.at(-1)?.path, dir);
});
