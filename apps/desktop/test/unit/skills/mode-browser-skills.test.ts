// Shipped modes and skills agree on the browser (PM6 follow-up): a mode that lists the browser-accounts skill – and
// every mode the skill names in metadata.modes – offers browser.act, so no agent loads sign-in instructions it cannot
// follow. KI-Runde 17.11.2026: every mode reaches browser.* and computer.* (the registry offers every tool that can work
// here; the mode chooses the core set), and the skills a mode carries are what differ. The finance mode lists no pattern
// that matches no tool.
// Owns: these assertions only. Never: writes resources.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMode } from '../../../src/runtime/modes/service.ts';
import { parseFrontMatter } from '../../../src/runtime/skills/frontmatter.ts';
import { Registry, matchesPatterns } from '../../../src/runtime/tools/registry.ts';
import { coreNames } from '../../../src/runtime/tools/core-sets.ts';
import { builtinTools } from '../../../src/runtime/tools/builtin/index.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ToolDef } from '../../../src/runtime/tools/types.ts';
import type { Agent } from '../../../src/shared/model/org.ts';

const RESOURCES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../resources');
const modes = readdirSync(path.join(RESOURCES, 'modes')).filter((name) => name.endsWith('.md') && !name.startsWith('_'))
  .map((name) => parseMode(name.replace(/\.md$/, ''), readFileSync(path.join(RESOURCES, 'modes', name), 'utf8')));
const agent = { id: 'ag_x', mode: 'general', permissions: {} } as unknown as Agent;
/** browser.act as registered by browser/tools.ts: a remote device tool. */
const browserAct = { name: 'browser.act', description: 'act', category: 'device', remote: true, requires: 'device', inputSchema: { type: 'object' } } as unknown as ToolDef;

test('every mode that lists or is named by browser-accounts offers browser.act', () => {
  const registry = new Registry({ services: () => ({}) as RuntimeServices });
  const offers = (key: string) => registry.allowed(browserAct, agent, modes.find((mode) => mode.key === key)!);
  const listing = modes.filter((mode) => mode.skills.includes('browser-accounts')).map((mode) => mode.key).sort();
  assert.deepEqual(listing.filter((key) => !offers(key)), [], `modes listing browser-accounts: ${listing.join(', ')}`);
  const skill = parseFrontMatter(readFileSync(path.join(RESOURCES, 'skills', 'browser-accounts', 'SKILL.md'), 'utf8')).data as { metadata?: { modes?: string[] } };
  const named = skill.metadata?.modes ?? [];
  assert.ok(named.length > 0);
  assert.deepEqual(named.filter((key) => !offers(key)), [], `metadata.modes of browser-accounts: ${named.join(', ')}`);
  // KI-Runde 17.11.2026: the secretary reaches browser.act too; what differs is her skills and her core set.
  assert.equal(offers('secretary'), true);
  assert.ok(!modes.find((mode) => mode.key === 'secretary')!.skills.includes('browser-accounts'), 'she does not carry the sign-in skill');
});

test("B-080: every mode offers browser.* and computer.* – the person's own Chrome (where: 'chrome') is worked in with it", () => {
  const registry = new Registry({ services: () => ({}) as RuntimeServices });
  const computerClick = { ...browserAct, name: 'computer.click' } as ToolDef;
  const without = modes.filter((mode) => !registry.allowed(browserAct, agent, mode) || !registry.allowed(computerClick, agent, mode)).map((mode) => mode.key);
  assert.deepEqual(without, [], `${modes.length} modes read`);
  // The core set is where a mode differs: a browser mode holds them directly, a writing mode through tools.call.
  const shipped = (key: string) => modes.find((mode) => mode.key === key)!;
  assert.ok(coreNames(shipped('browser')).has('browser.act'), 'the shipped browser mode');
  assert.ok(!coreNames(shipped('writing')).has('browser.act'), 'the shipped writing mode');
});

test('the finance mode lists only tool patterns that match a built-in tool', () => {
  const finance = modes.find((mode) => mode.key === 'finance')!;
  // Device tools are registered by devices/tools.ts; B-080: computer.* works in the person's own Chrome (where: 'chrome').
  const names = [...builtinTools().map((tool) => tool.name), 'browser.act', 'browser.open', 'computer.act', 'computer.ui_tree'];
  const dead = (finance.tools ?? []).filter((pattern) => !pattern.startsWith('!') && !names.some((name) => matchesPatterns(name, [pattern])));
  assert.deepEqual(dead, []);
});
