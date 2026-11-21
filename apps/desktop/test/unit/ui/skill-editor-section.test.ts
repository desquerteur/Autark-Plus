// The mobile Settings route follows named skill capabilities, not unrestricted files.
// Owns: section availability regressions. Never: grants the RPC capability it projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisibleSection, visibleSections } from '../../../src/ui/settings/sections.ts';
test('Settings-only skill catalog reaches Skills; legacy chat read still reaches the page', () => {
  for (const allowed of [['skills.catalog', 'skills.open'], ['skills.list']]) {
    const can = (method: string) => allowed.includes(method);
    assert.ok(visibleSections(can).some(section => section.id === 'skills'));
    assert.equal(resolveVisibleSection('skills', can).id, 'skills');
  }
  assert.ok(!visibleSections(() => false).some(section => section.id === 'skills'));
  assert.notEqual(resolveVisibleSection('skills', () => false).id, 'skills');
});
