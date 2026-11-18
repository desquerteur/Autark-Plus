// S2 (KI-Runde 17.11.2026, after the review 18.11.) – a rebuild that keeps the bound thread (a Codex revert: same ref) keeps
// the start record that thread runs on, like a resume: it gets the system text it started with and the changed stable lines
// (was / now) of a SYSTEM.md edited since, and its next turn stays on that text. Over the native-rebuild harness.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_COLD_MS } from '../../../src/runtime/agents/compaction-policy.ts';
import type { EngineRebuildInput } from '../../../src/runtime/engines/types.ts';
import { setup, view } from './rebuild-harness.ts';

test('S2 fix: a revert keeps the thread\'s start – its own system text and the changed lines of an edit made since', async () => {
  const h = setup();
  h.org.add({ ...h.org.require(h.agent.id), instructions: '# How I work\nI write tight.\n\n## My role\nLaunch work.' });
  h.send('Hello');
  await h.turn('codex');
  const started = h.codex.calls[0].system.stable;
  assert.match(started, /I write tight\./);

  h.org.add({ ...h.org.require(h.agent.id), instructions: '# How I work\nI write tight and warm.\n\n## My role\nLaunch work.' });
  // Like CodexEngine.revert: the bound thread stays (same ref) and keeps the instructions and tools it started with.
  (h.codex.engine as { rebuild: (input: EngineRebuildInput) => Promise<unknown> }).rebuild = async (input) => {
    h.codex.rebuilds.push(input);
    return { ref: 'codex-s1', generation: input.generation, items: input.items.length };
  };
  h.ledgerState.view = view([['a1', 'assistant', 'assistant', 'Long answer']]);
  h.ledgerState.need = { since: 1, reason: 'cold', saves: 20_000 };
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1); // rested past the cache: the rebuild runs
  h.send('More');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1, 'the thread was rebuilt');
  const reverted = h.codex.calls[1];
  assert.equal(reverted.session?.ref, 'codex-s1', 'on the same thread');
  assert.equal(reverted.system.stable, started, 'with the system text that thread started with');
  assert.match(reverted.system.volatile, /## My SYSTEM\.md\nwas: I write tight\.\nnow: I write tight and warm\./, 'and the lines it never got');

  h.send('Again');
  await h.turn('codex');
  const next = h.codex.calls.at(-1)!;
  assert.equal(next.session?.ref, 'codex-s1');
  assert.equal(next.system.stable, started, 'its start holds');
  assert.ok(!next.system.volatile.includes('standing text changed'), 'the lines came once');
});
