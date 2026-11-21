// The Pin button's picker in a side tab (B-081), as a script fragment that page-script.ts embeds in its isolated world
// (top frame only). It declares `picker` in the scope it is placed in and uses that scope's send, clip, roleOf, nameOf
// and – for its boxes in the named cursors' closed shadow root – cursor-script.ts's ensure() and host:
//   picker.set(on, held) – on: a box with a label ("tag.class W×H") follows the deepest element under the pointer, moved
//     at most once per animation frame (and on scroll or resize) while picking; off: every box goes; held (main's own
//     input goes in – an agent's act batch, a watcher's): moves, presses and keys reach the page untouched meanwhile;
//   picker.press(e) – a trusted left mousedown while picking: swallowed and pinned – one outline marks the latest pin and
//     every pin goes to main as {k:'pick', sel, tag, role?, name?, text?, box:{x,y,w,h}, at, edge?, st, src?, par?};
//   picker.swallow  – pointerdown/pointerup/mouseup/click/dblclick of the left button while picking never reach the page
//     (pointerdown is only stopped: cancelling it would also cancel the mousedown that pins);
//   picker.key(e)   – Escape ends picking and tells main ({k:'pick', off:1});
//   picker.sel(el)  – a short selector of an element and its parent for the person's hover report.
// "Deepest" is elementFromPoint, into open shadow roots, then down through the children whose box holds the point (an
// icon or a hairline that takes no pointer events), never the cursors' own overlay host. The selector walk stops at an
// #id or at the first level that is unique, at most 5 levels, without classes longer than 31 characters or with ':'.
// Styles: only key ones that are not the defaults; a border is read per side when its sides differ.
// Owns: the picker in the page. Never: reads field values or polls; while it is off it draws and cancels nothing (only
// `sel` serves the hover report).

