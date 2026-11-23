// KI-Runde 17.11.2026 – the boundary of an agent's session (agents/boundary.ts) and the binding's fold mark (agents/sessions.ts,
// migration 109): `on` is the route of the agent's newest session of the thread on any engine; `at` is true without a session,
// while a fold waits to be replayed, and once the session rested past CACHE_COLD_MS. The fold mark holds while the session
// keeps its generation (every ordinary save) and goes with a new generation (a rebuild) or the row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../chat/harness.ts';
import { boundaryOf } from '../../../src/runtime/agents/boundary.ts';
import { CACHE_COLD_MS } from '../../../src/runtime/agents/compaction-policy.ts';
import { SessionStore, type SessionBinding } from '../../../src/runtime/agents/sessions.ts';
import { systemNoteText, triggerLabel } from '../../../src/shared/text/run-notes.ts';

const binding = (patch: Partial<SessionBinding> = {}): SessionBinding => ({
  agentId: 'ag_tom', conversationId: 'main', engine: 'claude', accountId: 'acc_1', ref: 's1', generation: 1, cursorSeq: 0,
  contextTokens: 300_000, model: 'claude:opus', updatedAt: 0, ...patch,
});

test('boundaryOf: no session, a warm one, a folded one, a cold one – and the model the agent is on', () => {
  const h = harness();
  const store = new SessionStore(h.db);
  const now = h.clock.now();
  assert.deepEqual(boundaryOf(h.services, 'ag_tom', 'main'), { at: true, why: 'no_session' });

  store.save(binding({ updatedAt: now }));
  assert.deepEqual(boundaryOf(h.services, 'ag_tom', 'main'), { at: false, on: { engine: 'claude', modelId: 'claude:opus', accountId: 'acc_1' } }, 'warm: the turn stays on the model its session is on');
  assert.deepEqual(boundaryOf(h.services, 'ag_tom', 'split:sp_1'), { at: true, why: 'no_session' }, 'per thread');

  store.folded('ag_tom', 'main', 'claude', now);
  assert.deepEqual(boundaryOf(h.services, 'ag_tom', 'main'), { at: true, why: 'fold', on: { engine: 'claude', modelId: 'claude:opus', accountId: 'acc_1' } });

  // the newest session of the thread decides, whatever its engine
  h.clock.advance(60_000);
  store.save(binding({ engine: 'codex', ref: 'thr_1', model: 'codex:sol', accountId: 'acc_2', updatedAt: h.clock.now() }));
  assert.deepEqual(boundaryOf(h.services, 'ag_tom', 'main'), { at: false, on: { engine: 'codex', modelId: 'codex:sol', accountId: 'acc_2' } });
  assert.equal(store.newest('ag_tom', 'main')?.ref, 'thr_1');

  h.clock.advance(CACHE_COLD_MS);
  assert.equal(boundaryOf(h.services, 'ag_tom', 'main').at, false, 'exactly an hour: still warm');
  h.clock.advance(1);
  assert.deepEqual(boundaryOf(h.services, 'ag_tom', 'main'), { at: true, why: 'cold', on: { engine: 'codex', modelId: 'codex:sol', accountId: 'acc_2' } });

  store.save(binding({ engine: 'codex', ref: 'thr_2', generation: 2, model: undefined, accountId: undefined, updatedAt: h.clock.now() }));
  assert.deepEqual(boundaryOf(h.services, 'ag_tom', 'main'), { at: false }, 'a session that names no model: no `on`');
});

test('the fold mark holds while the session stays the same one and goes with another ref or a new generation', () => {
  const h = harness();
  const store = new SessionStore(h.db);
  store.save(binding());
  assert.equal(store.get('ag_tom', 'main', 'claude')?.foldedAt, undefined);
  store.folded('ag_tom', 'main', 'claude', 1234);
  assert.equal(store.get('ag_tom', 'main', 'claude')?.foldedAt, 1234);

  store.save(binding({ contextTokens: 310_000, updatedAt: 5 })); // a turn's end on the same session
  assert.equal(store.get('ag_tom', 'main', 'claude')?.foldedAt, 1234, 'an ordinary save keeps it');
  store.save(binding({ ref: 's1-by-id', updatedAt: 6 })); // another session under the same generation is not the folded one
  assert.equal(store.get('ag_tom', 'main', 'claude')?.foldedAt, undefined, 'another ref starts unfolded');

  store.folded('ag_tom', 'main', 'claude', 2345);
  store.save(binding({ ref: 'r1', generation: 2, contextTokens: 40_000, updatedAt: 7 })); // the rebuild from the folded record
  assert.equal(store.get('ag_tom', 'main', 'claude')?.foldedAt, undefined, 'a new generation starts unfolded');

  store.folded('ag_tom', 'main', 'claude', 99);
  store.remove('ag_tom', 'main', 'claude');
  store.save(binding({ ref: 's2', generation: 2, updatedAt: 8 })); // a fresh session after a renewal, same generation number as the row before
  assert.equal(store.get('ag_tom', 'main', 'claude')?.foldedAt, undefined, 'a removed row takes its mark along');
});

test('what a person and an agent read of a fold in the run log: its trigger and its notes', () => {
  const note = (data: Record<string, unknown>, name?: string) => systemNoteText({ kind: 'note', data, ...(name ? { name } : {}) });
  assert.equal(triggerLabel({ trigger: 'fold' }), 'Context fold');
  assert.equal(note({ fold: 'step', before: 150_000, hidden: 212, checkpoint: ['c9'] }), 'Context folded: 212 earlier parts behind the hand-over');
  assert.equal(note({ fold: 'kept', why: 'size', reason: 'no hand-over written' }), 'Context not folded (no hand-over written)');
  assert.equal(note({ checkpoint: true, text: 'I am building …' }, 'Hand-over'), 'Hand-over written');
  assert.equal(note({ compacted: 'engine', before: 971_204, after: 48_310, ms: 84_000 }), 'Context compacted (engine)');
});
