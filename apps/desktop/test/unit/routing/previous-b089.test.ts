// B-089 (11.11.2026, routing/previous.ts startEffortBy): the effort's origin – the agent's own request, the agent's
// fixed effort, the previous turn's kept effort, the default – beside the effort startEffort picks.
// Owns: these assertions only. Never: the router.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startEffort, startEffortBy } from '../../../src/runtime/routing/previous.ts';

test('startEffortBy names where the effort came from, and startEffort keeps its two fields', () => {
  const asked = { modelId: 'm', effort: 'xhigh' as const, explicit: true, asked: 'effort' as const };
  const kept = { modelId: 'm', effort: 'max' as const };
  const cases: Array<[unknown, unknown, boolean, string, string]> = [
    [{ agentEffort: 'medium' }, asked, true, 'xhigh', 'request'],
    [{ agentEffort: 'medium' }, kept, true, 'medium', 'agent'],
    [{}, kept, true, 'max', 'previous'],
    [{}, kept, false, startEffort({} as never, kept, 'chat', false).effort, 'default'],
    [{ defaultEffort: 'low' }, undefined, false, 'low', 'default'],
  ];
  for (const [policy, previous, keep, effort, by] of cases) {
    const start = startEffortBy(policy as never, previous as never, 'chat', keep);
    assert.deepEqual([start.effort, start.by], [effort, by], by);
    assert.deepEqual(startEffort(policy as never, previous as never, 'chat', keep), { effort: start.effort, requested: start.requested });
  }
});
