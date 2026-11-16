// Owns: feedback 16.11.2026 F20 – which working row gets its own Stop (src/ui/chat/live-text.ts stoppableRun).
// Never: renders the popover or cancels a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineStopRun, stoppableRun } from '../../../src/ui/chat/live-text.ts';

test('only an agent\'s own known run gets a Stop, and only for whoever may cancel runs', () => {
  assert.equal(stoppableRun({ runId: 'run_1' }, true), 'run_1');
  assert.equal(stoppableRun({ runId: 'run_1' }, false), undefined, 'no right to cancel');
  assert.equal(stoppableRun({}, true), undefined, 'working without a known run');
  assert.equal(stoppableRun({ runId: 'run_1', groupId: 'grp_1' }, true), undefined, 'a split group is not one run');
});

test('the live line has its own Stop only while exactly one stoppable agent works in the chat', () => {
  assert.equal(lineStopRun([{ runId: 'run_1' }], true), 'run_1');
  assert.equal(lineStopRun([{ runId: 'run_1' }, { runId: 'run_2' }], true), undefined, 'several: unclear whom it hits – the popover rows');
  assert.equal(lineStopRun([], true), undefined);
  assert.equal(lineStopRun([{ runId: 'run_1', groupId: 'grp_1' }], true), undefined, 'a split group');
  assert.equal(lineStopRun([{ runId: 'run_1' }], false), undefined, 'no right to cancel');
});
