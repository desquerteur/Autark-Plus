// B-089 (11.11.2026, code audit): what a file tool or a cut output leaves out says truthfully how to get it.
//  - files.read's window stays below the tool-output cap, so a long file keeps its "continue with fromLine" line;
//  - a cut output (shell.exec above 24,000 characters) names the stored text's path and the files.read call that goes on;
//    without a stored copy it names no way; a short first line before one huge line shows the first 6,000 characters and names
//    the line that holds the cut (review fix 11.11.);
//  - at the 8 MB read bound files.read says that the file goes on; files.list counts the entries past its first 500.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from '../store/helpers.ts';
import { fileTools, LIST_ENTRIES } from '../../../src/runtime/tools/builtin/files.ts';
import { LINE_READ_BYTES, WINDOW_CHARS, lineWindow } from '../../../src/runtime/tools/builtin/file-window.ts';
import { finalizeOutput, MAX_TEXT_CHARS } from '../../../src/runtime/tools/outputs.ts';
import type { FileStore, SecretService } from '../../../src/runtime/contracts.ts';
import type { ToolOutput } from '../../../src/runtime/tools/types.ts';

const TEMP = tempDir('wf-files-cut-');
after(() => TEMP.cleanup());

const secrets = { redact: (value: string) => value } as unknown as SecretService;
const textOf = (out: ToolOutput) => out.content.map((part) => ('text' in part ? part.text : '')).join('');
const ctx = () => ({ services: { paths: { workspace: TEMP.dir } }, agent: { id: 'ag_1' }, runId: 'run_1', mode: 'general', status: () => undefined }) as never;
const tool = (name: string) => fileTools().find((entry) => entry.name === name)!;
/** A store that keeps blobs as files below the temp folder (as files/store.ts does under blobs/). */
const store = (): FileStore => {
  const dir = path.join(TEMP.dir, 'blobs');
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return {
    put: async (data: Uint8Array) => { const id = `blob${++n}`; writeFileSync(path.join(dir, id), data); return { id } as never; },
    path: (id: string) => path.join(dir, id),
  } as unknown as FileStore;
};
const numbered = (count: number, width = 60) => Array.from({ length: count }, (_, i) => `line ${i + 1} ${'x'.repeat(width)}`).join('\n');

test('files.read of a long file: the window fits under the tool-output cap, so its continuation line reaches the model', async () => {
  assert.ok(WINDOW_CHARS < MAX_TEXT_CHARS);
  const file = path.join(TEMP.dir, 'long.log');
  writeFileSync(file, numbered(2_000)); // ~140k characters
  const read = await tool('files.read').run({ path: file } as never, ctx()) as ToolOutput;
  const { output } = await finalizeOutput(read, { secrets, files: store() }, 'files.read');
  const shown = textOf(output);
  assert.ok(!shown.includes('[output truncated'), 'not cut again');
  const next = Number(/continue with files\.read fromLine: (\d+)/.exec(shown)?.[1]);
  assert.ok(next > 200, `continues at ${next}`);
  const again = textOf(await tool('files.read').run({ path: file, fromLine: next } as never, ctx()) as ToolOutput);
  assert.ok(again.startsWith(`line ${next} `));
});

