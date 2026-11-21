// B-081: the AI cursor – one look and one lean for every surface (shared/model/agent-cursor.ts) and the in-page
// drawer that side tabs embed (main/side-driver/cursor-script.ts), run in a small fake DOM: it travels the path,
// leans while it moves (only the arrowhead turns, never the name pill), eases back upright on arrival, and never
// leans under prefers-reduced-motion.
// Owns: these assertions. Never: a real DOM, a real timer or Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { AGENT_CURSOR, MAX_TILT_DEG, cursorColor, tilted } from '../../../src/shared/model/agent-cursor.ts';
import { planMotion, thinSteps } from '../../../src/shared/model/pointer-motion.ts';
import { cursorScript } from '../../../src/main/side-driver/cursor-script.ts';
import { pageScript } from '../../../src/main/side-driver/page-script.ts';

const right = planMotion({ x: 100, y: 100 }, { x: 400, y: 140 }, { style: 'glide' });
const left = planMotion({ x: 400, y: 140 }, { x: 120, y: 120 }, { style: 'glide' });

test('tilted keeps the path and adds a bounded lean: clockwise moving right, the other way moving left, 0 on arrival', () => {
  const out = tilted(right);
  assert.deepEqual(out.map(({ x, y, t }) => ({ x, y, t })), right, 'x, y and t stay as they are');
  assert.ok(out.every((step) => Math.abs(step.r) <= MAX_TILT_DEG), 'never more than 18 degrees');
  assert.equal(out.at(-1)!.r, 0, 'upright on arrival');
  assert.ok(Math.max(...out.map((step) => step.r)) > 10, 'a 300 px glide leans visibly');
  assert.ok(out.every((step) => step.r >= 0), 'moving right: clockwise only');
  assert.ok(tilted(left).every((step) => step.r <= 0) && Math.min(...tilted(left).map((step) => step.r)) < -10, 'moving left: the other way');
  const turn = tilted([...thinSteps(right, 12), ...thinSteps(left, 12).map((step) => ({ ...step, t: step.t + 300 }))]);
  assert.ok(turn.slice(0, 8).some((step) => step.r > 5) && turn.slice(14, 22).some((step) => step.r < -5), 'the lean swings over when the direction turns');
  const still = tilted([{ x: 5, y: 5, t: 10 }, { x: 5, y: 9, t: 20 }, { x: 5, y: 30, t: 30 }]);
  assert.deepEqual(still.map((step) => step.r), [0, 0, 0], 'straight down: no lean');
  assert.deepEqual(tilted([]), []);
  assert.deepEqual(tilted([{ x: 1, y: 2, t: 0 }]), [{ x: 1, y: 2, t: 0, r: 0 }], 'a jump: one upright step');
  assert.ok(tilted([{ x: 0, y: 0, t: 5 }, { x: 50, y: 0, t: 5 }, { x: 60, y: 0, t: 9 }]).every((step) => Number.isFinite(step.r)), 'no time between two steps: no NaN');
  const short = tilted(planMotion({ x: 0, y: 0 }, { x: 100, y: 0 }, { style: 'glide' }));
  assert.ok(Math.max(...short.map((step) => step.r)) < Math.max(...out.map((step) => step.r)), 'a short move leans less');
});

