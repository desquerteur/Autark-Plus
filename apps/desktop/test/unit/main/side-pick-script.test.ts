// B-081: the Pin button's picker in a side tab's page (main/side-driver/pick-script.ts inside page-script.ts), run in
// a small fake DOM: off, nothing changes; on, the hover box follows the deepest element under the pointer (an icon
// without pointer events, inside an open shadow root, never a hidden child) at most once per animation frame; a left
// press is swallowed and pinned (selector walk, box, click point, edge within 4 px, non-default styles, source hint, two
// parents); the page never sees the left button's events; Escape ends it; never the overlay host; held, everything is the
// page's; the hover report carries a short selector.
// Owns: these assertions only. Never: a real page, Electron or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pageScript } from '../../../src/main/side-driver/page-script.ts';

const SVG = 'http://www.w3.org/2000/svg';
type Rect = { left: number; top: number; width: number; height: number };
const CONTROLS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const DEFAULTS: Record<string, string> = {
  'font-size': '16px', 'font-weight': '400', 'line-height': 'normal', color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)', padding: '0px', margin: '0px',
  'border-radius': '0px', gap: 'normal', display: 'block', opacity: '1', 'box-shadow': 'none', border: '0px none rgb(0, 0, 0)', fill: 'rgb(0, 0, 0)', stroke: 'none', 'stroke-width': '1px',
};

class Root {
  host: El | null;
  children: El[] = [];
  unique = new Set<string>();
  constructor(host: El | null) { this.host = host; }
  appendChild(kid: El): El { kid.parentNode = this; this.children.push(kid); return kid; }
  elementFromPoint(x: number, y: number): El | null { return hitIn(this.children, x, y); }
  querySelectorAll(sel: string): { length: number } { return { length: this.unique.has(sel) ? 1 : 3 }; }
}

class El {
  readonly nodeType = 1;
  tagName: string; namespaceURI: string; id = ''; title = ''; textContent = '';
  attrs = new Map<string, string>(); children: El[] = []; parentNode: El | Root | null = null; shadowRoot: Root | null = null;
  style: Record<string, string> = {}; css: Record<string, string> = {}; box: Rect = { left: 0, top: 0, width: 0, height: 0 };
  hits = true; isConnected = true; classes: string[] = []; root: Root | null = null;
  constructor(tag: string, ns = '') { this.tagName = ns === SVG ? tag : tag.toUpperCase(); this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml'; }
  get classList() { const list = this.classes; return Object.assign([...list], { contains: (name: string) => list.includes(name) }); }
  get parentElement(): El | null { return this.parentNode instanceof El ? this.parentNode : null; }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)); }
  getBoundingClientRect() { const b = this.box; return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height }; }
  getRootNode(): unknown { let node: El | Root = this; while (node instanceof El && node.parentNode) node = node.parentNode; return node; }
  closest(): El | null { for (let node: El | null = this; node; node = node.parentElement) if (CONTROLS.has(node.tagName)) return node; return null; }
  appendChild(kid: El): El { kid.parentNode = this; this.children.push(kid); return kid; }
  attachShadow(init: { mode: string }): Root { const root = (this.root = new Root(this)); if (init.mode === 'open') this.shadowRoot = root; return root; }
}

function hitIn(list: readonly El[], x: number, y: number): El | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i]!, b = el.box;
    if (!(x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height)) continue;
    const deeper = hitIn(el.children, x, y);
    if (deeper) return deeper;
    if (el.hits) return el;
  }
  return null;
}

function el(tag: string, box: Rect, options: Partial<Pick<El, 'id' | 'textContent' | 'hits' | 'css' | 'classes'>> & { ns?: string; attrs?: Record<string, string> } = {}, kids: El[] = []): El {
  const node = new El(tag, options.ns);
  Object.assign(node, { box, ...(options.id ? { id: options.id } : {}), ...(options.textContent ? { textContent: options.textContent } : {}), ...(options.hits === false ? { hits: false } : {}), ...(options.css ? { css: options.css } : {}), ...(options.classes ? { classes: options.classes } : {}) });
  for (const [key, value] of Object.entries(options.attrs ?? {})) node.setAttribute(key, value);
  for (const kid of kids) node.appendChild(kid);
  return node;
}

