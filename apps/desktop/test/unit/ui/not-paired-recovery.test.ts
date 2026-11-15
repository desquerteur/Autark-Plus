// 10.11.2026 (CEO screenshot, Samsung, Android app): "Not paired" showed the old list and "Pair it again…" with no button –
// the recovery row was iPhone-only (inHostedApp). Both phone apps now get it; "Not paired" names it "Pair again".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPhoneApp } from '../../../src/ui/pwa/native.ts';

const app = readFileSync(new URL('../../../src/ui/App.tsx', import.meta.url), 'utf8');

test('the not-paired views offer a way back in both phone apps, not only the iPhone web app', () => {
  assert.equal(typeof isPhoneApp, 'function');
  assert.doesNotMatch(app, /inHostedApp\(\) && \(/, 'no iPhone-only recovery row is left');
  assert.match(app, /isPhoneApp\(\) && \( \/\/ 10\.11\.2026/);
  assert.match(app, /\{props\.accessOff \? 'Pair again' : 'Forget this phone'\}/);
  assert.match(app, /<BootNote text="This device is no longer paired\." detail=\{accessOffDetail\(\)\} repair \/>/);
  assert.match(app, /props\.repair && isPhoneApp\(\) && <button type="button" class="button" onClick=\{forgetThisPhone\}>Pair again<\/button>/);
  assert.match(app, /Pair again, enter the PC's Remote ID, then accept on the PC\./);
});

// 10.11.2026: the Android app keeps every PC of the company; one refusing PC should not force forgetting all of them.
test('the Android app offers Choose PC (native picker) before Pair again in both not-paired views', () => {
  assert.match(app, /import \{ showPcs \} from '\.\/pwa\/phone-companies\.ts';/);
  assert.match(app, /isAndroidApp\(\) && <button type="button" class="button secondary" onClick=\{\(\) => showPcs\(\)\}>Choose PC<\/button>/);
  assert.match(app, /props\.repair && isAndroidApp\(\) && <button type="button" class="button secondary" onClick=\{\(\) => showPcs\(\)\}>Choose PC<\/button>/);
  assert.match(app, /isAndroidApp\(\) \? 'Choose another PC, or tap' : 'Tap'/);
});
