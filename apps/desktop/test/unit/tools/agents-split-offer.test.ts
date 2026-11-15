// B-057 – agents.split over the real shipped modes and tool groups: allowed in every mode, but no core tool (owner
// 30.10.2026: "Das braucht die KI nicht die ganze Zeit") – not in any direct offer, reachable through tools.find /
// tools.call on every engine kind like its results and stop tools, what parts are stands once in How I work (resources/prompts/how-i-work.md);
// tools.find ranks it first for parallel work, and a reviewer agent – which only reads and reports – is not offered it.
// Owns: these assertions only. Never: runs a tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Registry } from '../../../src/runtime/tools/registry.ts';
import { builtinTools } from '../../../src/runtime/tools/builtin/index.ts';
import { rankTools } from '../../../src/runtime/tools/builtin/tools-meta.ts';
import { BASE_CORE, coreReason } from '../../../src/runtime/tools/core-sets.ts';
import { readFileSync } from 'node:fs';
import { ModeLibrary } from '../../../src/runtime/modes/service.ts';
import { ManualClock } from '../../../src/runtime/system/clock.ts';
import { agent } from '../chat/harness.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';

const ENGINES = [{ ownTools: true, via: 'native' as const }, { ownTools: true, via: 'mcp' as const }, { ownTools: false, via: 'native' as const }];

test('agents.split is allowed in every shipped mode but never direct; it, its results and stop tools are reachable everywhere', () => {
  const tools = builtinTools();
  const services = { org: { list: () => [], get: () => undefined }, log: { debug() {}, info() {}, warn() {}, error() {} } } as unknown as RuntimeServices;
  const registry = new Registry({ services: () => services });
  for (const tool of tools) registry.register(tool);
  const modes = new ModeLibrary({ resources: path.resolve('resources'), clock: new ManualClock() });
  assert.equal(Object.hasOwn(BASE_CORE, 'agents.split'), false);
  for (const mode of modes.list()) {
    const info = modes.get(mode.key);
    const tom = agent(`ag_${mode.key}`, 'X', { mode: mode.key });
    for (const engine of ENGINES) {
      const offer = registry.offerFor(tom, info, engine).map((spec) => spec.name);
      assert.ok(!offer.includes('agents.split'), `${mode.key}: not direct on ${JSON.stringify(engine)}`);
      assert.ok(offer.includes('tools.find') && offer.includes('tools.call'), `${mode.key}: reachable through the meta tools on ${JSON.stringify(engine)}`);
    }
    assert.equal(coreReason(info, 'agents.split'), undefined, `${mode.key}: no core tool`);
    const all = registry.specsFor(tom, info).map((spec) => spec.name);
    for (const name of ['agents.split', 'agents.split_results', 'agents.split_tell']) assert.ok(all.includes(name), `${mode.key}: ${name}`);
  }
  const specs = tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
  assert.equal(rankTools(specs, 'split the work into parallel workers', 3)[0]?.name, 'agents.split');
  const how = readFileSync(new URL('../../../resources/prompts/standard-agent.md', import.meta.url), 'utf8');
  assert.match(how, /stay one \(people call this Ultra\): parts of me/, 'How I work says what parts are');
});
