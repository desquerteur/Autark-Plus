// B-081 T9: the phone's mirrored browser wiring, read from the sources (no DOM here) – the touch / touchpad switch is a
// fixed toolbar cell under a touch pointer (after the PC's mark, before the address; pressed changes its colour only),
// the mode is this viewer's localStorage convenience (never a setting, storage failures are survived); the zoom is a
// number the surface's pinch reports back, and the surface zooms by a transform (no zoom class); the keyboard opens by
// itself when the page reports a text field focused (a new stamp each time) within KEYS_AFTER_TAP_MS of this viewer's
// own tap, Type stays (blur, then focus); a
// box that only got shorter while the key field has focus is not sent (the keyboard opening re-lays out nothing).
// Owns: these assertions only. Never: a DOM, runtime or socket.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/ui/workspace');
const source = (file: string) => readFileSync(path.join(WORKSPACE, file), 'utf8');
const tab = source('RemoteWebTab.tsx');
const surface = source('BrowserSurface.tsx');

test('one fixed switch cell between the PC mark and the address, only under a touch pointer; the mode is kept per viewer', () => {
  const toolbar = /<div class="browser-live-toolbar">([^]*?)\n {6}<\/div>/.exec(tab)?.[1] ?? '';
  const order = ['class="remote-web-mark"', 'icon="cursor-click"', '<Address'].map((cell) => toolbar.indexOf(cell));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!)), `mark, switch, address: ${order.join(', ')}`);
  assert.match(toolbar, /\{touch && \(\s*<IconButton icon="cursor-click" size="small" pressed=\{mode === 'pad'\}/, 'one icon in both modes, pressed = touchpad (colour only)');
  assert.match(tab, /export const INPUT_MODE_KEY = 'wf\.remote\.inputMode';/);
  assert.match(tab, /try \{ return localStorage\.getItem\(INPUT_MODE_KEY\) === 'pad' \? 'pad' : 'touch'; \} catch \{ return 'touch'; \}/, 'blocked storage: touch');
  assert.match(tab, /try \{ localStorage\.setItem\(INPUT_MODE_KEY, mode\); \} catch/);
  assert.match(tab, /<BrowserSurface [^>]*onZoom=\{setZoom\} mode=\{touch \? mode : 'touch'\}/);
});

test('the zoom is a number the pinch reports back; the surface draws it as a transform, the cursor as an overlay', () => {
  assert.match(tab, /const \[zoom, setZoom\] = useState\(1\);/);
  assert.match(tab, /pressed=\{zoom > 1\} onClick=\{\(\) => setZoom\(zoom > 1 \? 1 : 2\)\}/, 'the same button: 2 or back to 1');
  assert.match(surface, /transform: translate\(\$\{view\.x\.toFixed\(1\)\}px, \$\{view\.y\.toFixed\(1\)\}px\) scale\(\$\{view\.s\.toFixed\(3\)\}\)/);
  assert.match(surface, /class="browser-touch" data-app-keys/, 'no zoom class: the layout never changes with the zoom');
  assert.match(surface, /props\.onZoom\?\.\(zoomed\.current\.s\)/, 'where a pinch ended goes back to the button');
  assert.match(surface, /const lifted = \(\) => \{ show\(settle\(zoomed\.current\)\);/, 'settled only when the fingers lift');
  assert.match(surface, /if \(event\.touches\.length === 0\) lifted\(\);/);
  assert.match(surface, /onTouchCancel=\{\(\) => \{ gestures\.cancel\(\); lifted\(\); \}\}/);
  assert.match(surface, /<span class="browser-pad-cursor" aria-hidden="true" style=\{\{ transform: `translate\(/);
  assert.match(surface, /const gestures = props\.mode === 'pad' \? pad : touch;/);
});

test('the keyboard follows the page\'s focus after this viewer\'s tap; a keyboard-only shrink of the box is not sent', () => {
  assert.match(tab, /export const KEYS_AFTER_TAP_MS = 2000;/);
  assert.match(tab, /if \(input\.kind === 'mouse' && input\.type === 'up'\) pressAt\.current = Date\.now\(\);/, 'this viewer\'s own tap or click');
  assert.match(tab, /const editing = state\?\.editing;/, 'a stamp: each tap into a text field is news, the next field too');
  assert.match(tab, /if \(editing !== undefined\) \{ if \(!focused && Date\.now\(\) - pressAt\.current < KEYS_AFTER_TAP_MS\) field\.focus\(\{ preventScroll: true \}\); \}\s*else if \(focused\) field\.blur\(\);\s*\}, \[editing\]\);/);
  assert.match(tab, /onClick=\{\(\) => \{ const field = keys\.current; field\?\.blur\(\); field\?\.focus\(\{ preventScroll: true \}\); \}\}\s*title="[^"]*">Type<\/Button>/,
    'Type stays for every other case – blur first, so a field that kept its focus without a keyboard gets it again in this tap');
  assert.match(tab, /document\.activeElement === keys\.current && view\.width === was\.width && view\.height < was\.height\) return;/);
});
