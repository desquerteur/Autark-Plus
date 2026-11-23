// KI-Runde 17.11.2026 – learned tools are promoted whenever a session starts anew, rebuilt ones included (agents/turn-prepare.ts
// buildTurn `anew`, agents/rebuild.ts NativeRebuildInput.anew): a tool the agent ran through tools.call stays out of the session
// it resumes, and joins the session a rebuild starts – in the rebuild's own tool list, the turn's offer and the stored prompt key
// alike. Before, only a fresh session took it; a rebuilt one never did.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptKey } from '../../../src/runtime/agents/session-key.ts';
import { CACHE_COLD_MS } from '../../../src/runtime/agents/compaction-policy.ts';
import { noteLearned } from '../../../src/runtime/tools/learned.ts';
import type { EngineCaps, EngineTurnInput } from '../../../src/runtime/engines/types.ts';
import type { ToolSpec } from '../../../src/runtime/tools/types.ts';
import { setup, view } from './rebuild-harness.ts';

const ALL = ['media.image', 'tasks.list', 'tools.call', 'tools.find'];
const CORE = ['tasks.list', 'tools.call', 'tools.find'];
const spec = (name: string): ToolSpec => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });
const toolsOf = (input: EngineTurnInput | undefined) => (input?.tools ?? []).map((tool) => tool.name);

test('a tool run through tools.call joins the session a rebuild starts – never the resumed one', async () => {
  const h = setup();
  (h.codex.engine.caps as EngineCaps).dynamicTools = true;
  Object.assign(h.s.tools, {
    specsFor: () => ALL.map(spec),
    // the registry's rule (registry.ts offerFor): the core set plus the learned names
    offerFor: (_agent: unknown, _mode: unknown, _engine: unknown, learned: readonly string[] = []) => ALL.filter((name) => CORE.includes(name) || learned.includes(name)).map(spec),
  });
  h.send('Hello');
  await h.turn('codex');
  assert.deepEqual(toolsOf(h.codex.calls[0]), CORE);
  noteLearned(h.s, h.agent.id, 'media.image'); // the agent ran media.image through tools.call

  h.send('Next');
  await h.turn('codex');
  assert.equal(h.codex.calls[1].session?.ref, 'codex-s1', 'resumed');
  assert.deepEqual(toolsOf(h.codex.calls[1]), CORE, 'the resumed session keeps the tools it started with');

  h.ledgerState.view = view([['a1', 'assistant', 'assistant', 'Hi there.']]);
  h.ledgerState.need = { since: 1, reason: '1 condensed', saves: 10 };
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1); // the session rests past the cache: it starts anew
  h.send('Later');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1);
  const rebuild = h.codex.rebuilds[0];
  assert.deepEqual(rebuild.tools.map((tool) => tool.name), ['media.image', ...CORE], 'the rebuilt session starts with the learned tool');
  assert.deepEqual(rebuild.toolNames, ['media.image', ...CORE]);
  const turn = h.codex.calls[2];
  assert.equal(turn.session?.ref, 'codex-r1');
  assert.deepEqual(toolsOf(turn), ['media.image', ...CORE], 'and the turn on it offers the same');
  assert.equal(h.binding('codex')?.promptKey, promptKey(rebuild.system.stable, rebuild.toolNames), 'stored with the offer it really got');

  h.send('Thanks');
  await h.turn('codex');
  assert.equal(h.codex.calls[3].session?.ref, 'codex-r1', 'resumed again: nothing starts anew for the promotion itself');
  assert.deepEqual(toolsOf(h.codex.calls[3]), ['media.image', ...CORE]);
});
