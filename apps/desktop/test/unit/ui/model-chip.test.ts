// B-083 T2 (src/ui/chat/composer/ModelChip.tsx, src/ui/lib/route-preview.ts, src/ui/styles/composer.css): the composer's
// model menu – "Auto" first with the routed model beside it ("Opus 5.5 now"), a pick is a suggestion (modelHints, never
// the hard `models` pin), Auto clears model, effort and temperature; only the newest of each family while nothing is
// searched (an older version by search or while chosen, under "Older versions"); the temperature row (a native slider 0–1 in tenths, saved on change, value in a fixed cell,
// "Auto" button; saved as settings.temperatures, which chats.update takes) directly above the effort row; the effort
// row's default cells include xhigh. F26: "Auto" on the chip while nothing is suggested; F05: each row's source and full
// id (lib/model-name.ts pickerHints). The .tsx cannot be
// imported by node --test, so its wiring is read from the source (the window check: test/ui/model-menu-window.test.mjs).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTO } from '../../../src/ui/lib/route-preview.ts';

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/ui');
const read = (file: string) => readFileSync(path.join(ui, file), 'utf8');
const chip = read('chat/composer/ModelChip.tsx');

test('Auto is a visible choice: first row, the routed model beside it, checked while nothing is suggested', () => {
  assert.equal(AUTO, 'Auto');
  assert.match(chip, /aria-checked=\{!chosen\} onClick=\{\(\) => pick\('auto'\)\}>\s*<span class="menu-label"><span>\{AUTO\}<\/span><\/span>\s*\{routedName && <span class="menu-hint">\{chosen \? routedName : `\$\{routedName\} now`\}<\/span>\}/,
    '"now" only while nothing is suggested (a suggestion is what runs)');
});

test('a pick is a suggestion: modelHints, the old hard pin goes; Auto clears model, effort and a stored temperature', () => {
  assert.match(chip, /const id = settings\.modelHints\?\.\[agentId\] \?\? settings\.models\?\.\[agentId\];/, 'the suggestion first, an older chat\'s models entry still reads');
  assert.match(chip, /if \(modelId !== 'auto'\) return \{ models: rest, modelHints: \{ \.\.\.\(settings\.modelHints \?\? \{\}\), \[agentId\]: modelId \} \};/);
  assert.match(chip, /const rest = without\(settings\.models, agentId\);/);
  assert.doesNotMatch(chip, /models: \{ \.\.\.[^}]*\}, \[agentId\]: modelId/, 'never a hard pin');
  assert.match(chip, /efforts: without\(settings\.efforts, agentId\) \};\s*if \(settings\.temperatures\?\.\[agentId\] !== undefined\) patch\.temperatures = without\(settings\.temperatures, agentId\);/);
});

test('only the newest of each family unless searched or chosen; "Older versions" above the first older one shown', () => {
  assert.match(chip, /model\.id === chosen \|\| \(isChatModel\(model\) && \(q \|\| !model\.newer\)\)/);
  assert.match(chip, /const older = list\.findIndex\(\(model\) => model\.newer\);/);
  assert.match(chip, /rows\.splice\(older, 0, <p key="older" class="menu-title" role="presentation">Older versions<\/p>\)/);
});

