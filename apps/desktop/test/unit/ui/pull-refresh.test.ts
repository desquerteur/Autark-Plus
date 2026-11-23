// B-084 pull down to refresh on the phone (src/ui/pwa/pull-refresh.ts): a downward pull of 64 px or more on a tab root
// whose scrollers are all at the top refreshes once; a short, sideways or scrolled pull, a field, the PC browser's touch
// surface, touch-action none and pushed screens never do; the spinner is one fixed overlay that goes away when the
// connection opens or reloads.
// Owns: these assertions only. Never: a real browser, touch screen or socket.

import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PULL_PX, isPull, pullStarts, watchPullRefresh } from '../../../src/ui/pwa/pull-refresh.ts';

interface FakeNode { scrollTop: number; parentElement: FakeNode | null; selector?: string; touchAction?: string; pushed?: boolean;
  matches(selector: string): boolean; closest(selector: string): FakeNode | null }

function node(parent: FakeNode | null, extra: Partial<FakeNode> = {}): FakeNode {
  const self: FakeNode = {
    scrollTop: 0, parentElement: parent, ...extra,
    matches: (selector) => Boolean(self.selector && selector.split(', ').includes(self.selector)),
    closest: () => (self.pushed || parent?.pushed ? self : null),
  };
  return self;
}

function dom(t: TestContext) {
  const globals = globalThis as Record<string, unknown>;
  const saved = ['document', 'getComputedStyle'].map((key) => [key, globals[key]] as const);
  const added: Array<{ removed: boolean; style: Record<string, string> }> = [];
  globals.getComputedStyle = (el: FakeNode) => ({ touchAction: el.touchAction ?? 'auto' });
  globals.document = {
    createElement: () => { const el = { removed: false, style: {} as Record<string, string>, innerHTML: '', setAttribute: () => undefined, remove() { el.removed = true; } }; added.push(el); return el; },
    body: { appendChild: () => undefined },
  };
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete globals[key]; else globals[key] = value; } });
  return added;
}

test('a pull counts from 64 px down and only when clearly more down than sideways', () => {
  assert.equal(isPull({ x: 100, y: 100 }, { x: 100, y: 100 + PULL_PX - 1 }), false);
  assert.equal(isPull({ x: 100, y: 100 }, { x: 110, y: 100 + PULL_PX }), true);
  assert.equal(isPull({ x: 100, y: 100 }, { x: 160, y: 180 }), false, 'diagonal');
  assert.equal(isPull({ x: 100, y: 200 }, { x: 100, y: 100 }), false, 'upwards');
});

test('a pull starts only where everything is at its top, outside fields and touch surfaces, on a tab root', (t) => {
  dom(t);
  const root = node(node(null));
  const list = node(root);
  const row = node(list);
  assert.equal(pullStarts(row as unknown as EventTarget, root as unknown as HTMLElement), true);
  list.scrollTop = 40;
  assert.equal(pullStarts(row as unknown as EventTarget, root as unknown as HTMLElement), false, 'the list is scrolled');
  list.scrollTop = 0;
  for (const extra of [{ selector: 'textarea' }, { selector: '[role="application"]' }, { touchAction: 'none' }, { touchAction: 'pan-x' }]) {
    assert.equal(pullStarts(node(list, extra) as unknown as EventTarget, root as unknown as HTMLElement), false, JSON.stringify(extra));
  }
  const pushed = node(node(null, { pushed: true }));
  assert.equal(pullStarts(node(pushed) as unknown as EventTarget, pushed as unknown as HTMLElement), false, 'a pushed screen');
});

test('a full pull refreshes once and the spinner goes when the connection settles; a short one does nothing', (t) => {
  const added = dom(t);
  const listeners = new Map<string, (event: unknown) => void>();
  const root = Object.assign(node(node(null)), {
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn); },
    removeEventListener: (type: string) => { listeners.delete(type); },
    getBoundingClientRect: () => ({ top: 56 }),
  });
  let refreshes = 0;
  let settle: (() => void) | undefined;
  const stop = watchPullRefresh(root as unknown as HTMLElement, () => { refreshes += 1; }, (fn) => { settle = fn; return () => { settle = undefined; }; });
  const touch = (y: number) => [{ clientX: 100, clientY: y }];
  const fire = (type: string, y: number) => listeners.get(type)!({ target: root, touches: type === 'touchend' ? [] : touch(y), changedTouches: touch(y) });

  fire('touchstart', 100); fire('touchmove', 130); fire('touchend', 130);
  assert.equal(refreshes, 0, 'too short');
  assert.equal(added.every((el) => el.removed), true, 'its spinner is gone');

  fire('touchstart', 100); fire('touchmove', 200);
  assert.equal(added.at(-1)!.style.opacity, '1');
  assert.match(added.at(-1)!.style.cssText, /position:fixed;.*top:68px/, 'fixed, under the top row: nothing shifts');
  fire('touchend', 200);
  assert.equal(refreshes, 1);
  assert.equal(added.at(-1)!.removed, false, 'spins until the connection settles');
  fire('touchstart', 100); fire('touchmove', 200); fire('touchend', 200);
  assert.equal(refreshes, 1, 'no second refresh while one runs');
  settle!();
  assert.equal(added.at(-1)!.removed, true);
  stop();
  assert.equal(listeners.size, 0);
});
