// 10.11.2026 (CEO screenshot, Samsung, Android app): "Not paired" showed the old list and "Pair it again…" with no button –
// the recovery row was iPhone-only (inHostedApp). Both phone apps now get it; "Not paired" names it "Pair again".
// Feedback 16.11.2026 F15: Pair again in the Android app pairs over the company ('add') instead of forgetting it first;
// a refusal (4401) goes to the app ('refused') so it tries the company's next PC; the offline sub line says it keeps trying.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signal } from '@preact/signals';
import { isPhoneApp, pairAgain, reportRefusals } from '../../../src/ui/pwa/native.ts';
import { adoptPort, resetNativePort } from '../../../src/ui/pwa/native-port.ts';

const app = readFileSync(new URL('../../../src/ui/App.tsx', import.meta.url), 'utf8');

class FakePort {
  sent: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage(data: unknown) { this.sent.push(data); }
  close() { /* nothing to close */ }
}

test('the not-paired views offer a way back in both phone apps, not only the iPhone web app', () => {
  assert.equal(typeof isPhoneApp, 'function');
  assert.doesNotMatch(app, /inHostedApp\(\) && \(/, 'no iPhone-only recovery row is left');
  assert.match(app, /isPhoneApp\(\) && \( \/\/ 10\.11\.2026/);
  assert.match(app, /\{props\.accessOff \? 'Pair again' : 'Forget this phone'\}/);
  assert.match(app, /onClick=\{props\.accessOff \? pairAgain : forgetThisPhone\}/, 'Pair again pairs; Forget this phone forgets');
  assert.match(app, /<BootNote text="This device is no longer paired\." detail=\{accessOffDetail\(\)\} repair \/>/);
  assert.match(app, /props\.repair && isPhoneApp\(\) && <button type="button" class="button" onClick=\{pairAgain\}>Pair again<\/button>/);
  assert.match(app, /Pair again, enter the PC's Remote ID, then accept on the PC\./);
});

// 10.11.2026: the Android app keeps every PC of the company; one refusing PC should not force forgetting all of them.
test('the Android app offers Choose PC (native picker) before Pair again in both not-paired views', () => {
  assert.match(app, /import \{ [^}]*\bshowPcs\b[^}]* \} from '\.\/pwa\/phone-companies\.ts';/);
  assert.match(app, /isAndroidApp\(\) && <button type="button" class="button secondary" onClick=\{\(\) => showPcs\(\)\}>Choose PC<\/button>/);
  assert.match(app, /props\.repair && isAndroidApp\(\) && <button type="button" class="button secondary" onClick=\{\(\) => showPcs\(\)\}>Choose PC<\/button>/);
  assert.match(app, /isAndroidApp\(\) \? 'Choose another PC, or tap' : 'Tap'/);
});

test('Pair again: the Android app gets "add" (its pairing over this company); the iPhone web app and an app without its port forget', () => {
  const page = globalThis as { autarkHosted?: unknown; location?: { href: string } };
  const before = { hosted: page.autarkHosted, location: page.location };
  try {
    resetNativePort();
    const port = new FakePort();
    adoptPort(port as unknown as MessagePort);
    pairAgain();
    assert.deepEqual(port.sent, ['{"t":"add"}'], 'no forget first');

    let forgot = 0;
    page.autarkHosted = { v: 1, base: '/app/', socket: () => undefined, frameUrl: () => '', forget: async () => { forgot++; } };
    pairAgain();
    assert.equal(forgot, 1, 'the iPhone web app keeps its own way');
    assert.equal(port.sent.length, 1);

    page.autarkHosted = undefined;
    resetNativePort();
    page.location = { href: '' };
    pairAgain();
    assert.equal(page.location.href, 'autark-app:forget', 'an Android app before its port: the old address');
  } finally {
    page.autarkHosted = before.hosted;
    page.location = before.location;
    resetNativePort();
  }
});

test('a refused socket (opened, then closed with 4401) tells the Android app "refused" once per refusal; other closes do not', () => {
  resetNativePort();
  const status = signal<'connecting' | 'open' | 'closed'>('connecting');
  const refused = signal<4401 | 4403 | null>(null);
  const stop = reportRefusals({ status, refused }, true);
  try {
    status.value = 'closed'; // a PC out of reach: never opened
    refused.value = 4401;
    status.value = 'connecting';
    status.value = 'closed'; // still not opened: no refusal of this PC
    const port = new FakePort();
    adoptPort(port as unknown as MessagePort);
    assert.deepEqual(port.sent, []);
    status.value = 'open';
    status.value = 'closed'; // the PC refused the token
    assert.deepEqual(port.sent, ['{"t":"refused"}']);
    status.value = 'connecting';
    status.value = 'open';
    status.value = 'closed'; // the next PC refused as well
    assert.equal(port.sent.length, 2);
    refused.value = 4403;
    status.value = 'open';
    status.value = 'closed'; // removed: that ends at once, no next PC
    assert.equal(port.sent.length, 2);
  } finally { stop(); resetNativePort(); }
  assert.equal(typeof reportRefusals({ status, refused }, false), 'function', 'outside the Android app nothing is wired');
});

test('a refusal before the app handed over its port is told once the port arrives', () => {
  resetNativePort();
  const status = signal<'connecting' | 'open' | 'closed'>('open');
  const refused = signal<4401 | 4403 | null>(null);
  const stop = reportRefusals({ status, refused }, true);
  try {
    refused.value = 4401;
    status.value = 'closed';
    const port = new FakePort();
    adoptPort(port as unknown as MessagePort);
    assert.deepEqual(port.sent, ['{"t":"refused"}']);
    const next = new FakePort();
    adoptPort(next as unknown as MessagePort);
    assert.deepEqual(next.sent, [], 'told once');
  } finally { stop(); resetNativePort(); }
});

test('the offline sub line says the phone keeps trying (naming the PC when the app does); Not paired keeps its words', () => {
  assert.match(app, /sub=\{<span class="offline-badge" role="status">\{offlineLine\(props\.accessOff, snapshot\.at\)\}<\/span>\}/);
  assert.match(app, /if \(accessOff\) return `Not paired · \$\{relative\(at\)\}`;/);
  assert.match(app, /return `Offline · trying \$\{pc \? `\$\{pc\} ` : ''\}again · \$\{relative\(at\)\}`;/);
  assert.match(app, /useEffect\(\(\) => reportRefusals\(rpc\), \[\]\);/);
});