export function pickScript(): string {
  return `
  const picker = (() => {
    let on = false, held = false, px = -1, py = -1, frame = 0, pinned = null, boxes = null;
    const SIMPLE = /^[A-Za-z_-][\\w-]*$/;
    const STYLES = ['font-size', 'font-weight', 'line-height', 'color', 'background-color', 'padding', 'margin', 'border-radius', 'gap', 'display', 'opacity', 'box-shadow'];
    const SVG_STYLES = ['fill', 'stroke'];
    const PLAIN = /^(?:0px|none|normal|auto|rgba\\(0, 0, 0, 0\\)|400|1|block|inline)$/;
    const SOURCE = ['data-insp-path', 'data-sentry-source-file', 'data-source', 'data-file', 'data-loc'];
    const parentOf = (el) => el.parentElement || (el.parentNode && el.parentNode.host) || null;
    const classes = (el) => [...(el.classList || [])].filter((c) => c.length < 32 && !c.includes(':') && SIMPLE.test(c));
    const short = (el) => { const tag = String(el.tagName || '').toLowerCase(); if (el.id && SIMPLE.test(el.id) && el.id.length < 48) return tag + '#' + el.id; const c = classes(el)[0]; return c ? tag + '.' + c : tag; };
    const part = (el) => {
      if (el.id && SIMPLE.test(el.id) && el.id.length < 48) return '#' + el.id;
      const cls = classes(el).slice(0, 2);
      let out = String(el.tagName).toLowerCase() + cls.map((c) => '.' + c).join('');
      const parent = el.parentNode;
      if (parent && parent.children) {
        const same = [...parent.children].filter((c) => c.tagName === el.tagName);
        if (same.some((c) => c !== el && cls.every((k) => c.classList.contains(k)))) out += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      return out;
    };
    const unique = (root, sel) => { try { return root.querySelectorAll(sel).length === 1; } catch { return false; } };
    const selectorOf = (el, depth) => {
      const root = el.getRootNode ? el.getRootNode() : document;
      const parts = [];
      for (let node = el, n = 0; node && node.nodeType === 1 && n < 5; node = node.parentElement, n++) {
        parts.unshift(part(node));
        if (parts[0][0] === '#' || unique(root, parts.join(' > '))) break;
      }
      const sel = parts.join(' > ');
      return root && root.host && depth < 2 ? selectorOf(root.host, depth + 1) + ' >>> ' + sel : sel;
    };
    const holds = (r, x, y) => r.width > 0 && r.height > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    const deepest = (x, y) => {
      let el = document.elementFromPoint(x, y);
      for (let n = 0; el && el.shadowRoot && n < 16; n++) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
      for (let n = 0; el && n < 24; n++) {
        const kids = el.shadowRoot ? el.shadowRoot.children : el.children;
        let next = null;
        for (let i = (kids ? kids.length : 0) - 1, seen = 0; i >= 0 && seen < 200; i--, seen++) {
          const kid = kids[i];
          if (kid === host || kid.tagName === 'SLOT' || !holds(kid.getBoundingClientRect(), x, y)) continue; // host: the overlay (cursor-script.ts)
          const look = getComputedStyle(kid);
          if (look.visibility === 'hidden' || look.opacity === '0') continue;
          next = kid; break;
        }
        if (!next) break;
        el = next;
      }
      return el && el.nodeType === 1 ? el : null;
    };
    const round = (v) => Math.round(v * 10) / 10;
    const stylesOf = (el) => {
      const s = getComputedStyle(el), out = {};
      const keep = (k) => { const v = String(s.getPropertyValue(k) || '').trim(); if (v && !PLAIN.test(v)) out[k] = clip(v, 60); };
      STYLES.forEach(keep);
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') { SVG_STYLES.forEach(keep); if (out.stroke) keep('stroke-width'); }
      const border = String(s.getPropertyValue('border') || '').trim();
      if (border) { if (!/^0px/.test(border)) out.border = clip(border, 60); }
      else for (const side of ['top', 'right', 'bottom', 'left']) { const v = String(s.getPropertyValue('border-' + side) || '').trim(); if (v && !/^0px/.test(v)) out['border-' + side] = clip(v, 60); }
      return out;
    };
    const describe = (el, x, y) => {
      const r = el.getBoundingClientRect();
      const gaps = { top: y - r.top, right: r.right - x, bottom: r.bottom - y, left: x - r.left };
      let edge;
      for (const side of ['top', 'right', 'bottom', 'left']) if (gaps[side] >= -1 && gaps[side] <= 4 && (edge === undefined || gaps[side] < gaps[edge])) edge = side;
      const role = roleOf(el), text = clip(el.textContent, 120);
      const name = role || el.getAttribute('aria-label') ? clip(nameOf(el), 80) : '';
      let src;
      for (let node = el, n = 0; node && node.nodeType === 1 && n < 12 && !src; node = parentOf(node), n++) for (const a of SOURCE) { const v = node.getAttribute(a); if (v) { src = clip(v, 160); break; } }
      const par = [];
      for (let node = parentOf(el); node && node.nodeType === 1 && par.length < 2 && node.tagName !== 'BODY' && node.tagName !== 'HTML'; node = parentOf(node)) {
        const b = node.getBoundingClientRect();
        if (b.width >= 1 && b.height >= 1) par.push(short(node) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
      }
      return { k: 'pick', sel: clip(selectorOf(el, 0), 200), tag: String(el.tagName).toLowerCase(), ...(role ? { role } : {}), ...(name && name !== text ? { name } : {}), ...(text ? { text } : {}),
        box: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) }, at: { x: round(x), y: round(y) }, ...(edge ? { edge } : {}),
        st: stylesOf(el), ...(src ? { src } : {}), ...(par.length ? { par } : {}) };
    };
    const boxesOf = () => {
      if (boxes && boxes.hover.isConnected) return boxes;
      const root = ensure();
      const box = (css) => { const el = document.createElement('div'); el.style.cssText = 'position:absolute;left:0;top:0;box-sizing:border-box;display:none;pointer-events:none;' + css; root.appendChild(el); return el; };
      boxes = {
        pin: box('border:2px solid #f59e0b;box-shadow:0 0 0 1px rgba(255,255,255,.85);'),
        hover: box('border:1px solid #2563eb;background:rgba(37,99,235,.12);'),
        label: box('padding:1px 6px;border-radius:4px;background:#1d4ed8;color:#fff;font:600 11px/16px system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;'),
      };
      return boxes;
    };
    const fit = (box, r) => {
      if (!r) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      box.style.transform = 'translate(' + r.left + 'px,' + r.top + 'px)';
      box.style.width = Math.max(1, r.width) + 'px';
      box.style.height = Math.max(1, r.height) + 'px';
    };
    const draw = () => {
      frame = 0;
      if (!on) return;
      const b = boxesOf();
      const el = px >= 0 ? deepest(px, py) : null;
      const r = el ? el.getBoundingClientRect() : null;
      fit(b.hover, r);
      if (r) {
        b.label.textContent = short(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height);
        b.label.style.display = 'block';
        b.label.style.transform = 'translate(' + Math.max(0, r.left) + 'px,' + (r.top >= 18 ? r.top - 18 : r.bottom + 2) + 'px)';
      } else b.label.style.display = 'none';
      fit(b.pin, pinned && pinned.isConnected ? pinned.getBoundingClientRect() : null);
    };
    const ask = () => { if (on && !frame) frame = requestAnimationFrame(draw); };
    const set = (next, hold) => {
      held = Boolean(hold);
      next = Boolean(next) && top;
      if (next === on) return on;
      on = next;
      if (!on) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0; pinned = null; px = -1; py = -1;
        if (boxes) for (const el of [boxes.pin, boxes.hover, boxes.label]) el.style.display = 'none';
      }
      return on;
    };
    const left = (e) => on && !held && e.isTrusted && e.button === 0;
    return {
      get on() { return on; },
      set,
      move: (e) => { if (held) return; px = e.clientX; py = e.clientY; ask(); },
      changed: () => ask(),
      press: (e) => {
        if (!left(e)) return false;
        e.preventDefault(); e.stopImmediatePropagation();
        const el = deepest(e.clientX, e.clientY);
        if (el) { pinned = el; px = e.clientX; py = e.clientY; send(describe(el, e.clientX, e.clientY)); ask(); }
        return true;
      },
      swallow: (e) => { if (!left(e)) return; if (e.type !== 'pointerdown' && e.type !== 'pointerup') e.preventDefault(); e.stopImmediatePropagation(); },
      key: (e) => {
        if (!on || held || !e.isTrusted || e.key !== 'Escape') return false;
        e.preventDefault(); e.stopImmediatePropagation();
        set(false); send({ k: 'pick', off: 1 });
        return true;
      },
      sel: (el) => { if (!el || !el.tagName) return ''; const up = parentOf(el); return clip((up && up.tagName && up.tagName !== 'HTML' ? short(up) + ' > ' : '') + short(el), 100); },
    };
  })();
`;
}
