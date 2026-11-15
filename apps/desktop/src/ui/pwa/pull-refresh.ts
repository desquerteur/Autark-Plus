// B-084 (owner's Nachtrag: "nach unten ziehen … dass die neuen Daten reinkommen"): on a phone's tab root, a downward
// pull of PULL_PX or more that starts where everything under the finger is scrolled to the top calls lib/rpc.ts
// refresh() – a socket that is not open connects now, an open one is probed and everything reloads. A touch in a field,
// on a surface that turns a finger into input of its own (the mirrored PC browser, role="application"), in a scroller
// that is not at its top, or under touch-action none/pan-x never counts. The indicator is a small fixed spinner over the
// body under the top row (pointer-events none, its own layer), so nothing shifts; it fades in with the pull and spins
// after the release until the connection opens or reloads (rpc.open), at most SPIN_MS. Passive listeners on the phone
// frame's main element (shell/MobileShell.tsx), like workspace/phone-swipe.ts; pushed screens (Back, no tab bar) skip it.
// Owns: the gesture, its threshold and the spinner. Never: what a refresh does (lib/rpc.ts), styles in mobile.css.

/** How far the finger travels down before it counts (dp = CSS px on a phone). */
export const PULL_PX = 64;
const SPIN_MS = 4_000;

/** Elements whose vertical moves are their own. */
const OWNS_PULL = 'input, textarea, select, [contenteditable="true"], [role="application"], .browser-touch, .no-pull';

/** True when a finished touch is a pull (pure): far enough down and clearly more down than sideways. */
export function isPull(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  const dy = end.y - start.y;
  return dy >= PULL_PX && dy > 2 * Math.abs(end.x - start.x);
}

/** True when a pull may start at `target`: every scroller from it up to `root` is at its top and owns no pull. */
export function pullStarts(target: EventTarget | null, root: HTMLElement): boolean {
  if (root.closest('.pushed')) return false; // only tab roots
  for (let node = target as HTMLElement | null; node; node = node === root ? null : node.parentElement) {
    if (node.matches?.(OWNS_PULL) || node.scrollTop > 0) return false;
    const action = getComputedStyle(node).touchAction;
    if (action === 'none' || action === 'pan-x') return false;
  }
  return true;
}

/** Listens on `root`; `refresh` runs on a pull, `onSettled` reports the next open/reload (returns its stop). */
export function watchPullRefresh(root: HTMLElement, refresh: () => void, onSettled: (fn: () => void) => () => void): () => void {
  let start: { x: number; y: number } | undefined;
  let spinner: HTMLElement | undefined;
  let hide: (() => void) | undefined;
  const show = (opacity: number) => {
    if (!spinner) {
      spinner = document.createElement('div');
      spinner.setAttribute('aria-hidden', 'true');
      spinner.style.cssText = `position:fixed;left:50%;top:${root.getBoundingClientRect().top + 12}px;width:32px;height:32px;margin-left:-16px;border-radius:50%;display:grid;place-items:center;background:var(--elevated);color:var(--text);box-shadow:var(--shadow-popover);pointer-events:none;z-index:40`;
      spinner.innerHTML = '<span class="spinner" style="width:16px;height:16px"></span>';
      document.body.appendChild(spinner);
    }
    spinner.style.opacity = String(opacity);
  };
  const remove = () => { hide?.(); hide = undefined; spinner?.remove(); spinner = undefined; };
  const down = (event: TouchEvent) => {
    const touch = event.touches[0];
    start = event.touches.length === 1 && !hide && touch && pullStarts(event.target, root) ? { x: touch.clientX, y: touch.clientY } : undefined;
  };
  const move = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!start || !touch) return;
    const dy = touch.clientY - start.y;
    if (dy > 8) show(Math.min(1, dy / PULL_PX)); else if (spinner && !hide) remove();
  };
  const up = (event: TouchEvent) => {
    const from = start;
    start = undefined;
    const touch = event.changedTouches[0];
    if (!from || !touch || !isPull(from, { x: touch.clientX, y: touch.clientY })) { if (!hide) remove(); return; }
    show(1);
    const stop = onSettled(() => remove());
    const timer = setTimeout(remove, SPIN_MS);
    hide = () => { stop(); clearTimeout(timer); };
    refresh();
  };
  const cancel = () => { start = undefined; if (!hide) remove(); };
  root.addEventListener('touchstart', down, { passive: true });
  root.addEventListener('touchmove', move, { passive: true });
  root.addEventListener('touchend', up, { passive: true });
  root.addEventListener('touchcancel', cancel, { passive: true });
  return () => {
    remove();
    root.removeEventListener('touchstart', down);
    root.removeEventListener('touchmove', move);
    root.removeEventListener('touchend', up);
    root.removeEventListener('touchcancel', cancel);
  };
}
