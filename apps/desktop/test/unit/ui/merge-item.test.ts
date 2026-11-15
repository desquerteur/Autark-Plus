// The merge of a live run item into a loaded list (src/ui/team/step-view.ts mergeItem): new items in seq order, updates by id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunItem, RunItemKind } from '../../../src/shared/model/runs.ts';
import { mergeItem } from '../../../src/ui/team/step-view.ts';

const T0 = Date.UTC(2026, 9, 20, 9);
const SEC = 1000;
const MIN = 60 * SEC;

let seq = 0;
function item(kind: RunItemKind, at: number, data: Record<string, unknown> = {}, patch: Partial<RunItem> = {}): RunItem {
  seq++;
  return { id: `ri_${seq}`, runId: 'run_1', seq, kind, data, createdAt: at, ...patch };
}

/** n tool calls with results, one per `gap` ms from `start`. */
function toolRun(n: number, start: number, gap: number): RunItem[] {
  const out: RunItem[] = [];
  for (let i = 0; i < n; i++) {
    out.push(item('tool_call', start + i * gap, { callId: `c${i}`, args: { i } }, { name: 'files.read' }));
    out.push(item('tool_result', start + i * gap + 10, { callId: `c${i}`, ok: true, preview: 'ok' }));
  }
  return out;
}

test('live items merge by id: new ones are appended in seq order, updates replace the known item', () => {
  const [call, result] = toolRun(1, T0, 0);
  const list = [call];
  const added = mergeItem(list, result);
  assert.deepEqual(added.map((entry) => entry.id), [call.id, result.id]);
  assert.equal(list.length, 1, 'the loaded list is not changed in place');
  const settled = { ...call, effectStatus: 'confirmed' as const };
  const updated = mergeItem(added, settled);
  assert.equal(updated.length, 2);
  assert.equal(updated[0].effectStatus, 'confirmed');
  const late = item('tool_call', T0, { callId: 'late' }, { seq: 0 });
  assert.deepEqual(mergeItem(updated, late).map((entry) => entry.seq), [0, call.seq, result.seq], 'kept in seq order');
});
