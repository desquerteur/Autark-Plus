// Owns: the Security change log against the real SettingsStore (Noah's review 16.11.2026, finding A): an edit of
// settings.json that an update takes over before the watcher handed it over is not written down as the caller's.
// Never: the RPC server or the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SettingsStore } from '../../../src/runtime/settings/service.ts';
import { parseText } from '../../../src/runtime/settings/schema.ts';
import { RootWatcher } from '../../../src/runtime/root/watcher.ts';
import { ROOT_SETTINGS } from '../../../src/runtime/root/layout.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { actingAs, readSecurityChanges, startSecurityLog } from '../../../src/runtime/settings/security-log.ts';
import type { SettingsPatch } from '../../../src/shared/model/system.ts';
import { clock, memoryDb, recordingBus, tempDir } from '../store/helpers.ts';

function rig() {
  const temp = tempDir('security-log-');
  const db = memoryDb();
  const { bus } = recordingBus();
  const time = clock();
  const root = new RootWatcher({ root: temp.dir, clock: time, watch: false, debounceMs: 1, maxWaitMs: 5 });
  root.start();
  const settings = new SettingsStore({ db, bus, clock: time, env: { locale: 'de-AT', timezone: 'Europe/Vienna' }, dataDir: temp.dir, root });
  settings.get();
  const kv = new KvRepo(db);
  const stop = startSecurityLog({ bus, settings, kv, now: () => time.now() });
  const file = path.join(temp.dir, ROOT_SETTINGS);
  return { settings, kv, file, done: () => { stop(); settings.close(); root.stop(); temp.cleanup(); } };
}
const OWNER = { kind: 'person', name: 'Alex' } as const;

test('an agent edits settings.json, the person then saves another setting before the watcher fires: the edit is not the person\'s', () => {
  const h = rig();
  try {
    const doc = parseText(readFileSync(h.file, 'utf8')).data as { profile: Record<string, unknown> };
    doc.profile.forEveryAgent = 'SYNTHETIC: changed in settings.json';
    writeFileSync(h.file, JSON.stringify(doc, null, 2), 'utf8'); // no nudge: the watcher has not handed it over yet
    const patch = { profile: { name: 'Alex Example' } } as SettingsPatch;
    actingAs(OWNER, patch, () => h.settings.update(patch));
    const entry = readSecurityChanges(h.kv).find((change) => change.field === 'forEveryAgent');
    assert.equal(entry?.to, 'SYNTHETIC: changed in settings.json', 'the change is written down');
    assert.equal(entry?.by.kind, 'other', 'and not as the person who saved something else');
  } finally { h.done(); }
});

test('the person changing the line through settings.update is named', () => {
  const h = rig();
  try {
    const patch = { profile: { forEveryAgent: 'SYNTHETIC: the person\'s own line' } } as SettingsPatch;
    actingAs(OWNER, patch, () => h.settings.update(patch));
    assert.deepEqual(readSecurityChanges(h.kv).map((change) => [change.field, change.by.kind, change.to]), [['forEveryAgent', 'person', 'SYNTHETIC: the person\'s own line']]);
  } finally { h.done(); }
});