/** main > section.pricing > div.card ×2 > button.buy (an icon inside without pointer events, a hidden tooltip), a 1 px divider, a shadow host. */
function page() {
  const icon = el('svg', { left: 110, top: 125, width: 12, height: 12 }, { ns: SVG, hits: false, attrs: { 'aria-label': 'Cart' }, css: { fill: 'rgb(255, 255, 255)' } });
  const tip = el('span', { left: 100, top: 120, width: 200, height: 40 }, { textContent: 'Tooltip', css: { visibility: 'hidden' }, hits: false });
  const buy = el('button', { left: 100, top: 120, width: 200, height: 40 }, {
    classes: ['buy', 'hover:bg-blue-700'], textContent: 'Buy now',
    css: { 'font-size': '14px', 'font-weight': '600', color: 'rgb(255, 255, 255)', 'background-color': 'rgb(37, 99, 235)', padding: '8px 16px', border: '', 'border-bottom': '1px solid rgb(29, 78, 216)', 'border-radius': '6px', display: 'inline-flex' },
  }, [icon, tip]);
  const card1 = el('div', { left: 0, top: 100, width: 300, height: 180 }, { classes: ['card'] });
  const card2 = el('div', { left: 80, top: 100, width: 320, height: 180 }, { classes: ['card'], attrs: { 'data-insp-path': 'src/components/Card.tsx:42:7' } }, [buy]);
  const divider = el('div', { left: 0, top: 300, width: 1200, height: 1 }, { classes: ['divider'] });
  const section = el('section', { left: 0, top: 80, width: 1200, height: 600 }, { classes: ['pricing'] }, [card1, card2, divider]);
  const host = el('my-chip', { left: 500, top: 400, width: 80, height: 24 });
  const inner = el('span', { left: 504, top: 404, width: 40, height: 16 }, { classes: ['label'], textContent: 'New' });
  host.attachShadow({ mode: 'open' }).appendChild(inner);
  const body = el('body', { left: 0, top: 0, width: 1200, height: 2000 }, {}, [el('main', { left: 0, top: 0, width: 1200, height: 2000 }, {}, [section, host])]);
  const html = el('html', { left: 0, top: 0, width: 1200, height: 2000 }, {}, [body]);
  const doc = Object.assign(new Root(null), {
    nodeType: 9, documentElement: html, body, activeElement: null, title: '',
    createElement: (tag: string) => new El(tag), createElementNS: (ns: string, tag: string) => new El(tag, ns),
    querySelector: () => null, getElementById: () => null,
  });
  html.parentNode = doc;
  doc.children = [html];
  return { doc, html, buy, icon, card2, divider, host, inner };
}

function world() {
  const dom = page();
  const listeners = new Map<string, Array<(event: any) => void>>();
  const sent: any[] = [];
  let frames: Array<() => void> = [];
  const win: any = {
    addEventListener: (type: string, fn: (event: any) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    __report: (payload: string) => sent.push(JSON.parse(payload)),
    setTimeout: () => 0, clearTimeout: () => {},
    requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; }, cancelAnimationFrame: () => { frames = []; },
    getComputedStyle: (node: El) => ({ visibility: node.css.visibility ?? 'visible', opacity: node.css.opacity ?? '1', getPropertyValue: (key: string) => node.css[key] ?? DEFAULTS[key] ?? '' }),
    document: dom.doc,
  };
  win.window = win; win.globalThis = win;
  Object.defineProperty(win, 'top', { get: () => win });
  vm.createContext(win);
  new vm.Script(pageScript('__report')).runInContext(win);
  const fire = (type: string, init: Record<string, unknown>) => {
    const event = { type, isTrusted: true, button: 0, prevented: 0, stopped: 0, preventDefault() { this.prevented += 1; }, stopImmediatePropagation() { this.stopped += 1; }, ...init };
    for (const fn of listeners.get(type) ?? []) fn(event);
    return event;
  };
  const run = () => { const now = frames; frames = []; now.forEach((fn) => fn()); return now.length; };
  const boxes = () => dom.html.children.find((kid) => kid.tagName === 'DIV')?.root?.children ?? []; // the overlay's closed root
  return { ...dom, win, sent, fire, run, frames: () => frames.length, boxes, api: win.__wfSide };
}

