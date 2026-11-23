// B-081: the AI cursor over this PC's screen (src/main/screen-cursor.ts) with a fake RPC, fake displays, fake overlays,
// manual timers and a fake BrowserWindow: nothing on macOS and Linux; on Windows only agents' moves on screen:local are
// drawn, each once, on the display that holds the end of the path, in that display's DIP with the shared lean and
// colour; a cursor that leaves a display goes there; one timer hides every overlay HIDE_MS after the last move ends and
// closes them KEEP_MS later (the next move in between reuses the loaded page), and an old move is never drawn again; a
// late draw skips what was travelled; the Electron window is click-through, never focused, untitled, out of
// screenshots, shown only once its self-contained page loaded, hidden and shown again without a new page.
// Owns: these assertions only. Never: Electron, real windows or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { HIDE_MS, KEEP_MS, OVERLAY_SCRIPT, SCREEN_LOCAL, ScreenCursor, displayAt, electronCursorOverlays, overlayPage, type CursorDisplay } from '../../../src/main/screen-cursor.ts';
import { cursorColor } from '../../../src/shared/model/agent-cursor.ts';
import type { PointerPoint, PointerState } from '../../../src/shared/model/pointers.ts';

const LEFT: CursorDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const RIGHT: CursorDisplay = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 } };
const ada = { kind: 'agent', id: 'ag_ada', name: 'Ada' } as const;

type Drawn = { at: number; id: string; name: string; color: string; steps: Array<{ x: number; y: number; t: number; r: number }>; click: boolean };

function rig(platform: NodeJS.Platform = 'win32') {
  let listener: ((state: PointerState) => void) | undefined;
  const topics: string[] = [];
  let unsubscribed = 0;
  const opened: Array<{ display: CursorDisplay; draws: Drawn[]; gone: string[]; hidden: boolean; closed: boolean }> = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const cursor = new ScreenCursor({
    rpc: {
      on: (_event, fn) => { listener = fn; return () => { listener = undefined; }; },
      subscribe: async (topic) => { topics.push(topic); return () => { unsubscribed++; }; },
    },
    platform,
    displays: () => [LEFT, RIGHT],
    toDip: (p) => ({ x: p.x / 2, y: p.y / 2 }), // a 200 % screen
    open: (display) => {
      const overlay = { display, draws: [] as Drawn[], gone: [] as string[], hidden: false, closed: false };
      opened.push(overlay);
      const drawAt = (at: number, id: string, name: string, color: string, steps: Drawn['steps'], click: boolean) => overlay.draws.push({ at, id, name, color, steps, click });
      return {
        run: (line) => { overlay.hidden = false; new Function('drawAt', 'gone', line)(drawAt, (id: string) => overlay.gone.push(id)); },
        hide: () => { overlay.hidden = true; },
        close: () => { overlay.closed = true; },
      };
    },
    setTimer: (fn, ms) => { const timer = { fn, ms, live: true }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as { live: boolean }).live = false; },
  });
  const emit = (points: Array<Partial<PointerPoint>>, surface = SCREEN_LOCAL) => listener?.({ surface, points: points as PointerPoint[] });
  const live = () => timers.filter((timer) => timer.live);
  return { cursor, emit, opened, topics, live, listening: () => listener !== undefined, unsubscribed: () => unsubscribed };
}

const move = (at: number, path: Array<{ x: number; y: number; t: number }>, action: PointerPoint['action'] = 'move'): Partial<PointerPoint> =>
  ({ actor: ada, x: path.at(-1)!.x, y: path.at(-1)!.y, path, action, at });

test('macOS and Linux: nothing is followed or drawn', async () => {
  for (const platform of ['darwin', 'linux'] as const) {
    const r = rig(platform);
    await r.cursor.start();
    assert.deepEqual([r.listening(), r.topics.length], [false, 0], platform);
  }
});

