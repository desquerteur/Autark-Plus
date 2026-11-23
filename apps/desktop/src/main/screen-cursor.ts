// The AI cursor on this PC's screen (B-081, computer use): while an agent moves the real pointer through computer use
// (runtime/computer/pointer-input.ts names each planned path on 'screen:local' before the helper replays it), one
// transparent, frameless, click-through, never focused window per display draws the same AI cursor as the side tabs
// (shared/model/agent-cursor.ts: shape, colour, lean; main/side-driver/cursor-script.ts: the drawer) gliding along that
// path with the real pointer. The OS pointer itself still moves; the system's cursor settings stay as they are. A
// display's window opens with the first agent move on it; one unref'd timer hides them all HIDE_MS after the last move
// ends and closes them KEEP_MS later (no polling) – an agent's next move, seconds away behind a screenshot and its
// turn, finds its page loaded, so the drawn glide starts with the real one. Physical screen px become DIP per display
// (screen.screenToDipPoint), minus the display's origin; a draw that comes late (the hub's 100 ms throttle, a window
// still loading) skips the part of the path already travelled. The windows stay out of screenshots (content
// protection) and untitled (no window in the agents' lists).
// Windows only: macOS has no computer-use driver, and on Linux the helper's app-window guard (linux_guard.py) would
// take a full-screen window of the app for the app (every press refused) – drawn there once that guard skips it.
// Owns: following pointers.changed for screen:local (agents only), the overlay windows and what they draw. Never:
// imports electron at runtime (desktop.ts passes BrowserWindow and screen in), takes focus or mouse input, draws a
// person's pointer, or moves anything.

import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { EventMap } from '../shared/api/events.ts';
import type { Topic } from '../shared/api/protocol.ts';
import { cursorColor, tilted } from '../shared/model/agent-cursor.ts';
import type { MotionStep } from '../shared/model/pointer-motion.ts';
import type { PointerPoint, PointerState } from '../shared/model/pointers.ts';
import { cursorScript } from './side-driver/cursor-script.ts';

export const SCREEN_LOCAL = 'screen:local';
/** The overlays hide this long after the last move ended (the drawer has faded the cursor by then). */
export const HIDE_MS = 5000;
/** Hidden, they close this long later: the computer-use helper's own idle time (runtime/computer/helper.ts). */
export const KEEP_MS = 5 * 60_000;
/** At most this many agents' last draws are remembered (an event carries every live pointer of the screen). */
const MAX_DRAWN = 100;

export interface CursorDisplay { id: number; bounds: { x: number; y: number; width: number; height: number } }
/** One display's overlay page: `run` evaluates one line there (after it loaded) and shows it again, `hide` hides it, `close` destroys it. */
export interface CursorOverlay { run(line: string): void; hide(): void; close(): void }

export interface ScreenCursorDeps {
  rpc: { on(event: 'pointers.changed', listener: (data: EventMap['pointers.changed']) => void): () => void; subscribe(topic: Topic): Promise<() => void> };
  platform: NodeJS.Platform;
  displays(): CursorDisplay[];
  /** Physical screen px to DIP (electron screen.screenToDipPoint). */
  toDip(point: { x: number; y: number }): { x: number; y: number };
  open(display: CursorDisplay): CursorOverlay;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

/** The overlay page's own lines on top of the drawer: drawAt (late draws skip what was travelled) and gone. */
export const OVERLAY_SCRIPT = `
  const drawAt = (at, id, name, color, steps, click) => {
    const late = Math.max(0, Date.now() - at), list = Array.isArray(steps) ? steps : [];
    const rest = list.filter((s) => s.t >= late).map((s) => ({ x: s.x, y: s.y, t: s.t - late, r: s.r }));
    cursor(id, name, color, rest.length ? rest : list.slice(-1).map((s) => ({ x: s.x, y: s.y, t: 0, r: 0 })), click);
  };
  const gone = (id) => { const c = cursors.get(id); if (c) { clearTimeout(c.hide); c.box.style.opacity = '0'; } };
`;

/** The display holding `at` (DIP), else the nearest one. */
export function displayAt(displays: readonly CursorDisplay[], at: { x: number; y: number }): CursorDisplay | undefined {
  let best: CursorDisplay | undefined, bestGap = Infinity;
  for (const display of displays) {
    const b = display.bounds;
    const gap = Math.hypot(Math.max(b.x - at.x, 0, at.x - (b.x + b.width - 1)), Math.max(b.y - at.y, 0, at.y - (b.y + b.height - 1)));
    if (gap < bestGap) { best = display; bestGap = gap; }
  }
  return best;
}

export class ScreenCursor {
  private readonly deps: ScreenCursorDeps;
  private readonly overlays = new Map<number, { overlay: CursorOverlay; key: string }>();
  private readonly drawn = new Map<string, { at: number; display: number }>();
  private offs: Array<() => void> = [];
  private started = false;
  private timer: unknown;

  constructor(deps: ScreenCursorDeps) { this.deps = deps; }

  /** Follows the screen's pointers (once; the RpcClient keeps the topic over reconnects). Nothing on macOS and Linux. */
  async start(): Promise<void> {
    if (this.started || this.deps.platform !== 'win32') return;
    this.started = true;
    this.offs.push(this.deps.rpc.on('pointers.changed', (state) => this.changed(state)));
    const off = await this.deps.rpc.subscribe('system');
    if (this.started) this.offs.push(off); else off();
  }

