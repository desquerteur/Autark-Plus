import test from 'node:test';
import assert from 'node:assert/strict';
import impressum from '../src/pages/impressum.mjs';
import home from '../src/pages/home.mjs';
import { maker, release } from '../src/config.mjs';

test('the imprint is a page of its own and names the publisher in full', () => {
  const html = impressum(release.fallback);
  assert.match(html, /<link rel="canonical" href="https:\/\/openautark\.com\/impressum\/"/);
  assert.equal((html.match(/<main id="main">/g) || []).length, 1);
  for (const term of ['Meral Anna Hees (Teydra Lab)', 'Ludwig-Richter-Straße 4a/Top3', '5026 Salzburg, Austria', 'created and owned by Stanislaus Hees', 'the sole proprietorship of Meral Anna Hees (Salzburg, Austria)', 'legal publisher and media owner', 'gehört ihm', 'official@teydralab.com', 'GISA number', 'Magistrat der Stadt Salzburg', 'github.com/teydra/OpenAutark']) assert.ok(html.includes(term), term);
  assert.ok(!html.includes('5020 Salzburg'));
  assert.ok(!/Meral Hees/.test(html), 'the name is always written in full');
});

test('every footer links to this site\'s own imprint', async () => {
  assert.equal(maker.imprintUrl, 'https://openautark.com/impressum/');
  const html = await home(release.fallback);
  assert.match(html, /<nav aria-label="Legal"><a href="https:\/\/openautark\.com\/impressum\/" rel="noopener">Imprint<\/a>/);
});
