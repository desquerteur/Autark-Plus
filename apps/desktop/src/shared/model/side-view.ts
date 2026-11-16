// A website tab of the person's side browser watched from another of their PCs or from their phone (B-076, the owner's
// 05.11.2026 wish): the page runs, loads and keeps its logins only on the PC where it was opened; the viewer gets a live
// picture of it (a DevTools screencast, pulled one frame at a time like browser.pull) and sends clicks, wheel turns,
// keys, text and navigation back. main/side-driver/caster.ts casts, runtime/browser/side-view.ts holds the pulls,
// runtime/devices/side-view.ts carries them between linked PCs, ui/workspace/RemoteWebTab.tsx shows them.
// B-081: the viewer names its picture box (`view`, CSS px) with every pull; while it watches, the page there takes that
// size (caster.ts), so the picture fills the viewer's box whatever pane the page sits in on its PC. B-081 T9: the page
// says each time a press of the viewer left a text field focused (`editing`, a stamp), so a phone opens its keyboard.
// side.* are merged into Methods by module augmentation.
// Owns: these shapes, their limits, the clamp of a view size and how an older PC's refusal of it reads. Never: behaviour
// beyond those checks.

import type { BrowserInput, BrowserNavigation } from './browser.ts';

/** A pull waits at most this long for a change by default: each pull keeps the page awake on its PC, so a page the
 *  person there stopped showing paints again within this time. */
export const SIDE_WAIT_MS = 5000;
/** A forwarded frame part stays this small, so one picture never holds up the link's other traffic for long. */
export const SIDE_PART_BYTES = 1024 * 1024;
/** A side-browser tab id (main/workspace-browser.ts makes them: 'web-<uuid>'). */
export const SIDE_TAB_ID = /^web-[a-zA-Z0-9-]{1,80}$/;
/** A viewer's picture box (whole CSS px) stays within these, on either side. */
export const SIDE_VIEW_MIN = 200;
export const SIDE_VIEW_MAX = 4096;

/** The viewer's picture box in whole CSS px: the page's viewport on its PC while that viewer watches. */
export interface SideViewSize { width: number; height: number }

/** A box size as a view: whole px, each side within SIDE_VIEW_MIN … SIDE_VIEW_MAX. */
export function clampView(width: number, height: number): SideViewSize {
  const side = (value: number) => Math.min(SIDE_VIEW_MAX, Math.max(SIDE_VIEW_MIN, Math.round(Number.isFinite(value) ? value : SIDE_VIEW_MIN)));
  return { width: side(width), height: side(height) };
}

/** Both views name the same size (none is never the same). */
export const sameView = (a?: SideViewSize, b?: SideViewSize): boolean => Boolean(a && b && a.width === b.width && a.height === b.height);

/** A PC from before B-081 refuses side.pull's `view` key (bad_request on "params.view"): it is asked without one. */
export function refusesView(error: unknown): boolean {
  type Details = { details?: { param?: unknown } };
  const e = error as (Details & { code?: unknown; message?: unknown; data?: Details }) | null | undefined; // RpcError or WorkforceError
  if (e?.code !== 'bad_request') return false;
  const param = e.data?.details?.param ?? e.details?.param;
  return typeof param === 'string' ? param === 'params.view' : typeof e.message === 'string' && e.message.includes('"params.view"');
}

/** A dialog the page opened on its PC (alert, confirm, beforeunload …): the page waits until it is answered. */
export interface SideDialog { type: string; message: string }

/** The page as it is on its PC. */
export interface SidePage {
  url: string;
  title: string;
  back: boolean;
  forward: boolean;
  loading: boolean;
  /** Open while the page waits for an answer (side.nav `dialog`). */
  dialog?: SideDialog;
  /** B-081 T9: a watcher's press that ended left the page's focus on an element that takes text – a new stamp (host ms,
   *  rising) for each such press, so a tap into the next field is news too (the phone opens its keyboard); absent: none. */
  editing?: number;
}

export interface SideViewState extends SidePage {
  /** The tab id on the PC where the page runs ('web-…'). */
  tab: string;
  /** The name of that PC ("office-pc"). */
  pc: string;
  /** The tab is open there. */
  open: boolean;
  /** Frames flow. */
  live: boolean;
  /** Why nothing can be shown (the tab closed, its DevTools hold it …). */
  error?: string;
  at: number;
}

export interface SideFrame {
  tab: string;
  /** JPEG, base64, at most 1280 px on either side. */
  data: string;
  /** The page viewport (gives the frame's aspect ratio and the click mapping's units). */
  width: number;
  height: number;
  at: number;
}

/** side.pull: the next state or frame after `after`; `device` – the PC where the tab runs (omitted: this PC). */
export interface SidePullRequest {
  device?: string;
  tab: string;
  after?: { state?: number; frame?: number };
  maxBytes?: number;
  waitMs?: number;
  /** B-081: the viewer's picture box; the page takes this size while it watches (clamped to SIDE_VIEW_MIN … MAX). */
  view?: SideViewSize;
}

/** With `parts` > 1, `frame.data` is part 0 – fetch parts 1 … parts-1 with side.pullPart and join them. */
export interface SidePull {
  state: SideViewState;
  frame?: SideFrame;
  parts?: number;
}

export interface SidePartRequest {
  device?: string;
  tab: string;
  at: number;
  index: number;
}

/** side.nav: exactly one of an http(s) address, back / forward / reload, or the answer to the page's open dialog. */
export interface SideNav {
  device?: string;
  tab: string;
  url?: string;
  action?: BrowserNavigation;
  dialog?: 'accept' | 'dismiss';
}

// ------------------------------------------------------------------ main ↔ runtime (host bridge)

/** One DevTools input command main runs in the tab (only Input.dispatchMouseEvent, dispatchKeyEvent, insertText). */
export interface SideCommand { method: string; params: Record<string, unknown> }

/** The screencast frame's viewport as Chrome reports it, plus the tab's zoom (main → runtime; the runtime maps clicks). */
export interface SideFrameMeta { deviceWidth: number; deviceHeight: number; offsetTop: number; pageScaleFactor: number; zoom: number }

/** What main tells the runtime about a cast tab: the page with every frame and when it navigates; `error` ends the cast. */
export interface SideCastUpdate {
  tab: string;
  page: SidePage;
  live: boolean;
  error?: string;
  frame?: { data: string; meta: SideFrameMeta };
}

declare module '../api/methods.ts' {
  interface Methods {
    /** One state or frame at a time of a side-browser tab, on this PC or (device) a linked PC of the owner. */
    'side.pull': { params: SidePullRequest; result: SidePull };
    /** The next part of a frame too large for one reply (side.pull `parts`). */
    'side.pullPart': { params: SidePartRequest; result: { data: string } };
    /** The person's mouse, wheel, key or text input on that tab – it goes to the page on its PC (typed text is never kept). */
    'side.input': { params: { device?: string; tab: string; input: BrowserInput }; result: { ok: true } };
    /** A new address, back, forward, reload or the answer to the page's dialog in that tab on its PC. */
    'side.nav': { params: SideNav; result: { ok: true } };
    /**
     * 16.11.2026: a page opened in a new tab of this PC's pane (global), shown there at once – the phone's pane is the
     * PC's, so a page that has to run on the PC (a sign-in whose answer returns to the PC's own address) is done from the
     * phone; `tab`: its id there.
     */
    'side.open': { params: { url: string }; result: { ok: true; tab?: string } };
  }
}
