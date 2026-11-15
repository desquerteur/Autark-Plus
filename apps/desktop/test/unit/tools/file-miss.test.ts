// B-080 (live 05.–08.11.2026: 198 reads of a path that does not exist, the answer only "No file at X."): a miss of
// files.read, files.list, files.search and media.view shows what is there (tools/builtin/file-miss.ts missText) – the
// old first line, the folder a relative path counts from, the nearest folder's listing (folders first, hidden entries
// left out, at most 40), the entries of exactly that name below the nearest folder, my own folder and the workspace
// (bounded: 15,000 entries, 1.5 s; no dependency folders; a nearest folder holding the workspace after it), and for a
// linked PC's call the listing only. B-080 wave 3: the first missing folder of the path is looked for too ("The file lies
// at:", "A folder named … lies at:"), the walk goes on one folder above the nearest one, the workspace is no broad folder.
// Review: a first missing folder without the rest takes no hit slot; a drive root, the home folder and a folder above my
// own folder or the workspace are never that next folder (searchRoots).
// Owns: these assertions only. Never: writes outside its temp folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileTools } from '../../../src/runtime/tools/builtin/files.ts';
import { mediaView } from '../../../src/runtime/tools/builtin/media-view.ts';
import { MISS_ENTRIES, MISS_MS, searchRoots } from '../../../src/runtime/tools/builtin/file-miss.ts';
import type { ToolOutput } from '../../../src/runtime/tools/types.ts';

