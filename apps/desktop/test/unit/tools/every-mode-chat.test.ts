// KI-Runde 17.11.2026: every tool is in reach from every mode – a mode an AI writes itself, whatever its patterns, offers
// every registered tool (chat.read, chat.create, agents.update, hiring alike); the mode chooses only the core set
// (tools/core-sets.ts). Before: B-085/B-086 kept chat.read, chat.direct and agents.update in every mode (EVERY_MODE) and
// the rest with the mode's patterns.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../../../src/runtime/tools/registry.ts';

const tool = (name: string) => ({
  name, description: name, inputSchema: { type: 'object' }, category: 'think',
  describe: () => ({ summary: name, external: false }), run: async () => ({ content: [] }),
}) as never;

test('a self-written mode with narrow patterns offers every chat tool', () => {
  const registry = new Registry({ services: () => ({}) as never });
  const names = ['chat.read', 'chat.direct', 'chat.create', 'chat.list', 'chat.search'];
  for (const name of names) registry.register(tool(name));
  const agent = { id: 'ag_1', name: 'Ada', mode: 'my-mode' } as never;
  const mode = { key: 'my-mode', name: 'Mine', description: '', skills: [], tools: ['files.*'], category: 'general', instructions: '' } as never;
  assert.deepEqual(registry.specsFor(agent, mode).map((spec) => spec.name).sort(), [...names].sort());
});

test('browser mode offers agents.update and hiring too', () => {
  const registry = new Registry({ services: () => ({}) as never });
  for (const name of ['agents.update', 'agents.create', 'agents.templates']) registry.register(tool(name));
  const agent = { id: 'ag_1', name: 'Ada', mode: 'browser' } as never;
  const mode = { key: 'browser', name: 'Browser', description: '', skills: [], tools: ['browser.*'], category: 'general', instructions: '' } as never;
  assert.deepEqual(registry.specsFor(agent, mode).map((spec) => spec.name), ['agents.create', 'agents.templates', 'agents.update']);
});
