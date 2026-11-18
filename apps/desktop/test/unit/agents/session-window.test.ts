// B-080 – SessionStore.reportedWindow: the context window an engine last reported for a model on any agent's thread (the
// window it really runs with – splits/fork.ts and session-choice.ts chooseSession use it before the catalog's): the newest
// row of that engine and model with a window; rows of other models or engines and rows without a window do not count.
// Owns: these checks. Never: an engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, type SessionBinding } from '../../../src/runtime/agents/sessions.ts';
import { memoryDb } from '../store/helpers.ts';

const row = (over: Partial<SessionBinding>): SessionBinding => ({
  agentId: 'ag_ava', conversationId: 'ch_a', engine: 'codex', accountId: 'acc_1', ref: `thr_${Math.random().toString(36).slice(2)}`,
  generation: 1, cursorSeq: 0, model: 'codex:gpt-6.1-terra', updatedAt: 1_000, ...over,
});

test('reportedWindow: the newest window of that engine and model, from any thread; nothing reported → undefined', () => {
  const store = new SessionStore(memoryDb());
  assert.equal(store.reportedWindow('codex', 'codex:gpt-6.1-terra'), undefined, 'no row yet');
  store.save(row({ conversationId: 'ch_old', contextWindow: 400_000, updatedAt: 1_000 }));
  store.save(row({ agentId: 'ag_ben', conversationId: 'task:t1', contextWindow: 475_000, updatedAt: 2_000 }));
  store.save(row({ conversationId: 'ch_new', updatedAt: 3_000 })); // newer, but no window reported yet
  store.save(row({ conversationId: 'ch_luna', model: 'codex:gpt-6-luna', contextWindow: 258_400, updatedAt: 4_000 }));
  store.save(row({ conversationId: 'ch_claude', engine: 'claude', contextWindow: 1_000_000, updatedAt: 5_000 }));
  assert.equal(store.reportedWindow('codex', 'codex:gpt-6.1-terra'), 475_000, "another agent's newer row of the model counts");
  assert.equal(store.reportedWindow('codex', 'codex:gpt-6-luna'), 258_400, 'each model its own');
  assert.equal(store.reportedWindow('claude', 'codex:gpt-6.1-terra'), 1_000_000, 'each engine its own');
  assert.equal(store.reportedWindow('codex', 'codex:gpt-6.1-sol'), undefined);
  store.setContextWindow('ag_ava', 'ch_new', 'codex', 470_000); // the newest row gets its window
  assert.equal(store.reportedWindow('codex', 'codex:gpt-6.1-terra'), 470_000);
});
