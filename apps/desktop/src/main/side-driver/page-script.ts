// The script the side driver puts into every document of a side tab – in its own isolated
// world (DevTools Page.addScriptToEvaluateOnNewDocument with a world name), so the page can neither see
// nor call it. It
//   • reports the person's own mouse moves, clicks (B-081: and their end, 'up'), wheel and key presses (trusted events
//     only, moves at most every 100 ms, with role, name and a short selector of what is under the pointer) through a
//     binding that exists only in this world (Runtime.addBinding with executionContextName);
//   • draws each agent's named cursor (cursor-script.ts: the AI cursor's look, leaning as it travels) in a
//     closed shadow root over the page and animates it along the same path the driver moves the mouse;
//   • B-081: holds the Pin button's picker (pick-script.ts, top frame only): while it is on, the press, key and
//     click listeners below hand the left button and Escape to it before the page sees them;
//   • watches the document for changes while a wait asks for them; reads the page's text and the facts
//     for a human check (captcha frames, "Verify you are human" pages) and password fields;
//   • B-081 T9: says whether the focused element takes text (`editing`: open shadow roots and same-origin frames
//     followed; caster.ts asks after a watcher's press, so the phone's keyboard opens by itself).
// Only DOM APIs (no innerHTML, no style elements), so strict page policies do not block it.
// Owns: the in-page part of the driver. Never: reads field values, cookies or storage, or acts for an agent.

import { cursorScript } from './cursor-script.ts';
import { pickScript } from './pick-script.ts';