test('cursorColor: the same id always gets the same colour of the side driver’s old palette', () => {
  assert.equal(cursorColor('ag_ada'), '#0b7285');
  assert.equal(cursorColor('ag_bob'), '#c2255c');
  assert.equal(cursorColor('agent:x'), '#ae3ec9');
  assert.equal(cursorColor('ag_ada'), cursorColor('ag_ada'));
  assert.match(cursorColor(''), /^#[0-9a-f]{6}$/);
});

test('the arrowhead lies inside its box and turns around its tip', () => {
  const numbers = AGENT_CURSOR.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  assert.ok(numbers.every((n) => n >= 0 && n <= AGENT_CURSOR.width), 'every point inside the box');
  assert.match(AGENT_CURSOR.d, /^M[\d. LQ]+Z$/, 'lines and rounded corners only');
  assert.equal(AGENT_CURSOR.viewBox, `0 0 ${AGENT_CURSOR.width} ${AGENT_CURSOR.height}`);
  assert.ok(AGENT_CURSOR.tipX < 4 && AGENT_CURSOR.tipY < 4, 'the tip is the top-left corner');
});

type Node = { tagName: string; style: Record<string, string>; attrs: Record<string, string>; children: Node[]; shadow?: Node; textContent: string; animations: number; isConnected: boolean };

function element(tag: string): Node {
  const node: Node & Record<string, unknown> = {
    tagName: tag.toUpperCase(), style: {}, attrs: {}, children: [], textContent: '', animations: 0, isConnected: true,
  };
  node.setAttribute = (key: string, value: string) => { node.attrs[key] = String(value); };
  node.append = (...kids: Node[]) => { node.children.push(...kids); };
  node.appendChild = (kid: Node) => { node.children.push(kid); return kid; };
  node.attachShadow = () => (node.shadow = element('#shadow'));
  node.animate = () => { node.animations += 1; };
  return node;
}

function drawer(reduced = false) {
  let now = 0;
  let frames: Array<() => void> = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  const page = element('html');
  const win: Record<string, unknown> = {
    document: { createElement: element, createElementNS: (_ns: string, tag: string) => element(tag), documentElement: page, body: null },
    performance: { now: () => now },
    requestAnimationFrame: (run: () => void) => { frames.push(run); return frames.length; },
    cancelAnimationFrame: () => { frames = []; },
    setTimeout: (run: () => void, ms: number) => { timers.push({ run, ms }); return timers.length; },
    clearTimeout: () => {},
    matchMedia: (query: string) => ({ matches: reduced && query.includes('reduced-motion') }),
  };
  win.globalThis = win;
  vm.createContext(win);
  new vm.Script(`(() => {${cursorScript()}\n  globalThis.api = { cursor, state };\n})()`).runInContext(win);
  const api = win.api as { cursor(...args: unknown[]): void; state(): unknown };
  const parts = () => { const [ring, svg, label] = page.children[0]!.shadow!.children[0]!.children; return { ring: ring!, svg: svg!, label: label! }; };
  const state = () => JSON.parse(JSON.stringify(api.state())) as Array<{ id: string; x: number; y: number; r: number; shown: boolean }>;
  /** Runs frames every 16 ms until `ms` passed, recording the arrowhead's turn. */
  const play = (ms: number) => {
    const turns: number[] = [];
    for (let left = ms; left > 0; left -= 16) {
      now += 16;
      const run = frames; frames = [];
      run.forEach((frame) => frame());
      turns.push(state()[0]!.r);
    }
    return turns;
  };
  return { api, parts, state, play, timers };
}

const wire = (path: ReturnType<typeof planMotion>) => tilted(thinSteps(path, 80)).map((s) => ({ x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, t: Math.round(s.t), r: s.r }));

test('the drawer: the AI look, a lean while it travels, the pill never turns, upright with a 150 ms ease on arrival', () => {
  const page = drawer();
  page.api.cursor('ag_ada', 'Ada', '#0b7285', wire(right), true);
  const { ring, svg, label } = page.parts();
  assert.equal(svg.children[0]!.attrs.d, AGENT_CURSOR.d, 'the shared arrowhead');
  assert.deepEqual([svg.children[0]!.attrs.fill, svg.children[0]!.attrs.stroke], ['#0b7285', '#fff'], 'its colour, a white outline');
  assert.match(svg.style.cssText!, /transform-origin:3px 3px/, 'it turns around its tip');
  assert.match(svg.style.cssText!, /drop-shadow\(0 0 4px #0b72858c\)/, 'a static glow in its colour');
  assert.equal(label.textContent, 'Ada');
  const turns = page.play(right.at(-1)!.t + 40);
  assert.ok(Math.max(...turns) > 10 && Math.max(...turns) <= MAX_TILT_DEG, `leans while moving right (${Math.max(...turns)})`);
  assert.equal(label.style.transform, undefined, 'the name pill never turns');
  assert.deepEqual(page.state(), [{ id: 'ag_ada', x: 400, y: 140, r: 0, shown: true }], 'on the target, upright');
  assert.equal(svg.style.transition, 'transform .15s ease-out', 'easing back upright');
  assert.equal(svg.style.transform, 'rotate(0.0deg)');
  assert.equal(ring.animations, 1, 'a click shows its ring');
  page.api.cursor('ag_ada', 'Ada', '#0b7285', wire(left), false);
  assert.equal(svg.style.transition, 'none', 'per frame while it travels');
  const back = page.play(left.at(-1)!.t + 40);
  assert.ok(Math.min(...back) < -10, 'leans the other way moving left');
  assert.equal(ring.animations, 1, 'a move without a click: no ring');
  const hide = page.timers.filter((timer) => timer.ms === 4000).at(-1)!;
  hide.run();
  assert.equal(page.state()[0]!.shown, false, 'hidden after 4 s idle');
});

test('the drawer under prefers-reduced-motion: it still travels, never leans', () => {
  const page = drawer(true);
  page.api.cursor('ag_bob', 'Bob', '#c2255c', wire(right), false);
  const turns = page.play(right.at(-1)!.t + 40);
  assert.deepEqual([...new Set(turns)], [0], 'no lean at all');
  assert.equal(page.parts().svg.style.transform, undefined, 'the arrowhead is never turned');
  assert.deepEqual(page.state()[0], { id: 'ag_bob', x: 400, y: 140, r: 0, shown: true });
});

test('every side tab’s page script carries the drawer', () => {
  assert.ok(pageScript('__report').includes(cursorScript()));
  assert.doesNotThrow(() => new vm.Script(pageScript('__report')));
});
