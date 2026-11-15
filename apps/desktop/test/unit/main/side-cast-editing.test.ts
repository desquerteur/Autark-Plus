// B-081 T9: a watched side tab says whether its focused element takes text (src/main/side-driver/caster.ts with the
// page script's `__wfSide.editing()`, page-script.ts) – asked in the driver's world only after a watcher's press ENDS
// (a button let go, a key up, typed text; never on a press's start or a move), each yes goes to the runtime with the
// page as a new, rising stamp (SidePage.editing – a tap into the next field is news too) and rides along with every
// frame while it holds, a no after a no sends nothing, a new document
// starts without it, and a page that cannot answer (no world, a failed evaluate) changes nothing. The in-page test
// itself runs in a small fake DOM: text inputs, text areas and contenteditable count (also inside an open shadow root
// or a same-origin frame), buttons, checkboxes, disabled or read-only fields and a cross-origin frame do not.
// Owns: these assertions only. Never: Electron, real pages or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SideCaster } from '../../../src/main/side-driver/caster.ts';
import { pageScript } from '../../../src/main/side-driver/page-script.ts';
import type { SideCastUpdate } from '../../../src/shared/model/side-view.ts';

const TAB = 'web-1234';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const mouse = (type: string) => ({ method: 'Input.dispatchMouseEvent', params: { type, x: 10, y: 20, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, modifiers: 0 } });
const key = (type: string) => ({ method: 'Input.dispatchKeyEvent', params: { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 0 } });

function rig(world: 'answers' | 'fails' | 'none' = 'answers') {
  const clock = { now: 10_000 };
  const listeners = new Map<string, Set<(params: any) => void>>();
  const asked: string[] = [];
  const page = { focus: false };
  const cdp = {
    send: async () => ({}),
    on: (method: string, listener: (params: any) => void) => {
      let set = listeners.get(method);
      if (!set) listeners.set(method, (set = new Set()));
      set.add(listener);
      return () => { set!.delete(listener); };
    },
    ...(world === 'none' ? {} : { inWorld: async (expression: string) => { asked.push(expression); if (world === 'fails') throw new Error('gone'); return page.focus; } }),
  };
  const contents = { isDestroyed: () => false, getURL: () => 'https://shop.example/', getTitle: () => 'Shop', isLoading: () => false, getZoomFactor: () => 1 };
  const tab = { id: TAB, contents, cdp, personAt: 0, watcherAt: 0 };
  const sent: SideCastUpdate[] = [];
  const caster = new SideCaster({ tab: (id) => (id === TAB ? tab : undefined), send: (update) => sent.push(update), now: () => clock.now, setTimer: () => ({}), clearTimer: () => {} });
  const emit = (method: string, params: unknown) => { for (const listener of [...(listeners.get(method) ?? [])]) listener(params); };
  const input = async (...commands: unknown[]) => { await caster.input({ tab: TAB, commands }); await tick(); };
  /** One screencast frame, CAST_FRAME_GAP_MS after the last (passed on at once). */
  const frame = () => { clock.now += 200; emit('Page.screencastFrame', { data: 'JPEG', sessionId: 1, metadata: { deviceWidth: 420, deviceHeight: 860 } }); };
  return { caster, page, asked, sent, emit, input, frame };
}

