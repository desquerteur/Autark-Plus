// Owns: the Toolradar vendor link in the footer (16.11.2026): a plain, followable link – no script, iframe, image or
// pixel from Toolradar, so a page view makes no request to them. Never: builds the site or fetches Toolradar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import privacy from '../src/pages/privacy.mjs';
import { release } from '../src/config.mjs';

test('every page carries one plain followable Toolradar link and nothing else from Toolradar', () => {
  const html = privacy(release.fallback);
  const links = [...html.matchAll(/<a\b[^>]*href="https:\/\/toolradar\.com[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(links, ['<a href="https://toolradar.com/tools/autark">']);
  assert.ok(!/nofollow/i.test(links[0]));
  assert.equal((html.match(/toolradar/gi) || []).length, 2, 'only the link: its address and the word in its text');
  for (const tag of ['script', 'iframe', 'img', 'link']) assert.ok(!new RegExp(`<${tag}\b[^>]*toolradar`, 'i').test(html), tag);
});

test('the footer source is the only place that names Toolradar', () => {
  const layout = readFileSync(new URL('../src/layout.mjs', import.meta.url), 'utf8');
  assert.equal((layout.match(/toolradar\.com/g) || []).length, 1);
});
