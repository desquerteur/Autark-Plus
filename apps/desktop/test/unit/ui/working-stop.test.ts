// Owns: feedback 16.11.2026 F20/F21 – which working row and which live bar line gets its own Stop (src/ui/chat/live-text.ts
// stoppableRun, barStopRun). Never: renders the popover or the bar, or cancels a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { barStopRun, stoppableRun } from '../../../src/ui/chat/live-text.ts';

test('only an agent\'s own known run gets a Stop, and only for whoever may cancel runs', () => {
  assert.equal(stoppableRun({ runId: 'run_1' }, true), 'run_1');
  assert.equal(stoppableRun({ runId: 'run_1' }, false), undefined, 'no right to cancel');
  assert.equal(stoppableRun({}, true), undefined, 'working without a known run');
  assert.equal(stoppableRun({ runId: 'run_1', groupId: 'grp_1' }, true), undefined, 'a split group is not one run');
});

test('F21: every non-split live bar line has its own Stop for its own run, however many agents work', () => {
  const runs = [{ runId: 'run_1' }, { runId: 'run_2' }, { runId: 'run_3', split: { groupId: 'grp_1' } }];
  assert.deepEqual(runs.map((run) => barStopRun(run, true)), ['run_1', 'run_2', undefined], 'each agent its own; a split part none');
  assert.deepEqual(runs.map((run) => barStopRun(run, false)), [undefined, undefined, undefined], 'no right to cancel');
});

test('F21: the bar holds each Stop in a fixed slot beside the line (never nested), the header line has none', () => {
  const read = (path: string) => readFileSync(new URL(`../../../src/ui/${path}`, import.meta.url), 'utf8');
  const bar = read('chat/LiveBar.tsx');
  assert.match(bar, /<div key=\{run\.runId\} class="live-bar-row">\s*<button type="button" class="live-bar-line"[\s\S]*?<\/button>\s*\{stops && <span class="live-bar-stop">/, 'row = line button, then the slot');
  assert.match(read('styles/live-bar.css'), /\.live-bar-stop \{[^}]*flex: none;[^}]*width: \d+px;/, 'the slot has a fixed width');
  assert.doesNotMatch(read('chat/ChatHeader.tsx'), /StopRun/, 'one run has one Stop in view');
});
