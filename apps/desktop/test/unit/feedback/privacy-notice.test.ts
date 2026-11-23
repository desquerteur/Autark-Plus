// Owns: the controller address shown in the app's feedback privacy notice.
// Never: fetches the website or sends feedback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('feedback privacy gives the published controller address', () => {
  const notice = readFileSync(new URL('../../../src/ui/feedback/FeedbackPrivacy.tsx', import.meta.url), 'utf8');
  // Verified against https://openautark.com/privacy/ on 2026-11-16.
  // Postal source: Statistik Austria, gemplzstr_5.pdf, p. 36 (2026-11-12).
  assert.match(notice, /Teydra Lab, operated by Meral Anna Hees,\s+Ludwig-Richter-Straße 4a\/Top3, 5026 Salzburg, Austria\./);
  assert.match(notice, /href="mailto:official@teydralab\.com"/);
  assert.match(notice, /href="https:\/\/openautark\.com\/privacy\/"/);
});
