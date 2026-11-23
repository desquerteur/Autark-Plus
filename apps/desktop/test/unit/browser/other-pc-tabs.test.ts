// 18.11.2026: browser.tabs' lines for a space's websites on the person's other PCs (src/runtime/browser/other-pc-tabs.ts):
// the 'remote' panels of that space in side-tabs.json with their PC's name, the kept address and the title; nothing
// for a space without any, and never this PC's own websites (the tab list above names those).
// Owns: these assertions only. Never: Electron or a link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { otherPcTabs } from '../../../src/runtime/browser/other-pc-tabs.ts';
import { DevicesRepo } from '../../../src/runtime/devices/repo.ts';
import { sideTabsFile, writeSideTabs } from '../../../src/runtime/root/side-tabs.ts';
import { memoryDb } from '../devices/fakes.ts';
import { record } from '../devices/sync-net.ts';

test('the space\'s websites on other PCs, named by their PC', (t) => {
  const data = mkdtempSync(path.join(tmpdir(), 'opt-'));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const db = memoryDb();
  new DevicesRepo(db).upsert(record('dev_tower', { name: 'Tower' }));
  const s = { db, paths: { data } } as unknown as RuntimeServices;
  assert.deepEqual(otherPcTabs(s, 'global'), [], 'no file yet');
  writeSideTabs(sideTabsFile(data), {
    global: { tabs: [{ id: 'web-1', url: 'https://here.example/' }, { id: 'remote:dev_tower:web-2', panel: 'remote', device: 'dev_tower', tab: 'web-2', url: 'https://there.example/x', title: 'There' }] },
    'chat:c1': { tabs: [{ id: 'web-3', url: 'https://chat.example/' }] },
  });
  assert.deepEqual(otherPcTabs(s, 'global'), [
    "Open on the person's other PCs (they run there; I see them, I work in the tabs above):",
    '- on Tower · https://there.example/x · "There"',
  ]);
  assert.deepEqual(otherPcTabs(s, 'chat:c1'), []);
});
