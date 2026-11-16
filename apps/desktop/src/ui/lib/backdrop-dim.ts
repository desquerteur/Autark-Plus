// Feedback 16.11.2026 (F13 – "alles dunkel, bis auf oben … die Minus und so weiter"): on the desktop a modal's backdrop
// dims the whole window but the native caption controls are drawn by the system, so they stayed bright. While any
// dialog with the backdrop is open (DIMMING: lib/dialog.tsx's and a dialog of its own like the tour's – not the
// feedback overlay, whose frozen screen shows the window as it was), main gets told to dim them too
// (bridge.setTitleBarDim → main/title-bar.ts dimmedColors), on change only: stacked dialogs dim with the first and
// undim when the last closes; a reload starts undimmed in main.
// Owns: whether the window is dimmed and telling main. Never: draws anything or opens dialogs.

import { bridge } from './platform.ts';

/** The open dialogs whose backdrop dims the window (base.css dialog.dialog::backdrop). */
export const DIMMING = 'dialog.dialog[open]';

/** Passes `dim` on only when it changed (a report that throws – main is gone – is dropped). */
export function dimReporter(report: (dim: boolean) => void): (dim: boolean) => void {
  let shown = false;
  return (dim) => {
    if (dim === shown) return;
    shown = dim;
    try { report(dim); } catch { /* main is gone */ }
  };
}

let recheck: (() => void) | null = null;

/**
 * Installed by the first dialog that mounts (desktop only; elsewhere a no-op): every dialog's open attribute is watched,
 * no polling. Returns a re-check for a dialog that unmounts while open (that removes no attribute).
 */
export function watchBackdropDim(): () => void {
  if (recheck) return recheck;
  const report = bridge?.setTitleBarDim;
  if (!report || typeof MutationObserver === 'undefined') { recheck = () => undefined; return recheck; }
  const tell = dimReporter(report);
  const check = () => tell(document.querySelector(DIMMING) !== null);
  new MutationObserver(check).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  recheck = () => queueMicrotask(check);
  check();
  return recheck;
}