function world() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wf-file-miss-'));
  const workspace = path.join(root, 'ws');
  const put = (rel: string, body = 'x\n') => { const file = path.join(workspace, rel); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, body); };
  put(path.join('a', 'b', 'OWNER-CURRENT.md'));
  put(path.join('a', 'b', 'alpha.md'));
  put(path.join('a', 'b', '.hidden-note'));
  mkdirSync(path.join(workspace, 'a', 'b', 'g01'), { recursive: true });
  mkdirSync(path.join(workspace, 'a', 'b', 'Zeta'), { recursive: true });
  put(path.join('x', 'merge.py'));
  put(path.join('x', 'node_modules', 'pkg', 'merge.py'));
  const tools = fileTools();
  const services = { paths: { workspace }, secrets: { redact: (value: string) => value } };
  const ctx = (extra: Record<string, unknown> = {}) => ({ services, agent: { id: 'ag_a', name: 'Ada' }, runId: 'r1', mode: 'general', signal: new AbortController().signal, status: () => undefined, ...extra }) as never;
  const run = async (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const tool = name === 'media.view' ? mediaView : tools.find((entry) => entry.name === name)!;
    const out = await tool.run(args as never, ctx(extra)) as ToolOutput;
    return { error: out.isError === true, lines: out.content.map((part) => ('text' in part ? part.text : '')).join('').split('\n') };
  };
  return { root, workspace, put, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('files.read of a missing file: the old first line, where a relative path counts from, the nearest folder and that no file has the name', async () => {
  const w = world();
  try {
    const { error, lines } = await w.run('files.read', { path: 'a/b/README.md' });
    assert.equal(error, true);
    assert.deepEqual(lines, [
      `No file at a/b/README.md (a relative path counts from the workspace ${w.workspace}).`,
      `${path.join(w.workspace, 'a', 'b')} holds: g01/, Zeta/, alpha.md, OWNER-CURRENT.md`,
      `No file named README.md below ${path.join(w.workspace, 'a', 'b')}, ${path.join(w.workspace, 'a')} and ${w.workspace}.`, // B-080 wave 3: a/b, then one folder above it
    ]);
  } finally { w.cleanup(); }
});

// B-080 wave 3 (live 09.11.2026: "konrad-ultra-20261109/handoff.json" – the folder lay deeper in the workspace).
test('a first missing folder that exists elsewhere without the rest of the path is named as a folder', async () => {
  const w = world();
  try {
    w.put(path.join('x', 'y', 'konrad-ultra', 'notes.md'));
    const { error, lines } = await w.run('files.read', { path: 'konrad-ultra/handoff.json' });
    assert.equal(error, true);
    assert.deepEqual(lines.slice(2), [`No file named handoff.json below ${w.workspace}.`, 'A folder named konrad-ultra lies at:', path.join(w.workspace, 'x', 'y', 'konrad-ultra')]);
  } finally { w.cleanup(); }
});

// B-080 wave 3 review (probe: p0…p5/src beside zz/deep/report-2026.md – five unrelated src folders filled every slot and
// the file was no longer named): a first missing folder without the rest of the path is named aside.
test('a common first missing folder never pushes out the file of that name', async () => {
  const w = world();
  try {
    for (let i = 0; i < 6; i++) mkdirSync(path.join(w.workspace, `p${i}`, 'src'), { recursive: true });
    w.put(path.join('zz', 'deep', 'report-2026.md'));
    const { lines } = await w.run('files.read', { path: 'src/report-2026.md' });
    assert.deepEqual(lines.slice(2), [
      'A file named report-2026.md lies at:', path.join(w.workspace, 'zz', 'deep', 'report-2026.md'),
      'A folder named src lies at (the first 5 found):', ...[0, 1, 2, 3, 4].map((i) => path.join(w.workspace, `p${i}`, 'src')),
    ], lines.join('\n'));
    w.put(path.join('p5', 'src', 'report-2026.md'));
    const whole = await w.run('files.read', { path: 'src/report-2026.md' });
    assert.deepEqual(whole.lines.slice(2, 4), ['The file lies at:', path.join(w.workspace, 'p5', 'src', 'report-2026.md')], whole.lines.join('\n'));
    assert.ok(whole.lines.includes(path.join(w.workspace, 'zz', 'deep', 'report-2026.md')), 'the other file of that name still named');
  } finally { w.cleanup(); }
});

test('searchRoots: the nearest folder first, the one above it unless it is a drive root, the home folder or above my folders', () => {
  const home = os.homedir();
  const drive = path.parse(home).root; // the test folders lie on the home folder's drive, outside it
  const at = (...parts: string[]) => path.join(drive, ...parts);
  const roots = (workspace: string, near: string, own = at('wf-none-own')) => searchRoots({ services: { paths: { workspace } }, split: { cwd: own }, agent: { id: 'ag_a' } } as never, near);
  const ws = at('wf-none-ws');
  assert.deepEqual(roots(ws, at('wf-none-p', 'q')), [at('wf-none-p', 'q'), at('wf-none-p'), at('wf-none-own'), ws], 'the parent of a sibling folder next');
  assert.deepEqual(roots(ws, at('wf-none-a')), [at('wf-none-a'), at('wf-none-own'), ws], 'a drive root is left out');
  assert.deepEqual(roots(ws, path.join(home, 'Documents')), [path.join(home, 'Documents'), at('wf-none-own'), ws], 'the home folder is left out');
  assert.deepEqual(roots(at('wf-none-p', 'ws'), at('wf-none-p', 'q')), [at('wf-none-p', 'q'), at('wf-none-own'), at('wf-none-p', 'ws')], 'a folder above the workspace is left out');
  assert.deepEqual(roots(at('wf-none-p', 'ws'), at('wf-none-p')), [at('wf-none-own'), at('wf-none-p', 'ws'), at('wf-none-p')], 'a nearest folder above the workspace goes last');
  assert.deepEqual(roots(ws, at('wf-none-own', 'x'), at('wf-none-own')), [at('wf-none-own', 'x'), at('wf-none-own'), ws], 'my own folder once');
});

test('files.read one folder off: the file of that name is named by its absolute path (no dependency folders)', async () => {
  const w = world();
  try {
    const { lines } = await w.run('files.read', { path: path.join(w.workspace, 'a', 'c', 'MERGE.py') });
    assert.equal(lines[0], `No file at ${path.join(w.workspace, 'a', 'c', 'MERGE.py')}.`, 'an absolute path: no note');
    assert.equal(lines[1], `${path.join(w.workspace, 'a')} holds: b/`);
    assert.deepEqual(lines.slice(2), ['A file named MERGE.py lies at:', path.join(w.workspace, 'x', 'merge.py')], 'case ignored, node_modules left out');
  } finally { w.cleanup(); }
});

test('files.read of a folder says so and lists it; files.list of a missing folder lists the nearest one', async () => {
  const w = world();
  try {
    const folder = await w.run('files.read', { path: 'a/b' });
    assert.equal(folder.error, true);
    assert.deepEqual(folder.lines, ['No file at a/b – that is a folder.', `${path.join(w.workspace, 'a', 'b')} holds: g01/, Zeta/, alpha.md, OWNER-CURRENT.md`]);
    const list = await w.run('files.list', { path: 'zz/q' });
    assert.equal(list.error, true);
    assert.deepEqual(list.lines, [
      `No folder at zz/q (a relative path counts from the workspace ${w.workspace}).`,
      `${w.workspace} holds: a/, x/`,
      `No folder named q below ${w.workspace}.`,
    ]);
    const g = await w.run('files.list', { path: 'x/g01' });
    assert.deepEqual(g.lines.slice(2), ['A folder named g01 lies at:', path.join(w.workspace, 'a', 'b', 'g01')], 'below the workspace');
    const file = await w.run('files.list', { path: 'x/merge.py' });
    assert.deepEqual(file.lines, ['No folder at x/merge.py – that is a file.', `${path.join(w.workspace, 'x')} holds: node_modules/, merge.py`], 'a file: its folder, no name search');
  } finally { w.cleanup(); }
});

test('files.search with a path that is no folder and media.view of a missing image answer the same way', async () => {
  const w = world();
  try {
    const search = await w.run('files.search', { query: 'plan', path: 'a/zz' });
    assert.equal(search.error, true);
    assert.equal(search.lines[0], `No folder at a/zz (a relative path counts from the workspace ${w.workspace}).`);
    assert.equal(search.lines[1], `${path.join(w.workspace, 'a')} holds: b/`);
    const view = await w.run('media.view', { path: 'a/b/shot.png' });
    assert.equal(view.error, true);
    assert.equal(view.lines[0], `No file at a/b/shot.png (a relative path counts from the workspace ${w.workspace}).`);
    assert.equal(view.lines[1], `${path.join(w.workspace, 'a', 'b')} holds: g01/, Zeta/, alpha.md, OWNER-CURRENT.md`);
  } finally { w.cleanup(); }
});

// B-080 review (probe: a miss of C:\AGENTS.md named AGENTS.md files elsewhere on C: and not the workspace's own): a
// nearest folder that holds the workspace is walked after it, so the bounds reach the workspace first.
test('a guess at <broad folder>/AGENTS.md names the workspace\'s own AGENTS.md first', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wf-file-miss-broad-'));
  try {
    const broad = path.join(root, 'broad');
    const workspace = path.join(broad, 'zz', 'ws');
    const others = ['a1', 'a2', 'a3', 'a4', 'a5'].map((name) => path.join(broad, name, 'AGENTS.md'));
    for (const file of [...others, path.join(workspace, 'AGENTS.md')]) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, 'x\n'); }
    const read = fileTools().find((entry) => entry.name === 'files.read')!;
    const services = { paths: { workspace }, secrets: { redact: (value: string) => value } };
    const ctx = { services, agent: { id: 'ag_a', name: 'Ada' }, runId: 'r1', mode: 'general', signal: new AbortController().signal, status: () => undefined } as never;
    const out = await read.run({ path: path.join(broad, 'AGENTS.md') } as never, ctx) as ToolOutput;
    const lines = out.content.map((part) => ('text' in part ? part.text : '')).join('').split('\n');
    assert.deepEqual(lines.slice(0, 3), [`No file at ${path.join(broad, 'AGENTS.md')}.`, `${broad} holds: a1/, a2/, a3/, a4/, a5/, zz/`, 'A file named AGENTS.md lies at (the first 5 found):']);
    assert.deepEqual(lines.slice(3), [path.join(workspace, 'AGENTS.md'), ...others.slice(0, 4)], 'the workspace first, then the nearest folder with what is left of the bounds');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a call from a linked PC gets the listing only', async () => {
  const w = world();
  try {
    const { lines } = await w.run('files.read', { path: 'a/c/merge.py' }, { fromPc: 'laptop' });
    assert.deepEqual(lines, [`No file at a/c/merge.py (a relative path counts from the workspace ${w.workspace}).`, `${path.join(w.workspace, 'a')} holds: b/`]);
  } finally { w.cleanup(); }
});

