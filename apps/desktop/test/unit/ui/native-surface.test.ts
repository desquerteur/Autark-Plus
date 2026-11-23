// B-080 (ui/workspace/native-surface.ts pageBounds; live at 150 %: a press on the workspace grip's centre selected text
// in the page beside it): a personal tab's native page sits on the whole pixels of its slot, and a column-resize grip on
// the slot's left or right edge keeps its pointer – the page begins where the grip ends; a hidden grip (full view, no
// width) or one beside another part of the window changes nothing.
// Owns: these assertions only. Never: a DOM or main's views (the module is loaded by path, so the runtime typecheck
// leaves its DOM code to tsconfig.ui.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

interface Box { left: number; right: number; top: number; bottom: number; width: number }
type Bounds = { x: number; y: number; width: number; height: number };

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/ui/workspace/native-surface.ts');
const load = async () => (await import(pathToFileURL(file).href)) as { pageBounds: (rect: Box, grips: readonly Box[]) => Bounds };
const box = (left: number, right: number, top = 40, bottom = 800): Box => ({ left, right, top, bottom, width: right - left });

test('a grip on the slot\'s left edge: the page begins where the grip ends', async () => {
  const { pageBounds } = await load();
  assert.deepEqual(pageBounds(box(100, 500), [box(96, 104, 0, 800)]), { x: 104, y: 40, width: 396, height: 760 });
});

test('a grip on the right edge (a chat area\'s page) ends the page where the grip begins; both edges at once', async () => {
  const { pageBounds } = await load();
  assert.deepEqual(pageBounds(box(100, 500), [box(496, 504)]), { x: 100, y: 40, width: 396, height: 760 });
  assert.deepEqual(pageBounds(box(100, 500), [box(96, 104), box(496, 504)]), { x: 104, y: 40, width: 392, height: 760 });
});

test('whole pixels inside the slot; a hidden grip, one elsewhere or one above the slot change nothing', async () => {
  const { pageBounds } = await load();
  assert.deepEqual(pageBounds(box(100.4, 499.6, 40.2, 799.8), []), { x: 101, y: 41, width: 398, height: 758 });
  assert.deepEqual(pageBounds(box(100, 500), [{ ...box(96, 96), width: 0 }]), { x: 100, y: 40, width: 400, height: 760 }, 'full view\'s grip has no width');
  assert.deepEqual(pageBounds(box(100, 500), [box(284, 292)]), { x: 100, y: 40, width: 400, height: 760 }, 'the sidebar\'s grip lies elsewhere');
  assert.deepEqual(pageBounds(box(100, 500, 40, 800), [box(96, 104, 0, 40)]), { x: 100, y: 40, width: 400, height: 760 }, 'a grip that ends above the slot');
});
