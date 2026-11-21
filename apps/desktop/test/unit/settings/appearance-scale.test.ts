// #30: settings.json › appearance.uiScale / uiScalePhone – the size of the whole app on a PC and on a phone.
// - a fresh install is at 100 % on both and writes both keys into settings.json with their comment;
// - a scale is saved, survives a restart and leaves the other kind's value alone;
// - a value out of range, a fraction or text is refused naming the key; forgiving reads clamp and fall back;
// - the Ctrl +/− steps: onto the 10 % grid, never past 80 or 150, Ctrl 0 back to 100.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SettingsStore } from '../../../src/runtime/settings/service.ts';
import { parseText } from '../../../src/runtime/settings/schema.ts';
import { RootWatcher } from '../../../src/runtime/root/watcher.ts';
import { ROOT_SETTINGS } from '../../../src/runtime/root/layout.ts';
import { DEFAULT_SCALE, SCALE_LIMITS, appearanceOf, scaleOf, stepScale } from '../../../src/shared/model/appearance.ts';
import { clock, memoryDb, recordingBus, tempDir } from '../store/helpers.ts';

const env = { locale: 'en-US', timezone: 'Europe/Berlin' };

function setup() {
  const temp = tempDir('wf-appearance-scale-');
  const db = memoryDb();
  const file = path.join(temp.dir, ROOT_SETTINGS);
  const recorder = recordingBus();
  const time = clock();
  const root = new RootWatcher({ root: temp.dir, clock: time, watch: false, debounceMs: 1, maxWaitMs: 5 });
  root.start();
  const make = () => new SettingsStore({ db, bus: recorder.bus, clock: time, env, dataDir: temp.dir, root });
  const settings = make();
  const text = () => readFileSync(file, 'utf8');
  const json = () => parseText(text()).data as Record<string, Record<string, unknown>>;
  const done = () => { settings.close(); root.stop(); temp.cleanup(); };
  return { settings, make, text, json, done };
}

test('a fresh install is at 100 % on PCs and phones, both keys in the file', () => {
  const { settings, json, text, done } = setup();
  try {
    const look = settings.get().appearance!;
    assert.equal(look.uiScale, 100);
    assert.equal(look.uiScalePhone, 100);
    assert.equal(json().appearance.uiScale, 100);
    assert.equal(json().appearance.uiScalePhone, 100);
    assert.match(text(), /size of the whole app on a PC/, 'explained in the file');
  } finally { done(); }
});

test('a scale is saved, kept after a restart, and the other kind keeps its own', () => {
  const { settings, make, json, done } = setup();
  try {
    settings.update({ appearance: { uiScale: 130 } });
    assert.equal(json().appearance.uiScale, 130);
    assert.equal(json().appearance.uiScalePhone, 100, 'the phone is untouched');
    settings.update({ appearance: { uiScalePhone: 90 } });
    settings.close();
    const again = make();
    const look = again.get().appearance!;
    assert.equal(look.uiScale, 130, 'after a restart');
    assert.equal(look.uiScalePhone, 90);
    again.close();
  } finally { done(); }
});

test('a wrong scale is refused naming the key', () => {
  const { settings, done } = setup();
  try {
    assert.throws(() => settings.update({ appearance: { uiScale: 200 } }), /appearance\.uiScale/);
    assert.throws(() => settings.update({ appearance: { uiScale: 79 } }), /appearance\.uiScale/);
    assert.throws(() => settings.update({ appearance: { uiScalePhone: 112.5 } }), /appearance\.uiScalePhone/);
    assert.throws(() => settings.update({ appearance: { uiScalePhone: '120' as never } }), /appearance\.uiScalePhone/);
    assert.equal(settings.get().appearance!.uiScale, 100, 'nothing changed');
  } finally { done(); }
});

test('forgiving reads clamp into range and fall back to 100', () => {
  assert.equal(scaleOf(undefined), DEFAULT_SCALE);
  assert.equal(scaleOf('big'), DEFAULT_SCALE);
  assert.equal(scaleOf(300), SCALE_LIMITS[1]);
  assert.equal(scaleOf(10), SCALE_LIMITS[0]);
  assert.equal(scaleOf(112.4), 112);
  const look = appearanceOf({ uiScale: 140 });
  assert.equal(look.uiScale, 140);
  assert.equal(look.uiScalePhone, 100, 'an older file without the key');
});

test('Ctrl +/− step on the 10 % grid inside 80–150, Ctrl 0 goes back to 100', () => {
  assert.equal(stepScale(100, 1), 110);
  assert.equal(stepScale(100, -1), 90);
  assert.equal(stepScale(115, 1), 120, 'an odd value from the file lands on the grid');
  assert.equal(stepScale(115, -1), 110);
  assert.equal(stepScale(150, 1), 150, 'never past the largest');
  assert.equal(stepScale(80, -1), 80, 'never past the smallest');
  assert.equal(stepScale(140, 0), 100);
  let at = 100;
  for (let i = 0; i < 10; i += 1) at = stepScale(at, 1);
  assert.equal(at, 150);
  for (let i = 0; i < 10; i += 1) at = stepScale(at, -1);
  assert.equal(at, 80);
});
