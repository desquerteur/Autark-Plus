// Owns: the Discord invitation in the footer (17.11.2026): one link, one sentence, the permanent invitation – on every
// page, from one source (config.mjs maker.discordUrl, layout.mjs). Never: builds the site or opens Discord.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import privacy from '../src/pages/privacy.mjs';
import { release } from '../src/config.mjs';

const URL_ = 'https://discord.gg/2MXxH8c3ee';
const SENTENCE = 'Join the Teydra Lab Discord \u2013 talk AI agents, get help with OpenAutark.';

test('every page carries the Discord link with exactly the agreed sentence', () => {
  const html = privacy(release.fallback);
  const text = html.replace(/<[^>]+>/g, '');
  assert.equal((html.match(/discord\.gg\//g) || []).length, 1, 'one invitation link');
  assert.ok(html.includes(`<a href="${URL_}" rel="noopener">Join the Teydra Lab Discord</a>`));
  assert.equal((text.match(/Join the Teydra Lab Discord/g) || []).length, 1);
  assert.ok(text.includes(SENTENCE), 'the sentence stands as agreed');
});

test('the invitation is written down once in the site source, and the layout reads it from there', () => {
  const config = readFileSync(new URL('../src/config.mjs', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/layout.mjs', import.meta.url), 'utf8');
  assert.equal((config.match(/discord\.gg\//g) || []).length, 1);
  assert.equal((layout.match(/discord\.gg\//g) || []).length, 0, 'the layout reads it from the config');
});
