// Settings › Security (owner 16.11.2026: "ein Sicherheits Tab … Vollzugriff und weniger … global für alle Agents"): the
// page sits after Secrets on #/settings/security (the older "permissions" name opens it too), its search words find it,
// and it is a view on settings.json – the access through setPcAccess (the Manager hears first, pc-access.test.ts), the
// lines for every agent as profile.forEveryAgent in one fixed field of at most MAX_HUMAN_MD characters.
// Owns: these assertions only. Never: a DOM or a runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, searchSections } from '../../../src/ui/settings/sections.ts';
import { parseRoute, SETTINGS_PAGES, settingsPage } from '../../../src/ui/lib/router.ts';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/ui');

test('the Security page: after Secrets, a shield, settings.json behind it, the same place in the router', () => {
  const ids = SECTIONS.map((section) => section.id);
  assert.equal(ids.indexOf('security'), ids.indexOf('secrets') + 1);
  assert.deepEqual([...SETTINGS_PAGES], ids, 'the router holds the same list in the same order');
  const page = SECTIONS.find((section) => section.id === 'security')!;
  assert.equal(page.title, 'Security');
  assert.equal(page.icon, 'shield');
  assert.equal(page.file.path, 'settings.json');
  assert.deepEqual(page.requires, ['settings.update']);
  assert.deepEqual(parseRoute('#/settings/security'), { view: 'settings', section: 'security' });
  assert.equal(settingsPage('permissions'), 'security');
  for (const words of ['security', 'full access', 'careful', 'robot', 'captcha', 'every agent']) {
    assert.ok(searchSections(words).some((section) => section.id === 'security'), words);
  }
});

test('the page is a view on settings.json: the access through setPcAccess, the lines for every agent in one fixed field', () => {
  const page = readFileSync(path.join(SRC, 'settings/SecurityPage.tsx'), 'utf8');
  assert.match(page, /profile\.pcAccess \?\? 'whole'/, 'absent = full access');
  assert.match(page, /setPcAccess\(to\)/);
  assert.match(page, /updateSettings\(\{ profile: \{ forEveryAgent: next \} \}\)/);
  assert.match(page, /<textarea class="set-textarea" rows=\{5\} maxLength=\{MAX_HUMAN_MD\}/, 'a fixed field');
  assert.match(page, /reserve=\{2\}/, 'the level\'s sentence has its reserved lines, nothing moves');
  assert.doesNotMatch(page, /confirm\(|Are you sure/, 'no confirmation step');
  const settings = readFileSync(path.join(SRC, 'settings/Settings.tsx'), 'utf8');
  assert.match(settings, /security: SecurityPage,/);
});
