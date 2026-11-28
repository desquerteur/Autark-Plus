// Feedback 16.11.2026 (owner F15: "bevor man den QR-Code scannen kann … so ein Video …, was einem zeigt, wie man da
// Feedback macht"): the phone's feedback video. The Android app's own page (scripts/tour-page.mjs bundles
// src/ui/tour/phone-page.tsx and src/ui/tour/phone-page.css with esbuild into one tour.html; apps/android/build.ps1
// puts it into the APK) is one self-contained page that plays the phone's tour at once, with Skip, and opens the
// address the app takes as done; the iPhone web app plays the same tour once on its first start after pairing
// (src/ui/pwa/native.ts firstVideoHere, src/ui/shell/Shell.tsx); the replay dialog plays the phone's tour in the phone
// layout and keeps the variant it opened with.
// Owns: these assertions (one in-memory esbuild run, source checks for the .tsx/.java wiring). Never: a WebView or a phone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleTourPage } from '../../../scripts/tour-page.mjs';
import { VIDEO_SEEN_KEY, firstVideoHere } from '../../../src/ui/pwa/native.ts';
import { closeTour, openTour, tourOpen, tourVariant } from '../../../src/ui/tour/open.ts';

const source = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');

test('the Android app\'s page: one self-contained page with the phone tour; Skip and Continue open the done address', async () => {
  const html = await bundleTourPage();
  assert.match(html, /^<!doctype html>\n<html lang="en" data-theme="system">/, 'light or dark like the phone');
  assert.ok(html.includes(`content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"`), 'nothing but its own inline code');
  assert.match(html, /<body class="tour-page"><div id="tour"><\/div><script>/);
  assert.doesNotMatch(html, /<script src|<link |@import|url\(\s*["']?(?:https?:|\/\/)/, 'nothing loaded from anywhere');
  assert.ok(html.includes('autark-tour:done'), 'the address the app takes as done');
  assert.ok(html.includes('How to send feedback') && html.includes('Feedback is the megaphone, top right.'), 'the phone tour inside');
  assert.ok(html.includes('.tour-dock') && html.includes('--surface'), 'the tour\'s styles and the tokens inline');
  assert.ok(html.length < 400_000, `small (${html.length} bytes)`);
  assert.match(source('src/ui/tour/phone-page.tsx'), /<TourPlayer variant="phone" autoplay skip note=\{VOLUME_NOTE\} onDone=\{\(\) => \{ location\.href = DONE_ADDRESS; \}\} \/>/);
  const app = readFileSync(new URL('../../../../android/app/src/main/java/com/teydralab/autark/android/IntroTour.java', import.meta.url), 'utf8');
  assert.match(app, /DONE = "autark-tour:done"/, 'the app takes the same address');
});

test('the iPhone web app plays it once, on its first start after pairing; elsewhere never', () => {
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } };
  assert.equal(firstVideoHere(false, storage), false, 'not the iPhone web app');
  assert.equal(kept.size, 0);
  assert.equal(firstVideoHere(true, storage), true, 'the first start');
  assert.equal(kept.get(VIDEO_SEEN_KEY), '1');
  assert.equal(firstVideoHere(true, storage), false, 'never again');
  assert.equal(firstVideoHere(true, null), false, 'without storage no video, rather than on every start');
  assert.equal(firstVideoHere(true, { getItem: () => { throw new Error('denied'); }, setItem: () => undefined }), false);
  const shell = source('src/ui/shell/Shell.tsx');
  assert.match(shell, /useEffect\(\(\) => \{ if \(firstVideoHere\(\)\) openTour\(\{ autoplay: true \}\); \}, \[\]\);/);
  assert.match(shell, /<TourDialog phone=\{isMobile\.value\} \/>/, 'the phone layout plays the phone\'s tour');
  const dialog = source('src/ui/tour/TourDialog.tsx');
  assert.match(dialog, /const \[variant\] = useState\(\(\) => tourVariant\.peek\(\) \?\? \(tourVariant\.value = props\.variant\)\);/, 'the opening\'s variant stays while it plays, also across a remount');
  assert.match(dialog, /<TourPlayer onDone=\{closeTour\} autoplay=\{tourAutoplay\.peek\(\)\} variant=\{variant\} \/>/);
});

test('the opening\'s variant is kept while the tour is open and cleared when it closes', () => {
  closeTour();
  assert.equal(tourVariant.value, null, 'closed: no variant');
  openTour();
  assert.equal(tourOpen.value, true);
  tourVariant.value = 'phone'; // what TourDialog stores on its first mount
  assert.equal(tourVariant.peek() ?? 'desktop', 'phone', 'a remount after a breakpoint switch reads the opening\'s variant');
  closeTour();
  assert.equal(tourOpen.value, false);
  assert.equal(tourVariant.value, null, 'the next opening chooses afresh');
});