  dispose(): void {
    this.started = false;
    for (const off of this.offs.splice(0)) off();
    this.clearTimer(this.timer);
    this.timer = undefined;
    this.closeAll();
  }

  private changed(state: PointerState): void {
    if (state?.surface !== SCREEN_LOCAL || !Array.isArray(state.points)) return;
    for (const point of state.points) {
      if (point?.actor?.kind !== 'agent' || typeof point.at !== 'number') continue;
      const last = this.drawn.get(point.actor.id);
      if (!last || point.at > last.at) this.draw(point, last?.display); // every event carries every live pointer: new ones only
    }
  }

  private draw(point: PointerPoint, before: number | undefined): void {
    const raw: MotionStep[] = point.path && point.path.length > 1 ? point.path : [{ x: point.x, y: point.y, t: 0 }];
    const dips = raw.map((step) => ({ ...this.deps.toDip({ x: step.x, y: step.y }), t: step.t }));
    const display = displayAt(this.deps.displays(), dips[dips.length - 1]!);
    if (!display) return;
    const { x: left, y: top } = display.bounds;
    const steps = tilted(dips.map((s) => ({ x: Math.round((s.x - left) * 10) / 10, y: Math.round((s.y - top) * 10) / 10, t: Math.max(0, Math.round(s.t)) })));
    const id = point.actor.id;
    if (before !== undefined && before !== display.id) this.overlays.get(before)?.overlay.run(`gone(${JSON.stringify(id)})`);
    const args = [point.at, id, point.actor.name, cursorColor(id), steps].map((value) => JSON.stringify(value));
    this.overlay(display).run(`drawAt(${args.join(', ')}, ${point.action === 'click'})`);
    this.drawn.delete(id);
    this.drawn.set(id, { at: point.at, display: display.id });
    if (this.drawn.size > MAX_DRAWN) this.drawn.delete(this.drawn.keys().next().value!);
    this.rest((steps[steps.length - 1]?.t ?? 0) + HIDE_MS);
  }

  /** The one timer, re-armed by each move: `ms` later every overlay hides, KEEP_MS after that they close. */
  private rest(ms: number): void {
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      for (const { overlay } of this.overlays.values()) overlay.hide();
      this.timer = this.setTimer(() => { this.timer = undefined; this.closeAll(); }, KEEP_MS);
    }, ms);
  }

  /** The display's overlay (a new one when its place changed). */
  private overlay(display: CursorDisplay): CursorOverlay {
    const key = JSON.stringify(display.bounds);
    const held = this.overlays.get(display.id);
    if (held?.key === key) return held.overlay;
    held?.overlay.close();
    const overlay = this.deps.open(display);
    this.overlays.set(display.id, { overlay, key });
    return overlay;
  }

  private closeAll(): void {
    for (const { overlay } of this.overlays.values()) overlay.close();
    this.overlays.clear();
  }

  private setTimer(fn: () => void, ms: number): unknown { return this.deps.setTimer ? this.deps.setTimer(fn, ms) : setTimeout(fn, ms).unref(); }

  private clearTimer(handle: unknown): void {
    if (handle !== undefined) (this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(handle);
  }
}

/** The overlay page: self-contained (its own policy allows its inline script only), transparent, untitled. */
export function overlayPage(): string {
  const script = `(() => {${cursorScript()}${OVERLAY_SCRIPT}  window.drawAt = drawAt; window.gone = gone;\n})();`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"><title></title></head><body><script>${script}</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** `ScreenCursorDeps.open` for Electron: one click-through window over the display, shown without focus once loaded. */
export function electronCursorOverlays(deps: { BrowserWindow: new (options: BrowserWindowConstructorOptions) => BrowserWindow; log?(line: string): void }): (display: CursorDisplay) => CursorOverlay {
  const page = overlayPage();
  return (display) => {
    const win = new deps.BrowserWindow({
      ...display.bounds, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, thickFrame: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true,
      alwaysOnTop: true, title: '',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false, backgroundThrottling: false, webgl: false, navigateOnDragDrop: false, safeDialogs: true },
    });
    const contents = win.webContents;
    win.setIgnoreMouseEvents(true); // click-through: every press reaches the window below (WindowFromPoint skips it)
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true); // out of every screenshot, the agents' own computer.screenshot too
    win.on('page-title-updated', (event) => event.preventDefault());
    contents.on('will-navigate', (event) => event.preventDefault());
    let ready = false, hidden = false;
    const waiting: string[] = [];
    const run = (line: string) => { void contents.executeJavaScript(line).catch(() => undefined); };
    contents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.setBounds(display.bounds); // once more on its own display (its scale is known now)
      if (!hidden) win.showInactive();
      ready = true;
      for (const line of waiting.splice(0)) run(line);
    });
    win.loadURL(page).catch((error: unknown) => deps.log?.(`screen cursor page not loaded: ${error instanceof Error ? error.message : 'error'}`));
    return {
      run: (line) => {
        if (win.isDestroyed()) return;
        if (hidden) { hidden = false; if (ready) win.showInactive(); }
        if (ready) run(line); else if (waiting.push(line) > 8) waiting.shift();
      },
      hide: () => { if (win.isDestroyed() || hidden) return; hidden = true; if (ready) win.hide(); },
      close: () => { if (!win.isDestroyed()) win.destroy(); },
    };
  };
}
