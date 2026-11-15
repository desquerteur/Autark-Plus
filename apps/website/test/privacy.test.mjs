import test from 'node:test';
import assert from 'node:assert/strict';
import privacy from '../src/pages/privacy.mjs';
import { release } from '../src/config.mjs';
import { readFileSync } from 'node:fs';

test('feedback privacy renders as a standalone canonical page', () => {
  const html = privacy(release.fallback);
  assert.match(html, /https:\/\/openautark\.com\/privacy\//);
  assert.equal((html.match(/<main id="main">/g) || []).length, 1);
});
test('notice retains receiver, transport, retention and rights information', () => {
  const html = privacy(release.fallback);
  for (const term of ['Meral Anna Hees', '5026 Salzburg', 'Google Cloud Firestore', 'europe-west3', 'official@teydralab.com', 'no fixed automatic deletion period', 'Your rights']) assert.ok(html.includes(term), term);
  assert.ok(!html.includes('5020 Salzburg'));
});
test('regular static build discovers privacy source, not a one-off dist patch', () => {
  const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  assert.match(build, /readdir\(join\(root, 'src\/pages'\)\)/);
  assert.match(build, /f\.endsWith\('\.mjs'\)/);
});

test('web and next desktop notice disclose automatic diagnostic attachment', () => {
  const ui = readFileSync(new URL('../../desktop/src/ui/feedback/FeedbackPrivacy.tsx', import.meta.url), 'utf8');
  for (const text of [privacy(release.fallback), ui]) {
    assert.ok(text.includes('automatically included if available'));
    assert.ok(text.includes('up to 15 entries and 2,000 characters'));
    assert.ok(text.includes('Your chat history is not attached.'));
    assert.ok(!text.includes('sharing is enabled'));
    assert.ok(!text.includes('enabled diagnostic sharing'));
  }
});
