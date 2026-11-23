// The Electron side of the floating to-do button (float-bar.ts): one frameless, transparent, always-on-top window,
// out of the taskbar and out of every screen capture (content protection – so the button's own screenshot, and an
// agent's computer.screenshot, show the screen under it). Its page (float-bar-page.ts) lives in a private in-memory
// session of its own ('wf-float'): wf-file://float/ serves the page and /act the actions; every other request is
// cancelled; the only permission is the microphone (audio only) for dictation. No preload, no node, no devtools, no
// popups, no navigation. The dot and the tab show without taking focus; the panel takes the keyboard.
// startFloatBar is desktop.ts's one call (the screen, the capture, the place file float-bar.json).
// Owns: the window, its session and the shortcut. Never: imports electron values (desktop.ts injects them) or decides
// anything about the post.

import { readFileSync, writeFileSync } from 'node:fs';
import type { BrowserWindow, BrowserWindowConstructorOptions, NativeImage, Session } from 'electron';
import type { NavigateRequest } from '../shared/api/desktop.ts';
import type { Capture } from './capture.ts';
import { FLOAT_KEYS, FloatBar, type FloatAction, type FloatDeps, type FloatLook, type FloatPlace, type FloatWindow, type Rect } from './float-bar.ts';
import { floatPage } from './float-bar-page.ts';

export const FLOAT_PARTITION = 'wf-float';
export const FLOAT_ORIGIN = 'wf-file://float';
const MAX_BODY = 16 * 1024 * 1024; // a two-minute dictation as base64 WAV is about 5 MB

export interface FloatElectron {
  BrowserWindow: new (options: BrowserWindowConstructorOptions) => BrowserWindow;
  fromPartition(partition: string, options: { cache: boolean }): Session;
  screen: { getDisplayNearestPoint(point: { x: number; y: number }): { workArea: Rect } };
  globalShortcut: { register(accelerator: string, callback: () => void): boolean; unregister(accelerator: string): void };
}

const ACTS = new Set(['view', 'open', 'close', 'fold', 'unfold', 'shot', 'drop', 'move', 'moved', 'text', 'hear', 'send', 'hold', 'quick']);

/** The page's JSON as an action, or null (anything else is refused). */
export function readAction(value: unknown): FloatAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.act !== 'string' || !ACTS.has(raw.act)) return null;
  const num = (key: string) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] as number : null);
  const str = (key: string) => (typeof raw[key] === 'string' ? raw[key] as string : null);
  switch (raw.act) {
    case 'drop': { const index = num('index'); return index === null ? null : { act: 'drop', index }; }
    case 'move': { const x = num('x'), y = num('y'); return x === null || y === null ? null : { act: 'move', x, y }; }
    case 'text': { const text = str('text'); return text === null ? null : { act: 'text', text }; }
    case 'hear': { const wav = str('wav'); return wav === null ? null : { act: 'hear', wav }; }
    case 'quick': { const wav = str('wav'); return wav === null ? null : { act: 'quick', wav }; }
    case 'send': { const text = str('text'); return text === null ? null : { act: 'send', text, ...(raw.call === true ? { call: true } : {}) }; }
    default: return { act: raw.act } as FloatAction;
  }
}

