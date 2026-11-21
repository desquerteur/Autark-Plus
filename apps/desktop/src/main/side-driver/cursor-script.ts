// The in-page drawer of the agents' named cursors (B-081), as a script string: page-script.ts embeds it in every
// side tab's isolated world, and a later desktop overlay page can embed the same string. It declares `cursor` and
// `state` in the scope it is placed in:
//   cursor(id, name, color, steps, click) – the agent's cursor travels along `steps` ({x, y, t, r}: page px, ms from
//     the move's start, lean in degrees – shared/model/agent-cursor.ts tilted) from where it is drawn, leaning as it
//     goes; on arrival the lean eases back to 0 in 150 ms and a click shows a ring; hidden after 4 s idle;
//   state() – each cursor's id, position, lean and whether it shows.
// The look is AGENT_CURSOR (a rounded arrowhead, the agent's colour, a white outline, a static glow) with the name
// pill beside it, in a closed shadow root over the page (pointer-events none, the top z-index). Only the arrowhead
// turns (around its tip); the pill never does, so nothing shifts. One animation frame loop per moving cursor, only
// transform and opacity change per frame; with prefers-reduced-motion the cursor still travels but never leans.
// Only DOM APIs (no innerHTML, no style elements), so strict page policies do not block it.
// Owns: drawing and animating the named cursors. Never: moves the real mouse, reads the page or keeps more than
// one element tree per cursor.

import { AGENT_CURSOR } from '../../shared/model/agent-cursor.ts';

export function cursorScript(): string {
  return `
  const NS = 'http://www.w3.org/2000/svg';
  const SHAPE = ${JSON.stringify(AGENT_CURSOR)};
  let host = null, root = null;
  const cursors = new Map();
  const still = () => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const ensure = () => {
    if (host && host.isConnected) return root;
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;';
    root = host.attachShadow({ mode: 'closed' });
    (document.documentElement || document.body).appendChild(host);
    cursors.clear();
    return root;
  };
  const make = (name, color) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-200px,-200px);transition:opacity .3s;opacity:0;will-change:transform;';
    const ring = document.createElement('div');
    ring.style.cssText = 'position:absolute;left:-14px;top:-14px;width:28px;height:28px;box-sizing:border-box;border-radius:50%;border:2px solid ' + color + ';opacity:0;';
    const glow = /^#[0-9a-f]{6}$/i.test(color) ? color + '8c' : color;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(SHAPE.width)); svg.setAttribute('height', String(SHAPE.height)); svg.setAttribute('viewBox', SHAPE.viewBox);
    svg.style.cssText = 'position:absolute;left:' + -SHAPE.tipX + 'px;top:' + -SHAPE.tipY + 'px;overflow:visible;transform-origin:' + SHAPE.tipX + 'px ' + SHAPE.tipY + 'px;will-change:transform;filter:drop-shadow(0 0 4px ' + glow + ') drop-shadow(0 1px 2px rgba(0,0,0,.35));';
    const head = document.createElementNS(NS, 'path');
    head.setAttribute('d', SHAPE.d);
    head.setAttribute('fill', color); head.setAttribute('stroke', '#fff'); head.setAttribute('stroke-width', '1.5'); head.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(head);
    const label = document.createElement('div');
    label.textContent = name;
    label.style.cssText = 'position:absolute;left:15px;top:17px;padding:2px 7px;border-radius:9px;background:' + color + ';color:#fff;font:600 12px/16px system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,.3);';
    box.append(ring, svg, label);
    root.appendChild(box);
    return { box, ring, svg, label, x: -200, y: -200, r: 0, raf: 0, hide: 0 };
  };
  const place = (c, x, y, r) => {
    c.x = x; c.y = y; c.box.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    if (r !== c.r) { c.r = r; c.svg.style.transform = 'rotate(' + r.toFixed(1) + 'deg)'; }
  };
  const cursor = (id, name, color, path, click) => {
    ensure();
    let c = cursors.get(id);
    if (!c || !c.box.isConnected) { c = make(name, color); cursors.set(id, c); }
    if (c.label.textContent !== name) c.label.textContent = name;
    clearTimeout(c.hide); cancelAnimationFrame(c.raf);
    c.box.style.opacity = '1';
    const steps = Array.isArray(path) ? path : [];
    if (!steps.length) return;
    const lean = !still();
    const tilt = (s) => (lean && typeof s.r === 'number' && isFinite(s.r) ? s.r : 0);
    c.svg.style.transition = 'none';
    const from = c.x < -100 ? { x: steps[0].x, y: steps[0].y, t: 0, r: 0 } : { x: c.x, y: c.y, t: 0, r: lean ? c.r : 0 };
    const last = steps[steps.length - 1], end = last.t, start = performance.now();
    const done = () => {
      c.svg.style.transition = 'transform .15s ease-out'; // the lean eases back to 0 on arrival
      place(c, last.x, last.y, 0);
      if (click && c.ring.animate) c.ring.animate([{ opacity: 0.9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 450, easing: 'ease-out' });
      c.hide = setTimeout(() => { c.box.style.opacity = '0'; }, 4000);
    };
    const frame = () => {
      const t = performance.now() - start;
      if (t >= end) { done(); return; }
      let i = 0; while (i < steps.length && steps[i].t < t) i++;
      const a = i === 0 ? from : steps[i - 1], b = steps[i], f = (t - a.t) / Math.max(1, b.t - a.t);
      const ra = i === 0 ? from.r : tilt(a), rb = i === steps.length - 1 ? ra : tilt(b); // the last stretch holds its lean for done()
      place(c, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, ra + (rb - ra) * f);
      c.raf = requestAnimationFrame(frame);
    };
    if (from.x !== steps[0].x || from.y !== steps[0].y || end > 0) place(c, from.x, from.y, from.r);
    frame();
  };
  const state = () => [...cursors].map(([id, c]) => ({ id, x: Math.round(c.x), y: Math.round(c.y), r: Math.round(c.r * 10) / 10, shown: c.box.isConnected && c.box.style.opacity === '1' }));
`;
}
