// Settings search (ui/settings/sections.ts searchSections): the words of rows that are still on a page find it – the
// Devices page's "Accept connection requests" row by "connection" (B-078 review). F20 (16.11.2026): what a page holds finds
// it too (settings-words.ts – a secret's or an app's name; a page this session may not use stays out, and only the lists it
// may call load), the open page's rows that hold every word get their words marked (search-marks.ts), and a settings page on
// the phone carries the settings search in its top row instead of the palette (shell/views.ts).
// Owns: these assertions only. Never: a DOM or a runtime (rpc.call and the session are stubbed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, searchSections, visibleSections } from '../../../src/ui/settings/sections.ts';
import { holdsAll, pieceRanges } from '../../../src/ui/settings/search-marks.ts';
import { appWords, secretWords, settingsWords, skillWords, wantSettingsWords } from '../../../src/ui/settings/settings-words.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';
import { session } from '../../../src/ui/lib/session.ts';
import type { SecretGroup, SecretInfo } from '../../../src/shared/model/security.ts';
import type { ConnectedApp } from '../../../src/shared/model/apps.ts';
import type { SkillInfo } from '../../../src/shared/model/knowledge.ts';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/ui');
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((section) => section.id);

test('"connection" and "connection requests" find the Devices page', () => {
  for (const text of ['connection', 'connection requests', 'accept connection requests', 'meeting server']) {
    assert.ok(searchSections(text).some((section) => section.id === 'devices'), text);
  }
});

const secrets = [
  { id: 'sec_gh', label: 'GitHub CI token', kind: 'token', description: 'Releases from CI.', tags: ['deploy'], createdAt: 1 },
  { id: 'sec_app', label: 'Feedback receiver', kind: 'api_key', createdBy: 'system', createdAt: 1 },
  { id: 'sec_f1', label: 'Bank login · password', kind: 'password', group: { id: 'sgr_bank', label: 'Bank login', kind: 'login' }, field: 'password', createdAt: 1 },
] as SecretInfo[];
const groups = [{ id: 'sgr_bank', label: 'Bank login', kind: 'login', description: 'Online banking of Sparkasse', source: 'sparkasse.example', createdAt: 1 }] as SecretGroup[];
const apps = [{ id: 'linear', name: 'Linear', address: 'mcp.linear.app', transport: 'http', status: 'on', tools: 3 }] as unknown as ConnectedApp[];
const skills = [{ name: 'invoice-check', description: 'Checks open invoices', source: 'user', path: '/s' }] as SkillInfo[];

test('F20: what a page holds finds it – a secret\'s name, purpose or source, an app\'s name or address, a skill – beside the fixed keywords', () => {
  const words = { secrets: secretWords(secrets, groups), apps: appWords(apps), skills: skillWords(skills) };
  assert.deepEqual(ids(searchSections('github', SECTIONS, words)), ['secrets', 'apps', 'updates'], 'the Apps page keeps its keyword github (Autark-Plus: the Updates page names its GitHub source too)');
  assert.deepEqual(ids(searchSections('sparkasse', SECTIONS, words)), ['secrets'], 'a login\'s purpose and source');
  assert.deepEqual(ids(searchSections('mcp.linear', SECTIONS, words)), ['apps']);
  assert.deepEqual(ids(searchSections('invoice check', SECTIONS, words)), ['skills'], 'a skill by its name\'s words');
  assert.deepEqual(ids(searchSections('feedback receiver', SECTIONS, words)), [], 'the app\'s own entry stays out, as on the page');
  assert.doesNotMatch(words.secrets, /bank login · password/, 'a login\'s field rows are no entries of their own');
  const phone = visibleSections((method) => method !== 'secrets.list');
  assert.ok(!ids(searchSections('github', phone, words)).includes('secrets'), 'a page this session may not use stays out');
  assert.ok(ids(searchSections('password', SECTIONS, {})).includes('secrets'), 'the fixed keywords still work');
});

test('F20: the marks – a row counts when it holds every word of two letters or more; each word is marked where it starts a word', () => {
  assert.equal(holdsAll('GitHub CI token · Releases', 'github token'), true);
  assert.equal(holdsAll('GitHub CI token', 'github stripe'), false);
  assert.equal(holdsAll('Anything', 'a'), false, 'one letter marks nothing, so it finds no row');
  assert.deepEqual(pieceRanges(['GitHub ', 'CI token', 'Releases from GitHub'], 'github token'), [[0, 0, 6], [1, 3, 8], [2, 14, 20]]);
  assert.deepEqual(pieceRanges(['Nothing here'], 'github'), []);
});

test('F20: a settings page on the phone carries the settings search in its top row, not the palette', () => {
  const views = readFileSync(path.join(SRC, 'shell/views.ts'), 'utf8');
  assert.match(views, /\{ key: 'settings', body: h\(Settings, null\), pushed, title: settingsSectionTitle\(current\.section\), back: 'settings', header: settingsNavHeader, ownHeader: false \}/);
  const nav = readFileSync(path.join(SRC, 'settings/SettingsNav.tsx'), 'utf8');
  assert.match(nav, /if \(nextSearchHit\(\)\) return;/, 'Enter goes to the open page\'s next hit first');
  assert.match(nav, /section\.id === current && pageHits\.value > 0/, 'the open page stays listed while it holds hits');
  assert.match(readFileSync(path.join(SRC, 'styles/settings.css'), 'utf8'), /::highlight\(settings-search\) \{ background-color: color-mix\(in srgb, var\(--update\) 22%, transparent\); \}/);
});

test('F20: the words load once a search holds text, only from the lists this session may call – never a value', async (t) => {
  const real = rpc.call;
  const before = session.value;
  t.after(() => { (rpc as unknown as { call: unknown }).call = real; session.value = before; });
  const called: string[] = [];
  (rpc as unknown as { call: unknown }).call = async (method: string) => {
    called.push(method);
    if (method === 'apps.list') return apps;
    if (method === 'skills.list') return skills;
    throw new Error(`not stubbed: ${method}`);
  };
  session.value = { kind: 'device', capabilities: ['settings'], secure: true, allowedMethods: ['apps.list', 'skills.list'] } as never;
  wantSettingsWords();
  wantSettingsWords(); // once
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(called.sort(), ['apps.list', 'skills.list']);
  assert.match(settingsWords.value.apps ?? '', /linear/);
  assert.match(settingsWords.value.skills ?? '', /invoice check/);
  assert.equal(settingsWords.value.secrets, undefined);
  assert.equal(settingsWords.value.models, undefined, 'the accounts only where the session may detect them');
});
