// F07 (owner 15.11.2026: "die Standardsprache ist immer Englisch", another one only from the PC): a new profile starts
// in this PC's display language – AUTARK_SYSTEM_LANGUAGE, which the desktop app sets from Electron's preferred system
// languages (main/runtime-link.ts runtimeEnv) – before Intl's regional format; anything unusable gives English, and a
// profile language already stored stays as it is.
// Owns: these assertions. Never: a real Electron or OS setting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, languageOf, systemEnvironment } from '../../../src/runtime/settings/defaults.ts';
import { runtimeEnv } from '../../../src/main/runtime-link.ts';
import { SettingsStore } from '../../../src/runtime/settings/service.ts';
import { RootWatcher } from '../../../src/runtime/root/watcher.ts';
import { clock, memoryDb, recordingBus, tempDir } from '../store/helpers.ts';

test('the display language from the desktop app wins over Intl; without it Intl; the time zone stays Intl\'s', () => {
  const intl = Intl.DateTimeFormat().resolvedOptions();
  assert.deepEqual(systemEnvironment({ AUTARK_SYSTEM_LANGUAGE: 'en-US' }), { locale: 'en-US', timezone: intl.timeZone || 'UTC' });
  assert.equal(systemEnvironment({ AUTARK_SYSTEM_LANGUAGE: '  fr-FR ' }).locale, 'fr-FR');
  assert.equal(systemEnvironment({}).locale, intl.locale || 'en', 'a runtime started without the app');
  assert.equal(systemEnvironment({ AUTARK_SYSTEM_LANGUAGE: '' }).locale, intl.locale || 'en', 'an empty value is no value');
});

test('an unusable language gives English; a usable one its code', () => {
  assert.equal(languageOf('de-AT'), 'de');
  assert.equal(languageOf('zh-Hans-CN'), 'zh');
  for (const value of ['Deutsch', '!!', '', '1-2']) assert.equal(languageOf(value), 'en', value);
  assert.equal(defaultSettings({ locale: 'Deutsch' }).profile.language, 'en');
  assert.equal(defaultSettings({ locale: 'es-MX' }).profile.language, 'es');
});

test('the desktop app hands the display language to the runtime; none when Electron has none', () => {
  assert.equal(runtimeEnv({ PATH: '/bin' }, undefined, 'de-DE').AUTARK_SYSTEM_LANGUAGE, 'de-DE');
  assert.equal('AUTARK_SYSTEM_LANGUAGE' in runtimeEnv({ PATH: '/bin' }, undefined, undefined), false);
  assert.equal('AUTARK_SYSTEM_LANGUAGE' in runtimeEnv({ PATH: '/bin' }, undefined, ' '), false);
});

test('a stored profile language stays; only a fresh profile starts in the PC\'s language', (t) => {
  const temp = tempDir('wf-settings-language-');
  const time = clock();
  const root = new RootWatcher({ root: temp.dir, clock: time, watch: false, debounceMs: 1, maxWaitMs: 5 });
  root.start();
  const store = (locale: string) => new SettingsStore({ db: memoryDb(), bus: recordingBus().bus, clock: time, env: { locale, timezone: 'UTC' }, dataDir: temp.dir, root });
  t.after(() => { root.stop(); temp.cleanup(); });
  const first = store('en-US');
  assert.equal(first.get().profile.language, 'en', 'an English display language: English');
  first.update({ profile: { language: 'de' } }); // settings.json now holds it
  first.close(); // the next start of the app
  const later = store('fr-FR');
  assert.equal(later.get().profile.language, 'de', 'the stored choice is never rewritten');
  later.close();
});