test('an agent move on screen:local: one overlay on the display of its end, DIP minus its origin, the shared colour and lean', async () => {
  const r = rig();
  await r.cursor.start();
  await r.cursor.start();
  assert.deepEqual(r.topics, ['system'], 'subscribed once');
  r.emit([move(1000, [{ x: 100, y: 100, t: 0 }, { x: 900, y: 300, t: 300 }])], 'side:web-1');
  r.emit([{ actor: { kind: 'person', id: 'owner', name: 'Lukas' }, x: 10, y: 10, action: 'move', at: 1000 }]);
  assert.equal(r.opened.length, 0, 'another surface or the person: nothing');
  r.emit([move(1000, [{ x: 100, y: 100, t: 0 }, { x: 500, y: 300, t: 150 }, { x: 900, y: 300, t: 300 }], 'click')]);
  assert.equal(r.opened.length, 1);
  const [overlay] = r.opened;
  assert.equal(overlay!.display.id, LEFT.id);
  const [draw] = overlay!.draws;
  assert.deepEqual([draw!.at, draw!.id, draw!.name, draw!.color, draw!.click], [1000, 'ag_ada', 'Ada', cursorColor('ag_ada'), true]);
  assert.deepEqual(draw!.steps.map((s) => [s.x, s.y, s.t]), [[50, 50, 0], [250, 150, 150], [450, 150, 300]]);
  assert.ok(draw!.steps[0]!.r > 0 && draw!.steps.at(-1)!.r === 0, 'moving right it leans, on arrival upright');
  r.emit([move(1000, [{ x: 100, y: 100, t: 0 }, { x: 900, y: 300, t: 300 }])]);
  assert.equal(overlay!.draws.length, 1, 'every event carries every live pointer: a move is drawn once');

  r.emit([move(2000, [{ x: 900, y: 300, t: 0 }, { x: 4000, y: 200, t: 300 }])]);
  assert.equal(r.opened.length, 2, 'the right display gets its own overlay');
  assert.deepEqual(r.opened[1]!.draws[0]!.steps.at(-1), { x: 80, y: 100, t: 300, r: 0 }, '(2000, 100) DIP on the display starting at 1920');
  assert.deepEqual(overlay!.gone, ['ag_ada'], 'it left the left display');
});

test('one timer hides every overlay HIDE_MS after the last move ended and closes them KEEP_MS later; an old move never comes back; dispose ends it all', async () => {
  const r = rig();
  const fire = () => { const [due] = r.live(); due!.live = false; due!.fn(); };
  await r.cursor.start();
  r.emit([move(1000, [{ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 300 }])]);
  r.emit([move(2000, [{ x: 100, y: 0, t: 0 }, { x: 200, y: 0, t: 800 }])]);
  assert.deepEqual(r.live().map((timer) => timer.ms), [800 + HIDE_MS], 'one timer, re-armed by each move');
  fire();
  assert.deepEqual([r.opened[0]!.hidden, r.opened[0]!.closed], [true, false], 'hidden, its page kept');
  assert.deepEqual(r.live().map((timer) => timer.ms), [KEEP_MS]);
  r.emit([move(30_000, [{ x: 200, y: 0, t: 0 }, { x: 300, y: 0, t: 300 }])]);
  assert.deepEqual([r.opened.length, r.opened[0]!.hidden, r.opened[0]!.draws.length], [1, false, 3], 'the next move (after a screenshot and a turn) finds the loaded page');
  assert.deepEqual(r.live().map((timer) => timer.ms), [300 + HIDE_MS]);
  fire();
  fire();
  assert.equal(r.opened[0]!.closed, true, `closed ${KEEP_MS} ms after it hid`);
  assert.equal(r.live().length, 0);
  r.emit([move(30_000, [{ x: 200, y: 0, t: 0 }, { x: 300, y: 0, t: 300 }]), { actor: { kind: 'person', id: 'owner', name: 'Lukas' }, x: 1, y: 1, at: 9000 }]);
  assert.equal(r.opened.length, 1, 'the person moved: the agent\'s old move is not drawn again');
  r.emit([move(400_000, [{ x: 0, y: 0, t: 0 }])]);
  assert.equal(r.opened.length, 2, 'a new move opens again');
  r.cursor.dispose();
  assert.deepEqual([r.opened[1]!.closed, r.listening(), r.unsubscribed(), r.live().length], [true, false, 1, 0]);
});

test('displayAt: the display holding the point, else the nearest', () => {
  assert.equal(displayAt([LEFT, RIGHT], { x: 1919, y: 500 })?.id, 1);
  assert.equal(displayAt([LEFT, RIGHT], { x: 1920, y: 500 })?.id, 2);
  assert.equal(displayAt([LEFT, RIGHT], { x: 2500, y: 1060 })?.id, 2, 'below the shorter display: still the nearest');
  assert.equal(displayAt([], { x: 0, y: 0 }), undefined);
});

