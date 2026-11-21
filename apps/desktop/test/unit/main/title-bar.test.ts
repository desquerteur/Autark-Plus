// The native caption controls belong to the UI's header row: same height (Windows/Linux overlay =
// --header-h in both layouts – the compact window's top bar is that row, mobile.css), same color per
// theme (overlay color = --chrome), macOS traffic lights centered in the same row. Reads the
// CSS text; no Electron.
// Owns: main/title-bar.ts ↔ styles/tokens.css parity. Never: renders a window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLE_BAR_HEIGHT } from '../../../src/shared/api/desktop.ts';
import { dimmedColors, overlayHeight, titleBarColors, titleBarOverlay, trafficLightPosition } from '../../../src/main/title-bar.ts';

const STYLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/ui/styles');
const tokens = readFileSync(path.join(STYLES, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The value of `name` inside the first block that starts at `marker`. */
function token(marker: string, name: string): string {
  const start = tokens.indexOf(marker);
  assert.ok(start >= 0, `marker not found: ${marker}`);
  const block = tokens.slice(start, tokens.indexOf('}', start));
  const value = block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
  assert.ok(value, `${name} not found after ${marker}`);
  return value;
}

test('the overlay fills its row in both layouts; heights match the tokens', () => {
  assert.equal(`${TITLE_BAR_HEIGHT}px`, token(':root {', '--header-h'));
  // One pixel short of the row, so the sheet's edge line (the top bar's line) below the row stays visible.
  assert.equal(overlayHeight('columns'), TITLE_BAR_HEIGHT - 1);
  assert.equal(overlayHeight('compact'), TITLE_BAR_HEIGHT - 1, 'the compact top bar holds the controls: no strip above it');
  assert.equal(titleBarOverlay(false).height, TITLE_BAR_HEIGHT - 1, 'a new window starts in the column layout');
  assert.equal(titleBarOverlay(true, 'compact').height, TITLE_BAR_HEIGHT - 1);
  assert.equal(titleBarOverlay(false, 'columns').color, titleBarOverlay(false, 'compact').color);
});

test('the overlay color is the header row color (--chrome) in light and dark', () => {
  assert.equal(titleBarColors(false).color, token(':root {', '--chrome'));
  assert.equal(titleBarColors(true).color, token(':root[data-theme=dark]', '--chrome'));
  assert.equal(titleBarColors(true).color, token(':root[data-theme=system]', '--chrome'));
  assert.notEqual(titleBarColors(false).symbolColor, titleBarColors(false).color);
  assert.notEqual(titleBarColors(true).symbolColor, titleBarColors(true).color);
});

test('the caption glyphs have the gray of the header icons (--text at 70 % over --chrome)', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.length === 4 ? hex[(i + 1) / 2].repeat(2) : hex.slice(i, i + 2), 16));
  const mix = (text: string, chrome: string) => rgb(text).map((value, i) => value * 0.7 + rgb(chrome)[i] * 0.3);
  for (const [dark, marker] of [[false, ':root {'], [true, ':root[data-theme=dark]']] as const) {
    const expected = mix(token(marker, '--text'), token(marker, '--chrome'));
    rgb(titleBarColors(dark).symbolColor).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= 3, `${dark ? 'dark' : 'light'} glyph channel ${i}`));
  }
});

test('under a modal the controls take the backdrop-dimmed colors (--backdrop over the row and the glyphs, F13)', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  /** #rgba (the backdrop token's form) → [r, g, b, alpha 0..1]. */
  const rgba = (hex: string) => { assert.match(hex, /^#[0-9a-f]{4}$/i); return [...[1, 2, 3].map((i) => parseInt(hex[i].repeat(2), 16)), parseInt(hex[4], 16) / 15]; };
  for (const [dark, marker] of [[false, ':root {'], [true, ':root[data-theme=dark]']] as const) {
    const [r, g, b, alpha] = rgba(token(marker, '--backdrop'));
    const under = (hex: string) => rgb(hex).map((value, i) => value * (1 - alpha) + [r, g, b][i] * alpha);
    const plain = titleBarColors(dark);
    const dimmed = dimmedColors(dark);
    for (const part of ['color', 'symbolColor'] as const) {
      const expected = under(plain[part]);
      rgb(dimmed[part]).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= 1, `${dark ? 'dark' : 'light'} ${part} channel ${i}: ${value} vs ${expected[i]}`));
    }
    if (dark) assert.equal(token(':root[data-theme=system]', '--backdrop'), token(marker, '--backdrop'), 'the system\'s dark theme dims the same');
  }
  assert.deepEqual(titleBarOverlay(true, 'compact', true), { ...dimmedColors(true), height: TITLE_BAR_HEIGHT - 1 }, 'dimming keeps the height');
  assert.deepEqual(titleBarOverlay(false, 'columns', false), { ...titleBarColors(false), height: TITLE_BAR_HEIGHT - 1 });
});

test('macOS traffic lights sit vertically centered in the existing header row', () => {
  const { x, y } = trafficLightPosition();
  assert.equal(x, 14);
  assert.equal(y, 17);
  assert.equal(y * 2 + 14, TITLE_BAR_HEIGHT);
});
