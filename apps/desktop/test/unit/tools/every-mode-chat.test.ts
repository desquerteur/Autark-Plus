// B-085: chat.read and chat.direct are offered in every mode (tools/registry.ts EVERY_MODE), so a mode an
// AI writes itself never leaves an agent mute; creating, listing and searching chats stay with the mode's patterns.
// B-086: agents.update too – a "System prompt update" or "Training: …" review reaches an executor mode, whose answer is
// its own SYSTEM.md; hiring and the other agents.* tools stay with the mode's patterns.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVERY_MODE, Registry } from '../../../src/runtime/tools/registry.ts';

const tool = (name: string) => ({
  name, description: name, inputSchema: { type: 'object' }, category: 'think',
  describe: () => ({ summary: name, external: false }), run: async () => ({ content: [] }),
}) as never;

test('a self-written mode without chat.* still offers chat.read and chat.direct – not create, list or search', () => {
  const registry = new Registry({ services: () => ({}) as never });
  const names = ['chat.read', 'chat.direct', 'chat.create', 'chat.list', 'chat.search'];
  for (const name of names) registry.register(tool(name));
  const agent = { id: 'ag_1', name: 'Ada', mode: 'my-mode' } as never;
  const mode = { key: 'my-mode', name: 'Mine', description: '', skills: [], tools: ['files.*'], category: 'general', instructions: '' } as never;
  const offered = registry.specsFor(agent, mode).map((spec) => spec.name).sort();
  assert.deepEqual(offered, ['chat.direct', 'chat.read']);
  for (const name of ['chat.create', 'chat.list', 'chat.search']) assert.equal(EVERY_MODE.has(name), false, name);
});

test('B-086: agents.update is offered in every mode – hiring (agents.create, agents.templates) is not', () => {
  const registry = new Registry({ services: () => ({}) as never });
  for (const name of ['agents.update', 'agents.create', 'agents.templates']) registry.register(tool(name));
  const agent = { id: 'ag_1', name: 'Ada', mode: 'browser' } as never;
  const mode = { key: 'browser', name: 'Browser', description: '', skills: [], tools: ['browser.*'], category: 'general', instructions: '' } as never;
  assert.deepEqual(registry.specsFor(agent, mode).map((spec) => spec.name), ['agents.update']);
  for (const name of ['agents.create', 'agents.templates']) assert.equal(EVERY_MODE.has(name), false, name);
});
