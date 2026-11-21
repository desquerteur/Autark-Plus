// Feedback F06 (16.11.2026): on the PC that does not fire a schedule (its row keeps next_at NULL, devices/sync/tables.ts),
// the scheduler's list/get show the next time its spec gives – a repeating one its next occurrence, a one-off still to
// fire its time, a paused or used-up one none – and the row and the timer stay as they are (src/runtime/schedules/scheduler.ts).
// Owns: these assertions only. Never: real timers or a second PC.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';

const H = 3_600_000;

function setup() {
  const h = harness();
  h.org.add(agent('ag_tom', 'Tom'));
  h.scheduler.start();
  /** What another PC firing it leaves here: active, no due time. */
  const elsewhere = (id: string) => { h.db.run('UPDATE schedules SET next_at = NULL WHERE id = ?', [id]); h.scheduler.arm(); };
  const stored = (id: string) => h.db.get<{ next_at: number | null }>('SELECT next_at FROM schedules WHERE id = ?', [id])?.next_at ?? null;
  return { ...h, elsewhere, stored };
}

test('a repeating schedule another PC fires shows its next run here; the row and the timer stay without it', () => {
  const h = setup();
  const routine = h.scheduler.create({ ownerId: 'ag_tom', kind: 'reminder', title: 'Standup', spec: { everyMs: H }, payload: {} });
  h.elsewhere(routine.id);
  assert.equal(h.timers.pending.length, 0, 'nothing armed here');
  assert.equal(h.scheduler.get(routine.id)?.nextAt, h.clock.now() + H);
  assert.deepEqual(h.scheduler.list({ ownerId: 'ag_tom' }).map((schedule) => schedule.nextAt), [h.clock.now() + H]);
  assert.equal(h.stored(routine.id), null, 'never written to the row');
  assert.equal(h.timers.pending.length, 0, 'reading arms nothing');
});

test('a one-off still to fire shows its time, also when it is past (it fires late, once, there); a paused one shows none', () => {
  const h = setup();
  const soon = h.scheduler.create({ ownerId: 'ag_tom', kind: 'reminder', title: 'Call', spec: { at: h.clock.now() + H }, payload: {} });
  const late = h.scheduler.create({ ownerId: 'ag_tom', kind: 'reminder', title: 'Late', spec: { at: h.clock.now() + 2 * H }, payload: {} });
  h.elsewhere(soon.id);
  h.elsewhere(late.id);
  assert.equal(h.scheduler.get(soon.id)?.nextAt, soon.spec.at);
  h.clock.advance(3 * H);
  assert.equal(h.scheduler.get(late.id)?.nextAt, late.spec.at, 'past, not fired yet: its own time');
  h.scheduler.update(soon.id, { active: false }, 'human');
  assert.equal(h.scheduler.get(soon.id)?.nextAt, undefined, 'paused: no next run');
});