/** Hosts and paths of human checks (captcha widgets and challenge pages). */
export const CHALLENGE_URL = /(?:^|[/.])(?:hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs\.com|funcaptcha\.com|captcha-delivery\.com|geetest\.com|mtcaptcha\.com|friendlycaptcha\.(?:com|eu))(?:[/:?#]|$)|\/recaptcha\/(?:api2|enterprise)\/(?:anchor|bframe)|\/cdn-cgi\/challenge-platform\//i;
/** Words of a human-check page (short pages only). */
export const CHALLENGE_TEXT = /verify (?:that )?you(?:'re| are) (?:a )?human|are you a robot|i(?:'| a)?m not a robot|press (?:and|&) hold|checking (?:if the site connection is secure|your browser)|complete the security check|confirm you(?:'re| are) (?:a )?human|bestätigen sie, dass sie ein mensch sind|ich bin kein roboter|just a moment\.\.\./i;

/** Is this address a human check (a captcha frame or a challenge page)? */
export function isChallengeUrl(url: string): boolean {
  return CHALLENGE_URL.test(url) && !/[?&#](?:size=invisible|frame=checkbox-invisible)/i.test(url);
}

export function pageScript(binding: string): string {
  return `(() => {
  if (globalThis.__wfSide) return;
  const top = window === window.top;
  const send = (data) => { try { const fn = globalThis[${JSON.stringify(binding)}]; if (typeof fn === 'function') fn(JSON.stringify(data)); } catch {} };
  const clip = (s, n) => { s = String(s || '').replace(/\\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const ROLE = { A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', IMG: 'img', SUMMARY: 'button', OPTION: 'option', LABEL: 'label',
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading' };
  const INPUT = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox', number: 'spinbutton' };
  const CONTROL = 'a[href],button,input,select,textarea,summary,option,label,h1,h2,h3,h4,h5,h6,img,[contenteditable=""],[contenteditable="true"],[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=textbox],[role=combobox],[role=slider],[role=treeitem],[role=gridcell]';
  const roleOf = (el) => (el.getAttribute('role') || '').split(' ')[0] || (el.tagName === 'INPUT' ? INPUT[el.type] || 'textbox' : el.isContentEditable ? 'textbox' : ROLE[el.tagName] || '');
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label'); if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '); if (t.trim()) return t; }
    if (el.labels && el.labels.length) return el.labels[0].textContent;
    if (el.tagName === 'IMG') return el.alt || el.title;
    if (el.tagName === 'INPUT') return /^(submit|button|reset)$/.test(el.type) ? el.value : el.placeholder || el.title || '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return el.placeholder || el.title || '';
    return el.title || (el.textContent || '').slice(0, 200);
  };
  const target = (el) => {
    if (!el || el.nodeType !== 1) return undefined;
    const hit = el.closest(CONTROL);
    const sel = picker.sel(hit || el);
    if (!hit) { const t = clip(el.textContent, 120); return t && t.length < 120 ? { name: clip(t, 80), ...(sel ? { sel } : {}) } : sel ? { sel } : undefined; }
    const role = roleOf(hit), name = clip(nameOf(hit), 80);
    return role || name || sel ? { role: role || undefined, name: name || undefined, ...(sel ? { sel } : {}) } : undefined;
  };
  // ---- the Pin button's picker (pick-script.ts: picker)
${pickScript()}
  // ---- the person's input (moves at most every 100 ms; clicks at once); the picker takes the left button and Escape first
  const act = { capture: true }; // not passive: the picker may cancel these
  let last = 0, timer = 0, pending = null;
  const flush = () => {
    timer = 0; if (!pending) return;
    const p = pending; pending = null; last = Date.now();
    const out = { k: 'in', e: p.e };
    if (top && p.x !== undefined) { out.x = Math.round(p.x); out.y = Math.round(p.y); }
    if (!top) out.frame = 1;
    if (p.key) out.key = p.key;
    if (top && p.el) { const t = target(p.el); if (t) out.target = t; }
    send(out);
  };
  const queue = (p, now) => { pending = p; const wait = 100 - (Date.now() - last); if (now || wait <= 0) { clearTimeout(timer); flush(); } else if (!timer) timer = setTimeout(flush, wait); };
  const opts = { capture: true, passive: true };
  addEventListener('mousemove', (e) => { if (e.isTrusted && picker.on) picker.move(e); if (e.isTrusted && (e.movementX || e.movementY)) queue({ e: 'move', x: e.clientX, y: e.clientY, el: e.target }); }, opts);
  addEventListener('mousedown', (e) => { if (picker.press(e)) return; if (e.isTrusted) queue({ e: 'click', x: e.clientX, y: e.clientY, el: e.target }, true); }, act);
  addEventListener('wheel', (e) => { if (e.isTrusted) queue({ e: 'scroll', x: e.clientX, y: e.clientY, el: e.target }); }, opts);
  addEventListener('keydown', (e) => { if (picker.key(e)) return; if (e.isTrusted) queue({ e: 'type', key: e.key.length === 1 ? 'char' : e.key, el: document.activeElement }); }, act);
  for (const type of ['pointerdown', 'pointerup', 'mouseup', 'click', 'dblclick']) addEventListener(type, picker.swallow, act);
  addEventListener('mouseup', (e) => { if (e.isTrusted) queue({ e: 'up', x: e.clientX, y: e.clientY }, true); }, opts); // a press ends (after the picker's own)
  addEventListener('scroll', picker.changed, opts); // the picker's boxes follow (it does nothing while off)
  addEventListener('resize', picker.changed, opts);
  // ---- document changes, only while a wait asks
  let observer = null, mutLast = 0, mutTimer = 0;
  const changed = () => {
    const now = Date.now();
    if (now - mutLast >= 150) { mutLast = now; send({ k: 'mut' }); }
    else if (!mutTimer) mutTimer = setTimeout(() => { mutTimer = 0; mutLast = Date.now(); send({ k: 'mut' }); }, 150);
  };
  const watch = (on) => {
    if (on && !observer) { observer = new MutationObserver(changed); observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); }
    else if (!on && observer) { observer.disconnect(); observer = null; }
    return Boolean(observer);
  };
  // ---- named cursors (cursor-script.ts: cursor and state)
${cursorScript()}
  // ---- page facts
  const CHALLENGE = new RegExp(${JSON.stringify(CHALLENGE_URL.source)}, 'i');
  const WORDS = new RegExp(${JSON.stringify(CHALLENGE_TEXT.source)}, 'i');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 400) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const facts = () => {
    let human = false;
    for (const f of document.querySelectorAll('iframe')) {
      const src = f.src || '';
      if (src && CHALLENGE.test(src) && !/[?&#](?:size=invisible|frame=checkbox-invisible)/i.test(src) && visible(f)) { human = true; break; }
    }
    if (!human && document.querySelector('#challenge-running,#challenge-stage,#cf-challenge-running,.cf-browser-verification')) human = true;
    if (!human) {
      const body = document.body ? document.body.innerText || '' : '';
      if (body.length < 6000 && WORDS.test((document.title || '') + ' ' + body)) human = true;
    }
    return { human, passwords: document.querySelectorAll('input[type=password]').length };
  };
  const text = (max) => { const b = document.body || document.documentElement; return b ? String(b.innerText || '').slice(0, max) : ''; };
  const editing = () => {
    let el = document.activeElement;
    for (let hops = 0; el && hops < 8; hops++) {
      const inner = el.shadowRoot ? el.shadowRoot.activeElement : el.tagName === 'IFRAME' ? (() => { try { return el.contentDocument && el.contentDocument.activeElement; } catch { return null; } })() : null;
      if (!inner) break;
      el = inner;
    }
    if (!el || el.disabled || el.readOnly || el.tagName === 'IFRAME') return false;
    return (el.tagName === 'INPUT' && !/^(checkbox|radio|submit|button|reset|image|file|range|color|hidden)$/i.test(el.type)) || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
  };
  globalThis.__wfSide = { cursor, state, watch, facts, text, editing, pick: picker.set, passwords: () => [...document.querySelectorAll('input[type=password]')].slice(0, 20) };
})();`;
}