/** Opens the button. Returns its close (quit). */
export function openFloatBar(electron: FloatElectron, deps: FloatDeps): { close(): void; bar: FloatBar } {
  const session = electron.fromPartition(FLOAT_PARTITION, { cache: false });
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const media = details as { mediaTypes?: string[] };
    callback(permission === 'media' && (media.mediaTypes ?? []).every((type) => type === 'audio'));
  });
  session.setPermissionCheckHandler((_contents, permission) => permission === 'media');
  session.setDevicePermissionHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${FLOAT_ORIGIN}/`) }));

  const win = new electron.BrowserWindow({
    width: 44, height: 44, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, thickFrame: false,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, title: 'To-do',
    webPreferences: {
      session, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false, spellcheck: true,
      backgroundThrottling: false, webgl: false, navigateOnDragDrop: false, safeDialogs: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setContentProtection(true); // out of every screenshot: the button's own and the agents'
  win.setVisibleOnAllWorkspaces(true);
  const contents = win.webContents;
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('page-title-updated', (event) => event.preventDefault());

  let loaded = false;
  let look: FloatLook = 'dot';
  const window: FloatWindow = {
    bounds: () => win.getBounds(),
    setBounds: (rect) => { if (!win.isDestroyed()) win.setBounds(rect); },
    workArea: (point) => electron.screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) }).workArea,
    show: (next, focus) => {
      look = next;
      if (win.isDestroyed() || !loaded) return;
      win.setFocusable(next === 'panel');
      if (focus) { win.show(); win.focus(); } else win.showInactive();
      void contents.executeJavaScript(`window.render && window.render(${JSON.stringify(bar.view())})`).catch(() => undefined);
    },
  };
  const bar = new FloatBar(deps, window);

  session.protocol.handle('wf-file', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'float') return new Response(null, { status: 404 });
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(floatPage(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/act' && request.method === 'POST') {
      const body = await request.text();
      if (body.length > MAX_BODY) return new Response(null, { status: 413 });
      let action: FloatAction | null = null;
      try { action = readAction(JSON.parse(body)); } catch { action = null; }
      if (!action) return new Response(null, { status: 400 });
      const view = await bar.act(action);
      return new Response(JSON.stringify(view), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, { status: 404 });
  });

  contents.once('did-finish-load', () => {
    loaded = true;
    window.show(look, false);
  });
  win.loadURL(`${FLOAT_ORIGIN}/`).catch((error: unknown) => deps.log(`float bar page not loaded: ${error instanceof Error ? error.message : 'error'}`));
  const keyed = electron.globalShortcut.register(FLOAT_KEYS, () => { void bar.toggle(); });

  return {
    bar,
    close: () => {
      if (keyed) electron.globalShortcut.unregister(FLOAT_KEYS);
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

interface DisplayAt { id: number; workArea: Rect }

/** desktop.ts's one call: the button with this PC's screen, capture, RPC and its place file. */
export function startFloatBar(
  electron: {
    BrowserWindow: FloatElectron['BrowserWindow'];
    session: { fromPartition(partition: string, options: { cache: boolean }): Session };
    screen: { getDisplayNearestPoint(point: { x: number; y: number }): DisplayAt; getAllDisplays(): Array<{ id: number }>; getPrimaryDisplay(): DisplayAt };
    globalShortcut: FloatElectron['globalShortcut'];
    nativeImage: { createFromBuffer(buffer: Buffer): NativeImage };
  },
  deps: { rpc: FloatDeps['rpc']; capture: Pick<Capture, 'screenshot'>; file: string; open(request: NavigateRequest): void; log(line: string): void },
): { close(): void } {
  const { screen } = electron;
  return openFloatBar({ BrowserWindow: electron.BrowserWindow, fromPartition: (name, options) => electron.session.fromPartition(name, options), screen, globalShortcut: electron.globalShortcut }, {
    rpc: deps.rpc,
    shot: async (point) => {
      const near = screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) }).id;
      const index = Math.max(0, screen.getAllDisplays().findIndex((display) => display.id === near));
      const shot = await deps.capture.screenshot({ display: index }, 'jpeg');
      const thumb = electron.nativeImage.createFromBuffer(Buffer.from(shot.data)).resize({ height: 64 }).toDataURL();
      return { data: shot.data, mime: shot.mime, thumb };
    },
    load: () => { try { return JSON.parse(readFileSync(deps.file, 'utf8')) as FloatPlace; } catch { return null; } },
    save: (place) => writeFileSync(deps.file, JSON.stringify(place)),
    open: deps.open,
    primaryArea: () => screen.getPrimaryDisplay().workArea,
    log: deps.log,
  });
}