test('the picker: off by default; on, one hover box per frame on the deepest element, never a hidden child', () => {
  const w = world();
  assert.ok(Object.keys(w.api).includes('pick'));
  w.fire('mousemove', { clientX: 115, clientY: 130, movementX: 1, movementY: 0, target: w.buy });
  assert.equal(w.frames(), 0, 'off: nothing is drawn');
  assert.equal(w.api.pick(true), true);
  for (const x of [114, 115, 116]) w.fire('mousemove', { clientX: x, clientY: 130, movementX: 1, movementY: 0, target: w.buy });
  assert.equal(w.frames(), 1, 'several moves, one animation frame');
  w.run();
  const [pin, hover, label] = w.boxes();
  assert.equal(hover!.style.display, 'block');
  assert.deepEqual([hover!.style.transform, hover!.style.width, hover!.style.height], ['translate(110px,125px)', '12px', '12px'], 'the icon that takes no pointer events');
  assert.equal(label!.textContent, 'svg 12×12');
  assert.equal(pin!.style.display, 'none', 'no pin yet');
  w.fire('mousemove', { clientX: 290, clientY: 150, movementX: 1, movementY: 0, target: w.buy });
  w.run();
  assert.equal(hover!.style.width, '200px', 'the button, not its hidden tooltip');
  w.fire('mousemove', { clientX: 510, clientY: 410, movementX: 1, movementY: 0, target: w.host });
  w.run();
  assert.deepEqual([hover!.style.transform, label!.textContent], ['translate(504px,404px)', 'span.label 40×16'], 'inside an open shadow root');
  w.fire('scroll', {});
  assert.equal(w.frames(), 1, 'a scroll redraws once');
  assert.equal(w.api.pick(false), false);
  assert.equal(w.run(), 0, 'off: the waiting frame is dropped');
  assert.deepEqual(w.boxes().map((box) => box.style.display), ['none', 'none', 'none']);
});

test('a left press pins (the page never sees it); Escape ends; off again the page gets its clicks', () => {
  const w = world();
  w.doc.unique.add('div.card:nth-of-type(2) > button.buy');
  w.api.pick(true);
  const down = w.fire('pointerdown', { clientX: 150, clientY: 158 });
  assert.deepEqual([down.prevented, down.stopped], [0, 1], 'pointerdown only stopped (cancelling it would cancel the mousedown)');
  const press = w.fire('mousedown', { clientX: 150, clientY: 158, target: w.buy });
  assert.deepEqual([press.prevented, press.stopped], [1, 1]);
  for (const type of ['mouseup', 'click', 'dblclick']) {
    const event = w.fire(type, { clientX: 150, clientY: 158 });
    assert.deepEqual([event.prevented, event.stopped], [1, 1], type);
  }
  const right = w.fire('mousedown', { clientX: 150, clientY: 158, button: 2, target: w.buy });
  assert.equal(right.prevented, 0, 'the right button stays the page’s');
  const synthetic = w.fire('click', { clientX: 150, clientY: 158, isTrusted: false });
  assert.equal(synthetic.prevented, 0, 'a page’s own synthetic click is not touched');
  const pins = w.sent.filter((item) => item.k === 'pick');
  assert.equal(pins.length, 1);
  assert.deepEqual(pins[0], {
    k: 'pick', sel: 'div.card:nth-of-type(2) > button.buy', tag: 'button', role: 'button', text: 'Buy now',
    box: { x: 100, y: 120, w: 200, h: 40 }, at: { x: 150, y: 158 }, edge: 'bottom',
    st: { 'font-size': '14px', 'font-weight': '600', color: 'rgb(255, 255, 255)', 'background-color': 'rgb(37, 99, 235)', padding: '8px 16px', 'border-radius': '6px', display: 'inline-flex', 'border-bottom': '1px solid rgb(29, 78, 216)' },
    src: 'src/components/Card.tsx:42:7', par: ['div.card 320×180', 'section.pricing 1200×600'],
  });
  assert.equal(w.sent.filter((item) => item.k === 'in' && item.e === 'click').length, 1, 'only the right press is the person’s click');
  w.run();
  assert.deepEqual([w.boxes()[0]!.style.display, w.boxes()[0]!.style.width], ['block', '200px'], 'one outline on the pin');
  w.fire('mousedown', { clientX: 115, clientY: 130, target: w.buy });
  const icon = w.sent.filter((item) => item.k === 'pick').at(-1);
  assert.deepEqual([icon.tag, icon.name, icon.st.fill, 'stroke-width' in icon.st], ['svg', 'Cart', 'rgb(255, 255, 255)', false], 'the icon in the button, its fill; no stroke width without a stroke');
  w.fire('mousedown', { clientX: 600, clientY: 300, target: w.divider });
  const line = w.sent.filter((item) => item.k === 'pick').at(-1);
  assert.deepEqual([line.tag, line.box, line.edge, line.st], ['div', { x: 0, y: 300, w: 1200, h: 1 }, 'top', { 'font-size': '16px', color: 'rgb(0, 0, 0)' }], 'a 1 px line and its edge; defaults left out');
  assert.equal(line.sel, 'html > body > main > section.pricing > div.divider', 'never unique: at most 5 levels');
  assert.deepEqual(line.par, ['section.pricing 1200×600', 'main 1200×2000']);
  const escape = w.fire('keydown', { key: 'Escape' });
  assert.deepEqual([escape.prevented, escape.stopped], [1, 1], 'the page’s own Escape handler never runs');
  assert.deepEqual(w.sent.at(-1), { k: 'pick', off: 1 });
  const after = w.fire('mousedown', { clientX: 150, clientY: 158, target: w.buy });
  assert.equal(after.prevented, 0, 'off: the page gets its press');
  assert.deepEqual(w.sent.at(-1), { k: 'in', e: 'click', x: 150, y: 158, target: { role: 'button', name: 'Buy now', sel: 'div.card > button.buy' } }, 'the hover report names a short selector');
});