test('the page is asked after a press ends; a change goes out with the page and rides along with the frames', async () => {
  const r = rig();
  await r.caster.cast({ tab: TAB, on: true });
  await r.input(mouse('mousePressed'), mouse('mouseMoved'));
  assert.deepEqual(r.asked, [], 'a press\'s start and a move ask nothing');
  r.page.focus = true;
  await r.input(mouse('mouseReleased'));
  assert.deepEqual(r.asked, ['__wfSide.editing()']);
  const first = r.sent.at(-1)?.page.editing;
  assert.equal(first, 10_000, 'the field is focused: the watcher hears it (a stamp, host ms)');
  const told = r.sent.length;
  await r.input(mouse('mousePressed'), mouse('mouseReleased'));
  assert.equal(r.sent.length, told + 1, 'a tap into the next field is news too');
  const second = r.sent.at(-1)?.page.editing ?? 0;
  assert.ok(second > first!, `a new stamp, rising in the same ms (${first} → ${second})`);
  r.frame();
  assert.equal(r.sent.at(-1)?.frame?.data, 'JPEG');
  assert.equal(r.sent.at(-1)?.page.editing, second, 'the frames carry the same stamp (no news)');
  r.page.focus = false;
  await r.input(key('keyUp'));
  assert.equal('editing' in (r.sent.at(-1)?.page ?? {}), false, 'the focus left the field (Tab): it is gone');
  const gone = r.sent.length;
  await r.input(mouse('mousePressed'), mouse('mouseReleased'));
  assert.equal(r.sent.length, gone, 'still no text field: nothing new');
  r.frame();
  assert.equal('editing' in (r.sent.at(-1)?.page ?? {}), false);
  r.page.focus = true;
  await r.input({ method: 'Input.insertText', params: { text: 'a' } });
  assert.ok((r.sent.at(-1)?.page.editing ?? 0) > second, 'typed text ends a press too');
  r.emit('Page.frameNavigated', { frame: { id: 'main' } });
  assert.equal('editing' in (r.sent.at(-1)?.page ?? {}), false, 'a new document starts without it');
  r.emit('Page.frameNavigated', { frame: { id: 'sub', parentId: 'main' } });
  r.frame();
  assert.equal('editing' in (r.sent.at(-1)?.page ?? {}), false);
});

test('a page that cannot answer changes nothing and the input still goes in', async () => {
  for (const world of ['fails', 'none'] as const) {
    const r = rig(world);
    await r.caster.cast({ tab: TAB, on: true });
    r.page.focus = true;
    await r.input(mouse('mousePressed'), mouse('mouseReleased'));
    assert.equal(r.sent.length, 0, `${world}: nothing told`);
    assert.equal(r.asked.length, world === 'fails' ? 1 : 0);
  }
});

/** The page script in a fake document; `active` is what has the focus. */
function editingOf(active: unknown): unknown {
  const win: any = {
    addEventListener: () => {}, setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: { activeElement: active, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({}), createElementNS: () => ({}) },
  };
  win.window = win; win.globalThis = win;
  Object.defineProperty(win, 'top', { get: () => win });
  vm.createContext(win);
  new vm.Script(pageScript('__report')).runInContext(win);
  return win.__wfSide.editing();
}

test('in the page: text fields, text areas and editable content take text; buttons, checkboxes, disabled and read-only fields do not', () => {
  const input = (type: string, extra: Record<string, unknown> = {}) => ({ tagName: 'INPUT', type, ...extra });
  for (const type of ['text', 'search', 'email', 'password', 'url', 'number', 'tel']) assert.equal(editingOf(input(type)), true, type);
  for (const type of ['checkbox', 'radio', 'submit', 'button', 'file', 'range', 'color']) assert.equal(editingOf(input(type)), false, type);
  assert.equal(editingOf({ tagName: 'TEXTAREA' }), true);
  assert.equal(editingOf({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(editingOf({ tagName: 'BUTTON' }), false);
  assert.equal(editingOf({ tagName: 'BODY' }), false);
  assert.equal(editingOf(null), false);
  assert.equal(editingOf(input('text', { disabled: true })), false);
  assert.equal(editingOf(input('text', { readOnly: true })), false);
  assert.equal(editingOf({ tagName: 'MY-FIELD', shadowRoot: { activeElement: input('text') } }), true, 'inside an open shadow root');
  assert.equal(editingOf({ tagName: 'IFRAME', contentDocument: { activeElement: { tagName: 'TEXTAREA' } } }), true, 'inside a same-origin frame');
  assert.equal(editingOf({ tagName: 'IFRAME', contentDocument: null }), false, 'a cross-origin frame is not seen into');
});
