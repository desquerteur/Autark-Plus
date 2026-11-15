// The stable prompt takes the agent's SYSTEM.md from its agent core under "# My SYSTEM.md" and lists its main skills
// inside "## Skills"; without an agent core (older fakes, a failing core) it uses the agent row as before.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, route } from '../context/fixture.ts';
import { GENERAL_MODE } from '../../../src/runtime/modes/service.ts';
import type { SkillInfo } from '../../../src/shared/model/knowledge.ts';

const main: SkillInfo = { name: 'cut-style', description: 'How we cut: tight, no fades.', source: 'agent', ownerAgentId: 'ag_vid', path: '/x', modes: [], updatedAt: 0, main: true };
const indexed: SkillInfo = { name: 'remotion-video', description: 'Render videos with Remotion.', source: 'builtin', path: '/y', modes: [], updatedAt: 0 };

test('the stable prompt: SYSTEM.md under "# My SYSTEM.md", then "## Skills" with my main skills', () => {
  const f = fixture({ skills: [indexed] });
  Object.assign(f.services, {
    agentCore: { instructions: () => 'From SYSTEM.md: keep cuts short.', mainSkills: () => [main] },
  });
  const stable = f.context.prompt({ agent: f.vid, mode: GENERAL_MODE, route: route() }).stable;
  const header = stable.indexOf('# My SYSTEM.md');
  const own = stable.indexOf('From SYSTEM.md: keep cuts short.');
  const index = stable.indexOf('## Skills');
  const mainAt = stable.indexOf('My main skills (in my folder, knowledge.open by name):');
  const line = stable.indexOf('- cut-style – How we cut: tight, no fades.');
  assert.ok(header >= 0 && own > header && index > own && mainAt > index && line > mainAt, stable.slice(-1200));
  assert.ok(!stable.includes('Prefer short cuts'), 'the row text is not used while the file is');
});

test('without an agent core, or when it fails, the agent row is used and no main skills appear', () => {
  const f = fixture({ skills: [indexed] });
  const plain = f.context.prompt({ agent: f.vid, mode: GENERAL_MODE, route: route() }).stable;
  assert.ok(plain.includes('# My SYSTEM.md') && plain.includes('Prefer short cuts.'));
  assert.ok(!plain.includes('My main skills'));
  Object.assign(f.services, { agentCore: { instructions: () => { throw new Error('disk'); }, mainSkills: () => { throw new Error('disk'); } } });
  const failing = f.context.prompt({ agent: f.vid, mode: GENERAL_MODE, route: route() }).stable;
  assert.ok(failing.includes('# My SYSTEM.md') && failing.includes('Prefer short cuts.'));
  assert.ok(failing.includes('secret://sec_pw'), 'the instructions are still redacted');
  assert.ok(!failing.includes('My main skills'));
});