test('a cut output names the stored text and the files.read call that goes on after the shown lines', async () => {
  const long = numbered(600); // ~40k characters, as a shell.exec output
  const { output, blobIds } = await finalizeOutput({ content: [{ type: 'text', text: long }] }, { secrets, files: store() }, 'shell.exec');
  const shown = textOf(output);
  assert.equal(blobIds.length, 1);
  assert.ok(shown.length < 7_000);
  const note = /\[output truncated: (\d+) chars, the first (\d+) shown; all (\d+) lines are stored – files\.read path: ("[^"]+"), device: "this", fromLine: (\d+)\]$/.exec(shown);
  assert.ok(note, shown.slice(-300));
  const [, total, head, lines, stored, from] = note!;
  assert.deepEqual([Number(total), Number(lines)], [long.length, 600]);
  assert.ok(shown.startsWith(long.slice(0, Number(head))) && long[Number(head)] === '\n', 'the head ends at a whole line');
  const rest = textOf(await tool('files.read').run({ path: JSON.parse(stored), fromLine: Number(from) } as never, ctx()) as ToolOutput);
  assert.ok(rest.startsWith(`line ${from} `), 'the named call opens what comes next');
});

test('a short first line and one line far past the cap: the first 6,000 characters show and the note reads on from the line that holds the cut', async () => {
  const long = `Status: 200\n${'y'.repeat(100_000)}`;
  const { output } = await finalizeOutput({ content: [{ type: 'text', text: long }] }, { secrets, files: store() }, 'shell.exec');
  const shown = textOf(output);
  const note = /\[output truncated: (\d+) chars, the first (\d+) shown; all (\d+) lines are stored – files\.read path: "[^"]+", device: "this", fromLine: (\d+)\]$/.exec(shown);
  assert.ok(note, shown.slice(-300));
  assert.equal(Number(note![2]), 6_000, 'not just "Status: 200"');
  assert.ok(shown.startsWith(long.slice(0, 6_000)));
  assert.equal(Number(note![3]), 2);
  assert.equal(Number(note![4]), 2, 'line 2 holds the cut – it is the one to read on from');

  const lines = numbered(600);
  const whole = textOf((await finalizeOutput({ content: [{ type: 'text', text: lines }] }, { secrets, files: store() }, 'shell.exec')).output);
  const head = Number(/the first (\d+) shown/.exec(whole)?.[1]);
  assert.equal(lines[head], '\n', 'ordinary lines: the head ends at a whole line');
  assert.equal(Number(/fromLine: (\d+)\]$/.exec(whole)?.[1]), lines.slice(0, head).split('\n').length + 1, 'and the next line is named');
});

test('a cut output without a stored copy says how much was cut and names no way', async () => {
  const failing = { put: async () => { throw new Error('disk full'); }, path: () => '' } as unknown as FileStore;
  const { output } = await finalizeOutput({ content: [{ type: 'text', text: numbered(600) }] }, { secrets, files: failing }, 'shell.exec');
  const shown = textOf(output);
  assert.match(shown, /\[output truncated: \d+ chars, the first \d+ shown; no stored copy of the rest\]$/);
  assert.ok(!/files\.read/.test(shown));
});

test('at the 8 MB read bound files.read says the file goes on instead of "nothing from line N on"', () => {
  const start = numbered(1_000);
  const size = 20 * 1024 * 1024;
  const past = lineWindow(start, { fromLine: 5_000 }, { size, readBytes: LINE_READ_BYTES });
  assert.ok(!/nothing from line/.test(past), past);
  assert.match(past, /Line 5000 lies further on: the first 8\.0 MB of this 20\.0 MB file hold 999 lines, and files\.read reads no further/);
  const end = lineWindow(start, { fromLine: 990 }, { size, readBytes: LINE_READ_BYTES });
  assert.match(end, /\[Lines 990–999 of at least 999 shown – the file goes on: the first 8\.0 MB/);
  assert.ok(!/fromLine: 1000/.test(end), 'no continuation that would only say the same');
  const whole = lineWindow('a\nb', { fromLine: 9 }, { size: 3, readBytes: 3 });
  assert.equal(whole, '[The file has 2 lines; nothing from line 9 on.]', 'a file read to its end says so as before');
  const big = lineWindow(start, {}, { size: 2 * 1024 * 1024, readBytes: 256 * 1024 });
  assert.ok(!/files\.search/.test(big), 'files.search reads no content of a file above 1 MB');
});

test('files.list counts the entries past its first 500', async () => {
  const dir = path.join(TEMP.dir, 'many');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < LIST_ENTRIES + 37; i++) writeFileSync(path.join(dir, `f${i}.txt`), '');
  const shown = textOf(await tool('files.list').run({ path: dir } as never, ctx()) as ToolOutput).split('\n');
  assert.equal(shown.length, LIST_ENTRIES + 1);
  assert.equal(shown.at(-1), `[${LIST_ENTRIES} of ${LIST_ENTRIES + 37} entries shown; 37 more are in this folder – files.search with a part of a name and this path finds them.]`);
});