test('never the cursors’ own overlay: a point on <html> (body margin, below a short page) stays the page’s', () => {
  const w = world();
  w.api.pick(true);
  w.fire('mousemove', { clientX: 115, clientY: 130, movementX: 1, movementY: 0, target: w.buy });
  w.run(); // the first draw makes the overlay host, the last child of <html>
  const host = w.html.children.at(-1)!;
  assert.equal(host.tagName, 'DIV');
  Object.assign(host, { box: { left: 0, top: 0, width: 1200, height: 2000 }, hits: false }); // position:fixed; inset:0; no pointer events
  w.html.children[0]!.box = { left: 0, top: 0, width: 1200, height: 1000 }; // a short body
  w.fire('mousemove', { clientX: 600, clientY: 1500, movementX: 1, movementY: 0, target: w.html });
  w.run();
  assert.equal(w.boxes()[2]!.textContent, 'html 1200×2000', 'the page itself, not "div 1200×2000"');
  w.fire('mousedown', { clientX: 600, clientY: 1500, target: w.html });
  const pin = w.sent.filter((item) => item.k === 'pick').at(-1);
  assert.deepEqual([pin.tag, pin.box], ['html', { x: 0, y: 0, w: 1200, h: 2000 }]);
});

test('held (an agent’s act batch, a watcher’s input): moves, presses and Escape reach the page; then it picks again', () => {
  const w = world();
  assert.equal(w.api.pick(true, true), true, 'on, held');
  w.fire('mousemove', { clientX: 115, clientY: 130, movementX: 1, movementY: 0, target: w.buy });
  assert.equal(w.frames(), 0, 'the hover box does not follow');
  const press = w.fire('mousedown', { clientX: 150, clientY: 158, target: w.buy });
  const click = w.fire('click', { clientX: 150, clientY: 158 });
  const escape = w.fire('keydown', { key: 'Escape' });
  assert.deepEqual([press.prevented, click.prevented, click.stopped, escape.prevented], [0, 0, 0, 0]);
  assert.equal(w.sent.filter((item) => item.k === 'pick').length, 0, 'no pin, no end');
  assert.equal(w.api.pick(true, false), true, 'the hold ends, the picker is still on');
  const again = w.fire('mousedown', { clientX: 150, clientY: 158, target: w.buy });
  assert.equal(again.prevented, 1);
  assert.equal(w.sent.filter((item) => item.k === 'pick').length, 1, 'the person’s press pins again');
});
