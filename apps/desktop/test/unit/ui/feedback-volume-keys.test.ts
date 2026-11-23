// Feedback 16.11.2026 (owner F15: "wenn man in der App ist, … so eine Tastenkombination"): the phone's quick way into
// feedback – the Android app tells the page {t:'feedback', down} when volume up and volume down go down together and when
// they are let go (apps/android VolumePair); the page reads it (src/ui/pwa/native-port.ts feedbackKeySteps) and presses
// its feedback cell with it, as the desktop shortcut does (src/ui/feedback/FeedbackButton.tsx listenFeedbackKey: a
// KeyPress of its own on the cells' one PressTracker) – short opens the overlay, held talks, a lost release ends on the
// next press; nothing of it is replayed to a later page.
// Owns: these assertions with a fake port and a fake clock (and source checks for the .tsx/.java wiring). Never: a
// WebView, a phone or a microphone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adoptPort, feedbackKeySteps, onNative, resetNativePort } from '../../../src/ui/pwa/native-port.ts';
import { KeyPress, PressTracker } from '../../../src/ui/feedback/press.ts';
import type { Schedule } from '../../../src/ui/feedback/press.ts';

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage() { /* the page sends nothing here */ }
  close() { /* nothing to free */ }
  fromApp(msg: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent); }
}

/** The page's wiring with a fake app and clock: the app's messages press a tracker that logs what the cell would do. */
function phone() {
  const log: string[] = [];
  let due: (() => void) | null = null;
  const schedule: Schedule = (run) => { due = run; return () => { if (due === run) due = null; }; };
  const tracker = new PressTracker({
    press: () => log.push('press'),
    tap: (source) => log.push(`tap ${source}`),
    holdStart: () => log.push('hold start'),
    holdEnd: () => log.push('hold end'),
    holdCancel: () => log.push('hold cancel'),
  }, { canHold: () => true, schedule });
  const keys = new KeyPress(tracker);
  resetNativePort();
  const app = new FakePort();
  adoptPort(app as unknown as MessagePort);
  onNative('feedback', (msg) => { for (const step of feedbackKeySteps(msg)) if (step === 'down') keys.down(); else keys.up(); });
  return { log, app, keys, held: () => { const run = due; due = null; run?.(); } };
}

test('the message\'s steps: down, up, or one whole press', () => {
  assert.deepEqual(feedbackKeySteps({ t: 'feedback', down: true }), ['down']);
  assert.deepEqual(feedbackKeySteps({ t: 'feedback', down: false }), ['up']);
  assert.deepEqual(feedbackKeySteps({ t: 'feedback' }), ['down', 'up'], 'an app that only says "feedback"');
  assert.deepEqual(feedbackKeySteps({ t: 'feedback', down: 'yes' }), ['down', 'up'], 'anything else is one press');
});

test('a short press of the pair is the cell\'s tap: the snapshot first, then the overlay opens', () => {
  const { log, app } = phone();
  app.fromApp({ t: 'feedback', down: true });
  assert.deepEqual(log, ['press'], 'going down freezes the window at once (the cell\'s pointer down)');
  app.fromApp({ t: 'feedback', down: false });
  assert.deepEqual(log, ['press', 'tap pointer'], 'let go before the hold: a tap that took its snapshot');
  app.fromApp({ t: 'feedback' });
  assert.deepEqual(log.slice(2), ['press', 'tap pointer'], 'one whole press works the same');
  resetNativePort();
});

test('held, the pair talks like a held cell; let go, the words go into the overlay', () => {
  const { log, app, held } = phone();
  app.fromApp({ t: 'feedback', down: true });
  held();
  assert.deepEqual(log, ['press', 'hold start']);
  app.fromApp({ t: 'feedback', down: false });
  assert.deepEqual(log, ['press', 'hold start', 'hold end']);
  resetNativePort();
});

test('a lost release ends on the next press; a release without a press, or a blur, changes nothing more', () => {
  const { log, app, keys } = phone();
  app.fromApp({ t: 'feedback', down: false });
  assert.deepEqual(log, [], 'no press was running');
  app.fromApp({ t: 'feedback', down: true });
  app.fromApp({ t: 'feedback', down: true });
  assert.deepEqual(log, ['press', 'tap pointer', 'press'], 'the earlier press is let go first');
  keys.blur();
  assert.deepEqual(log.slice(3), ['tap pointer'], 'the page losing the window lets it go');
  keys.blur();
  assert.equal(log.length, 4);
  resetNativePort();
});

test('nothing of it reaches a later page: the press is not replayed to a new subscriber', () => {
  const { app } = phone();
  app.fromApp({ t: 'feedback', down: true });
  const late: unknown[] = [];
  onNative('feedback', (msg) => late.push(msg));
  assert.deepEqual(late, []);
  resetNativePort();
});

test('the wiring: the cell takes the phone\'s keys on the same press as its pointer and the shortcut; the app sends them', () => {
  const button = readFileSync(new URL('../../../src/ui/feedback/FeedbackButton.tsx', import.meta.url), 'utf8');
  assert.match(button, /const phoneKeys = new KeyPress\(press\);/, 'a KeyPress of its own on the one press of every cell');
  assert.match(button, /onNative\('feedback', \(msg\) => \{ for \(const step of feedbackKeySteps\(msg\)\) keyStep\(phoneKeys, step\); \}\)/);
  assert.match(button, /const blur = \(\) => \{ keyPress\.blur\(\); phoneKeys\.blur\(\); \};/);
  assert.match(button, /return \(\) => \{ keyListening = false; stop\(\); stopPhone\(\); window\.removeEventListener\('blur', blur\); \};/);
  assert.match(readFileSync(new URL('../../../src/ui/feedback/FeedbackMenu.tsx', import.meta.url), 'utf8'), /useEffect\(\(\) => listenFeedbackKey\(\), \[\]\);/, 'the feedback host installs it on every page');
  const port = readFileSync(new URL('../../../../android/app/src/main/java/com/teydralab/autark/android/NativePort.java', import.meta.url), 'utf8');
  assert.match(port, /put\("t", "feedback"\)\.put\("down", down\)/, 'the Android app sends {t:\'feedback\', down}');
});
