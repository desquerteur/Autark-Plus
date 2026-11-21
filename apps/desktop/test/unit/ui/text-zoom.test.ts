// 17.11.2026 (Theo, portrait product videos): Ctrl +/−/0 sizes a chat's text on the desktop, stored on this PC; only the
// chat's own column grows (CSS zoom), never the tab area with its native pages; the window may be narrow (phone layout).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextZoom, parseZoom, zoomKey, ZOOM_STEPS } from '../../../src/ui/chat/text-zoom.ts';
import { MIN_WIDTH } from '../../../src/main/window-state.ts';

const read = (file: string) => readFileSync(new URL(`../../../src/${file}`, import.meta.url), 'utf8');

test('steps: larger, smaller, back to 100 %, never past the ends', () => {
  assert.equal(nextZoom(1, 1), 1.1);
  assert.equal(nextZoom(1.1, 1), 1.25);
  assert.equal(nextZoom(1.25, -1), 1.1);
  assert.equal(nextZoom(2.5, 0), 1);
  assert.equal(nextZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1]!, 1), 3);
  assert.equal(nextZoom(0.8, -1), 0.8);
  assert.equal(nextZoom(1.3, 1), 1.5, 'an odd value finds the next step');
});

test('the stored value: a known step, else 100 %', () => {
  assert.equal(parseZoom('1.5'), 1.5);
  assert.equal(parseZoom(null), 1);
  assert.equal(parseZoom('7'), 1);
  assert.equal(parseZoom('abc'), 1);
});

test('keys: Ctrl with + or = (Shift or numpad give +), − and 0; Alt or no Ctrl is no zoom', () => {
  assert.equal(zoomKey({ key: '=', mod: true, alt: false }), 1);
  assert.equal(zoomKey({ key: '+', mod: true, alt: false }), 1);
  assert.equal(zoomKey({ key: '-', mod: true, alt: false }), -1);
  assert.equal(zoomKey({ key: '0', mod: true, alt: false }), 0);
  assert.equal(zoomKey({ key: '+', mod: false, alt: false }), undefined);
  assert.equal(zoomKey({ key: '+', mod: true, alt: true }), undefined, 'AltGr on a German keyboard');
  assert.equal(zoomKey({ key: 'k', mod: true, alt: false }), undefined);
});

test('wiring: the chat column zooms except its tab area; desktop only, after the pane keys; the window may be 400 px wide', () => {
  assert.match(read('ui/styles/chat.css'), /\.chat-column > :not\(\.chat-area\) \{ zoom: var\(--chat-zoom, 1\); \}/);
  const shell = read('ui/shell/Shell.tsx');
  assert.match(shell, /if \(platform !== 'desktop'\) return undefined;\s*restoreChatZoom\(\);/);
  assert.match(shell, /if \(event\.defaultPrevented \|\| event\.isComposing\) return;/);
  assert.equal(MIN_WIDTH, 400);
});