test('a late draw skips what was travelled; gone hides a cursor', () => {
  const calls: unknown[][] = [];
  const box = { style: { opacity: '1' } };
  const context = { cursor: (...args: unknown[]) => calls.push(args), cursors: new Map([['ag_ada', { box, hide: 0 }]]), Date: { now: () => 10_200 }, clearTimeout: () => {} };
  vm.runInNewContext(`${OVERLAY_SCRIPT}; drawAt(10000, 'ag_ada', 'Ada', '#2f6fed', [{ x: 0, y: 0, t: 0, r: 0 }, { x: 50, y: 0, t: 150, r: 9 }, { x: 100, y: 0, t: 300, r: 0 }], true);
    drawAt(9000, 'ag_ada', 'Ada', '#2f6fed', [{ x: 0, y: 0, t: 0, r: 0 }, { x: 100, y: 0, t: 300, r: 0 }], false); gone('ag_ada');`, context);
  const seen = JSON.parse(JSON.stringify(calls)) as unknown[][]; // out of the page's realm
  assert.deepEqual(seen[0], ['ag_ada', 'Ada', '#2f6fed', [{ x: 100, y: 0, t: 100, r: 0 }], true], '200 ms late: the rest of the path in its own time');
  assert.deepEqual(seen[1]![3], [{ x: 100, y: 0, t: 0, r: 0 }], 'over already: it is drawn where it arrived');
  assert.equal(box.style.opacity, '0');
});

test('the Electron overlay: click-through, never focused, untitled, out of screenshots, shown once its own page loaded', () => {
  const made: FakeWindow[] = [];
  class FakeWindow {
    options: Record<string, any>; calls: unknown[][] = []; destroyed = false; url = '';
    handlers = new Map<string, (event: { preventDefault(): void }) => void>(); ran: string[] = [];
    webContents = {
      once: (name: string, fn: () => void) => { this.handlers.set(name, fn as never); },
      on: (name: string, fn: (event: { preventDefault(): void }) => void) => { this.handlers.set(name, fn); },
      executeJavaScript: async (line: string) => { this.ran.push(line); },
    };
    constructor(options: Record<string, any>) { this.options = options; made.push(this); }
    setIgnoreMouseEvents(...args: unknown[]) { this.calls.push(['ignore', ...args]); }
    setAlwaysOnTop(...args: unknown[]) { this.calls.push(['top', ...args]); }
    setContentProtection(...args: unknown[]) { this.calls.push(['protect', ...args]); }
    setBounds(bounds: unknown) { this.calls.push(['bounds', bounds]); }
    showInactive() { this.calls.push(['show']); }
    hide() { this.calls.push(['hide']); }
    on(name: string, fn: (event: { preventDefault(): void }) => void) { this.handlers.set(name, fn); }
    loadURL(url: string) { this.url = url; return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const overlay = electronCursorOverlays({ BrowserWindow: FakeWindow as never })(RIGHT);
  const [win] = made;
  assert.deepEqual([win!.options.x, win!.options.width, win!.options.transparent, win!.options.frame, win!.options.focusable, win!.options.skipTaskbar, win!.options.show, win!.options.title], [1920, 1280, true, false, false, true, false, '']);
  assert.equal(win!.options.webPreferences.sandbox, true);
  assert.deepEqual(win!.calls, [['ignore', true], ['top', true, 'screen-saver'], ['protect', true]]);
  assert.equal(win!.url, overlayPage());
  const html = decodeURIComponent(win!.url.slice(win!.url.indexOf(',') + 1));
  assert.match(html, /default-src 'none'; script-src 'unsafe-inline'/);
  assert.match(html, /window\.drawAt = drawAt; window\.gone = gone;/);
  overlay.run('drawAt(1)');
  assert.deepEqual(win!.ran, [], 'nothing runs before the page loaded');
  let prevented = 0;
  win!.handlers.get('page-title-updated')!({ preventDefault: () => { prevented++; } });
  win!.handlers.get('did-finish-load')!({ preventDefault() {} });
  assert.deepEqual(win!.calls.slice(3), [['bounds', RIGHT.bounds], ['show']]);
  assert.deepEqual([win!.ran, prevented], [['drawAt(1)'], 1]);
  overlay.hide();
  overlay.hide();
  overlay.run('gone("a")');
  assert.deepEqual(win!.calls.slice(5), [['hide'], ['show']], 'hidden once, shown again by the next line: the same page');
  overlay.close();
  overlay.run('drawAt(2)');
  assert.deepEqual([win!.ran, win!.destroyed], [['drawAt(1)', 'gone("a")'], true]);

  const early = electronCursorOverlays({ BrowserWindow: FakeWindow as never })(LEFT);
  early.hide();
  made[1]!.handlers.get('did-finish-load')!({ preventDefault() {} });
  assert.deepEqual(made[1]!.calls.slice(3), [['bounds', LEFT.bounds]], 'hidden before its page loaded: not shown on load');
  early.run('drawAt(3)');
  assert.deepEqual([made[1]!.calls.slice(4), made[1]!.ran], [[['show']], ['drawAt(3)']]);
});
