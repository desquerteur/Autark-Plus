// split-lanes.ts: a split group as rows of columns over time – a column less when a part ends, items in the row of their
// time, waiting parts apart.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneRows } from '../../../src/ui/splits/split-lanes.ts';

const item = (id: string, createdAt: number) => ({ id, createdAt });

test('three parts: three columns, then two when #2 is back, then one; items in the row of their time', () => {
  const parts = [
    { id: 'a', idx: 1, startedAt: 100, endedAt: 500 },
    { id: 'b', idx: 2, startedAt: 100, endedAt: 300 },
    { id: 'c', idx: 3, startedAt: 100 }, // still running
  ];
  const items: Record<string, Array<{ id: string; createdAt: number }>> = {
    a: [item('a1', 150), item('a2', 400)],
    b: [item('b1', 90 /* before its start: its first row */), item('b2', 250)],
    c: [item('c1', 600)],
  };
  const { rows, waiting } = laneRows(parts, (id) => items[id]);
  assert.deepEqual(waiting, []);
  assert.deepEqual(rows.map((row) => row.lanes.map((lane) => lane.partId)), [['a', 'b', 'c'], ['a', 'c'], ['c']]);
  assert.deepEqual(rows.map((row) => [row.from, row.to]), [[100, 300], [300, 500], [500, undefined]]);
  assert.deepEqual(rows[0].lanes.map((lane) => [lane.first, lane.ends, lane.items.map((entry) => entry.id)]),
    [[true, false, ['a1']], [true, true, ['b1', 'b2']], [true, false, []]]);
  assert.deepEqual(rows[1].lanes.map((lane) => [lane.first, lane.ends, lane.items.map((entry) => entry.id)]), [[false, true, ['a2']], [false, false, []]]);
  assert.deepEqual(rows[2].lanes.map((lane) => [lane.ends, lane.items.map((entry) => entry.id)]), [[false, ['c1']]]);
});

test('a part that waits for another starts its column later and is listed as waiting before', () => {
  const live = laneRows([{ id: 'a', idx: 1, startedAt: 0 }, { id: 'c', idx: 3 }], () => []);
  assert.deepEqual(live.rows.map((row) => row.lanes.map((lane) => lane.partId)), [['a']]);
  assert.deepEqual(live.waiting.map((part) => part.id), ['c']);
  const later = laneRows([{ id: 'a', idx: 1, startedAt: 0, endedAt: 10 }, { id: 'c', idx: 3, startedAt: 10, endedAt: 20 }], () => []);
  assert.deepEqual(later.rows.map((row) => row.lanes.map((lane) => `${lane.partId}${lane.first ? '+' : ''}${lane.ends ? '.' : ''}`)), [['a+.'], ['c+.']]);
  assert.deepEqual(laneRows([], () => []).rows, []);
});

test('parts that start a few ms apart share their first row', () => {
  const { rows } = laneRows([{ id: 'a', idx: 1, startedAt: 1005 }, { id: 'b', idx: 2, startedAt: 1000, endedAt: 9000 }], () => []);
  assert.deepEqual(rows.map((row) => row.lanes.map((lane) => lane.partId)), [['a', 'b'], ['a']]);
  assert.deepEqual(rows.map((row) => row.lanes.map((lane) => lane.first)), [[true, true], [false]]);
});
