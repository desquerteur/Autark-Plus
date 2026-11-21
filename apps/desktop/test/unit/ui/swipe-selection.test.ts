// 17.11.2026 (the owner: copying text on the phone): a touch that selects text is no swipe – with a selection at its start or end the gesture does nothing, so
// dragging the selection handles sideways cannot reply to the message or switch the area. Without a selection the swipe is as before.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSelection, watchChatSwipe } from '../../../src/ui/workspace/phone-swipe.ts';

type Listener = (event: unknown) => void;
const g = globalThis as unknown as { getSelection?: () => { toString(): string }; window?: { innerWidth: number }; document?: { body: unknown } };

function swiper(selected: () => string) {
  g.getSelection = () => ({ toString: selected });
  g.window = { innerWidth: 400 };
  g.document = { body: {} };
  const listeners = new Map<string, Listener>();
  const turns: Array<[string, string, string | undefined]> = [];
  const target = { closest: () => ({ getAttribute: () => 'msg_1' }), parentElement: null, matches: () => false, scrollWidth: 0, clientWidth: 0 };
  const root = { addEventListener: (type: string, fn: Listener) => { listeners.set(type, fn); }, removeEventListener: () => undefined };
  watchChatSwipe(root as never, () => 'ch_1', (id, to, message) => turns.push([id, to, message]));
  const touch = (type: 'touchstart' | 'touchend', x: number) => listeners.get(type)!({ target, touches: [{ clientX: x, clientY: 100 }], changedTouches: [{ clientX: x, clientY: 100 }] });
  return { turns, swipe: () => { touch('touchstart', 100); touch('touchend', 260); } };
}

test('a sideways swipe on a message replies; with text selected (at the start or the end) it does nothing', () => {
  let text = '';
  const s = swiper(() => text);
  s.swipe();
  assert.deepEqual(s.turns, [['ch_1', 'messages', 'msg_1']], 'no selection: the swipe replies as before');
  text = 'Second sentence';
  s.swipe();
  assert.equal(s.turns.length, 1, 'a selection: no swipe');
  assert.equal(hasSelection(), true);
  text = '';
  assert.equal(hasSelection(), false);
});