test('the temperature row: slider 0–1 in tenths saved on change, value in a fixed cell, Auto; directly above the effort row', () => {
  assert.match(chip, /type="range" min=\{0\} max=\{1\} step=\{0\.1\}/);
  assert.match(chip, /onInput=\{\(event\) => setDraft\(tenths\(event\)\)\} onChange=\{\(event\) => commit\(tenths\(event\)\)\}/, 'moving only shows, letting go saves');
  assert.match(chip, /onPointerUp=\{\(event\) => \{ if \(shown === undefined\) commit\(tenths\(event\)\); \}\}/, 'a tap on Auto\'s resting 0.5 saves it');
  assert.match(chip, /<span class="temp-value">\{tempText\(shown\)\}<\/span>/);
  assert.match(chip, /onClick=\{\(\) => commit\(undefined\)\}>\{AUTO\}<\/button>/);
  assert.match(chip, /\n\s*<TemperatureRow key=\{agentId\} value=\{temperature\} onSave=\{saveTemperature\} \/>\s*<div class="menu-section effort-row"/, 'always shown');
  const chats = readFileSync(path.join(ui, '../runtime/rpc/handlers/chats.ts'), 'utf8');
  assert.match(chats, /const SETTINGS_KEYS = \[[^\]]*'temperatures'/, 'chats.update takes settings.temperatures (else every save toasts)');
  assert.match(chip, /temperatures: value === undefined \? without\(settings\.temperatures, agentId\) : \{ \.\.\.\(settings\.temperatures \?\? \{\}\), \[agentId\]: value \}/);
  const css = read('styles/composer.css');
  assert.match(css, /\.temp-row \.temp-value \{ flex: none; width: 32px;/, 'the value cell has one width ("0.3" and "Auto")');
  assert.match(css, /body:has\(\.mobile-shell\) \.popover \.temp-row \.temp-auto \{ min-height: 44px;/, 'a phone-sized Auto');
  assert.match(css, /\.effort-row \{ display: flex; gap: 4px; margin-top: 4px; padding: 6px 4px 2px; border-top: 1px solid var\(--line\); \}/, 'the effort zone as it was');
});

test('B-083 (live 09.11.): the temperature row\'s title says where a temperature reaches – the same fact the agent reads; no layout change', async () => {
  const { TEMPERATURE_FACT } = await import('../../../src/runtime/engines/http/temperature.ts');
  assert.match(chip, /<div class=\{`temp-row\$\{shown === undefined \? ' auto' : ''\}`\} role="group" aria-label="Temperature" title=\{TEMPERATURE_TIP\}>/, 'a title only');
  const tip = /export const TEMPERATURE_TIP = '([^']+)';/.exec(chip)?.[1] ?? '';
  for (const fact of ['comes first, so a temperature goes only where it costs none', 'API and local models that take one', 'Claude and Codex keep their own setting', 'older Claude models take one only without thinking, the newer ones none, Codex not at all']) {
    assert.ok(tip.includes(fact), `tooltip: ${fact}`);
    assert.ok(TEMPERATURE_FACT.toLowerCase().includes(fact.toLowerCase()), `agent fact: ${fact}`);
  }
});

test('F26: with nothing suggested the chip says "Auto" and the routed model muted after it; a pick names itself', () => {
  assert.match(chip, /const after = chosen \? sub : \[routedName, sub\]\.filter\(Boolean\)\.join\(' · '\) \|\| undefined;/);
  assert.match(chip, /\{chosen \? shortName\(chosen\) : AUTO\}\{after && <span class="sub">\{` \$\{after\}`\}<\/span>\}/);
  assert.doesNotMatch(chip, /shortName\(chosen \?\? routed\)/, 'the routed model never reads as a pick');
});

test('F05: each picker row shows where the model runs, its full id as the title; two rows alike add the id\'s end', async () => {
  assert.match(chip, /title=\{model\.id\} onClick=\{props\.onPick\}>/);
  assert.match(chip, /const hints = pickerHints\(list, \(model\) => shortName\(model\.id\) \?\? model\.id\);/);
  const { pickerHints } = await import('../../../src/ui/lib/model-name.ts');
  const hints = pickerHints([
    { id: 'codex:gpt-6.1-terra', model: 'gpt-6.1-terra', available: true, source: 'Codex' },
    { id: 'commandcode:gpt-6.1-terra', model: 'gpt-6.1-terra', available: false, source: 'commandcode' },
    { id: 'openrouter:deepseek/deepseek-v4', model: 'deepseek/deepseek-v4', available: true, source: 'OpenRouter' },
    { id: 'openrouter:deepseek/deepseek-v4-flash', model: 'deepseek/deepseek-v4-flash', available: true, source: 'OpenRouter' },
    { id: 'old:thing', model: 'thing', available: true },
  ], (model) => (model.model.includes('deepseek') ? 'DeepSeek V4' : model.model));
  assert.equal(hints.get('codex:gpt-6.1-terra'), 'Codex');
  assert.equal(hints.get('commandcode:gpt-6.1-terra'), 'commandcode · Unavailable', 'the same name from another source reads apart');
  assert.equal(hints.get('openrouter:deepseek/deepseek-v4'), 'OpenRouter · deepseek-v4');
  assert.equal(hints.get('openrouter:deepseek/deepseek-v4-flash'), 'OpenRouter · deepseek-v4-flash');
  assert.equal(hints.get('old:thing'), '', 'an older runtime\'s catalog without a source: no hint');
});

test('effort cells: the model\'s own, else Low … Max with Very high (an API row lists only none, or the suggested effort is not among them); the chip names any suggested effort', () => {
  assert.match(chip, /const EFFORTS: readonly Effort\[\] = \['low', 'medium', 'high', 'xhigh', 'max'\];/);
  assert.match(chip, /const listed: readonly Effort\[\] = chosenInfo\?\.efforts\.filter\(\(value\) => value !== 'none'\) \?\? \[\];\s*\/\/[^\n]*\n\s*const efforts = listed\.length && \(!effort \|\| listed\.includes\(effort\)\) \? listed : EFFORTS;/);
  assert.match(chip, /const sub = effort \? EFFORT_LABEL\[effort\] : undefined;/, 'also while the model is Auto');
});
