// Outages of task turns (T04): which errors count as an outage ('unavailable' – retried after it, no stall) and which
// as a failed attempt, for a turn's error and an engine result. The retry timing itself is tasks/next.ts lookAfterTurn
// (tasks/next.test.ts).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorOutcome, taskOutcome } from '../../../src/runtime/agents/turn-finish.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';

test('error outcomes: limits, outages (unavailable, cancelled) and real failures', () => {
  assert.equal(errorOutcome({ code: 'rate_limited' }), 'limit');
  assert.equal(errorOutcome({ code: 'unavailable' }), 'unavailable');
  assert.equal(errorOutcome({ code: 'cancelled' }), 'unavailable');
  assert.equal(errorOutcome({ code: 'internal' }), 'failed');
  // A setup only the person can change (tier, capability, model policy) escalates instead of retrying quietly.
  assert.equal(errorOutcome({ code: 'unavailable', details: { setup: true } }), 'failed');
  assert.equal(errorOutcome({ code: 'unavailable', details: { need: 'computerUse', setup: true } }), 'failed');
  assert.equal(errorOutcome({ code: 'budget_exceeded' }), 'failed', 'the budget check blocks it with its own reason');
  assert.equal(errorOutcome(undefined), 'failed');
  const signedOut: EngineTurnResult = { text: '', stop: 'error', error: { code: 'unavailable', message: 'Claude Code is not signed in.' } };
  assert.equal(taskOutcome(signedOut, 'open', undefined), 'unavailable');
  assert.equal(taskOutcome({ stop: 'error', error: { code: 'internal', message: 'x' } }, 'open', undefined), 'failed');
});