/** A path as a literal inside a RegExp. */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// B-080 wave 3 (live 09.11.2026: a guessed root that skipped middle folders, a file moved from outbox to journal, and a
// miss in the workspace beside a big own folder all ended at the bounds): one big folder, past MISS_ENTRIES, serves as
// the workspace for the first two cases and as my own folder (a split part's) for the third.
test('past the bounds: the first missing folder leads to the file, a moved file is found in a sibling folder, the workspace goes before a big own folder', { timeout: 180_000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wf-file-miss-deep-'));
  try {
    const big = path.join(root, 'big');
    const put = (file: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, 'x\n'); };
    const versand = path.join(big, 'openautark', 'ausbau', 'nora-betrieb', 'versand');
    put(path.join(versand, 'tools', 'check.py'));
    put(path.join(versand, 'journal', 'X.json'));
    put(path.join(versand, 'outbox', 'other.json'));
    const filler = path.join(big, 'openautark', 'ausbau', 'zfill');
    mkdirSync(filler, { recursive: true });
    for (let i = 0; i < MISS_ENTRIES + 60; i++) writeFileSync(path.join(filler, `f${i}.txt`), '');
    const ws = path.join(root, 'ws');
    put(path.join(ws, 'docs', 'PLAN-ws.md'));
    const read = fileTools().find((entry) => entry.name === 'files.read')!;
    const run = async (workspace: string, given: string, split?: { cwd: string }) => {
      const ctx = { services: { paths: { workspace }, secrets: { redact: (value: string) => value } }, agent: { id: 'ag_a', name: 'Ada' }, runId: 'r1', mode: 'general', signal: new AbortController().signal, status: () => undefined, ...(split ? { split } : {}) } as never;
      const out = await read.run({ path: given } as never, ctx) as ToolOutput;
      return out.content.map((part) => ('text' in part ? part.text : '')).join('').split('\n');
    };

    // 1. A guessed root that skips the middle folders: check.py lies past the bounds, its first missing folder does not.
    const wrong = await run(big, 'nora-betrieb/versand/tools/check.py');
    assert.deepEqual(wrong.slice(2), ['The file lies at:', path.join(versand, 'tools', 'check.py')], wrong.join('\n'));

    // 2. Moved by its sender from outbox to journal: the walk starts one folder above outbox.
    const moved = await run(big, 'openautark/ausbau/nora-betrieb/versand/outbox/X.json');
    assert.equal(moved[1], `${path.join(versand, 'outbox')} holds: other.json`);
    assert.deepEqual(moved.slice(2), ['A file named X.json lies at:', path.join(versand, 'journal', 'X.json')], moved.join('\n'));

    // 3. The nearest folder is the workspace and my own folder is big: the workspace is walked first.
    const missing = await run(ws, 'nothing-here.md', { cwd: big });
    assert.match(missing.at(-1)!, new RegExp(`^No file named nothing-here\\.md below ${escape(ws)} and ${escape(big)} – the search stopped after (15,000 entries|1\\.5 s)\\.$`));
    const found = await run(ws, 'PLAN-ws.md', { cwd: big });
    assert.deepEqual(found.slice(2), ['A file named PLAN-ws.md lies at:', path.join(ws, 'docs', 'PLAN-ws.md')], found.join('\n'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test(`a tree beyond ${MISS_ENTRIES.toLocaleString('en-US')} entries: the name search ends within its bound and names no hit`, { timeout: 120_000 }, async () => {
  const w = world();
  try {
    const big = path.join(w.workspace, 'big');
    mkdirSync(big, { recursive: true });
    for (let i = 0; i < MISS_ENTRIES + 60; i++) writeFileSync(path.join(big, `f${i}.txt`), '');
    const started = Date.now();
    const { lines } = await w.run('files.read', { path: 'big/missing.txt' });
    const took = Date.now() - started;
    assert.ok(took < MISS_MS + 1_500, `took ${took} ms`);
    assert.match(lines[1], /^.*big holds: (f\d+\.txt, ){39}f\d+\.txt, \+15020 more$/);
    assert.ok(!lines.some((line) => line.includes('lies at')), lines.join('\n'));
    assert.match(lines[2], /^No file named missing\.txt below .* – the search stopped after (15,000 entries|1\.5 s)\.$/);
  } finally { w.cleanup(); }
});
