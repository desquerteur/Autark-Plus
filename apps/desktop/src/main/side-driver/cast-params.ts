// The checks of the three host ops of a watched side tab (B-076, caster.ts: sideCast / sideInput / sideNav) and the page
// as the watcher sees it named. Moved out of caster.ts in B-081, which adds the watcher's picture box (`view`).
// Owns: these checks and pageOf. Never: runs a DevTools command or keeps anything.

import { browserUrl } from '../../shared/api/workspace-browser.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { SIDE_VIEW_MAX, SIDE_VIEW_MIN, type SideCommand, type SideDialog, type SidePage, type SideViewSize } from '../../shared/model/side-view.ts';
import { TAB_ID } from './validate.ts';

/** The only DevTools commands a watcher's input becomes. */
export const CAST_INPUT_METHODS: ReadonlySet<string> = new Set(['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText']);
const MAX_COMMANDS = 8;
const MAX_PARAMS = 8192;
const NO_PAGE: SidePage = { url: '', title: '', back: false, forward: false, loading: false };

/** The part of a tab's WebContents a cast reads (navigationHistory: Electron's, missing in fakes). */
export interface CastContents {
  isDestroyed(): boolean;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  getZoomFactor?(): number;
  readonly navigationHistory?: { canGoBack(): boolean; canGoForward(): boolean };
}

export function bad(what: string): never {
  throw new WorkforceError('bad_request', `Invalid side view request (${what}).`);
}

export function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(what);
  return value as Record<string, unknown>;
}

export function tabOf(o: Record<string, unknown>): string {
  if (typeof o.tab !== 'string' || !TAB_ID.test(o.tab)) bad('tab');
  return o.tab;
}

/** sideCast's `view`: none, or whole CSS px within SIDE_VIEW_MIN … SIDE_VIEW_MAX on either side (the runtime clamped it). */
export function castView(value: unknown): SideViewSize | undefined {
  if (value === undefined || value === null) return undefined;
  const o = record(value, 'view');
  const side = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= SIDE_VIEW_MIN && n <= SIDE_VIEW_MAX;
  if (!side(o.width) || !side(o.height) || Object.keys(o).length !== 2) bad('view');
  return { width: o.width as number, height: o.height as number };
}

/** sideInput's commands: 1–8, each one of the three Input methods with plain params of at most 8 KB. */
export function castCommands(value: unknown): SideCommand[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COMMANDS) bad('commands');
  return value.map((item) => {
    const command = record(item, 'command');
    if (typeof command.method !== 'string' || !CAST_INPUT_METHODS.has(command.method)) bad('method');
    const params = record(command.params, 'params');
    if (JSON.stringify(params).length > MAX_PARAMS) bad('params');
    return { method: command.method, params };
  });
}

/** sideNav: exactly one of an http(s) address (made absolute like the address field does), back / forward / reload, or the dialog's answer. */
export function castNav(value: unknown): { tab: string; url?: string; action?: 'back' | 'forward' | 'reload'; dialog?: 'accept' | 'dismiss' } {
  const o = record(value, 'nav');
  const tab = tabOf(o);
  const given = (key: string) => o[key] !== undefined && o[key] !== null;
  const hasUrl = given('url');
  if ([hasUrl, given('action'), given('dialog')].filter(Boolean).length !== 1) bad('url, action or dialog');
  if (given('dialog')) {
    if (o.dialog !== 'accept' && o.dialog !== 'dismiss') bad('dialog');
    return { tab, dialog: o.dialog };
  }
  if (hasUrl) {
    if (typeof o.url !== 'string') bad('url');
    try { return { tab, url: new URL(browserUrl(o.url)).href }; } catch (error) {
      throw new WorkforceError('bad_request', error instanceof Error ? error.message : 'Use an HTTP or HTTPS address.');
    }
  }
  if (o.action !== 'back' && o.action !== 'forward' && o.action !== 'reload') bad('action');
  return { tab, action: o.action };
}

export const finite = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** The page as the watcher sees it named, with its open dialog. */
export function pageOf(contents: CastContents, dialog?: SideDialog): SidePage {
  if (contents.isDestroyed()) return NO_PAGE;
  const history = contents.navigationHistory;
  return {
    url: contents.getURL(), title: contents.getTitle(), back: Boolean(history?.canGoBack()), forward: Boolean(history?.canGoForward()), loading: contents.isLoading(),
    ...(dialog ? { dialog: { type: dialog.type, message: dialog.message } } : {}),
  };
}

/** A press that makes the tab the person's own (a click, a key, typed text) – moves and wheel turns do not. */
export const isPress = (command: SideCommand): boolean => command.method === 'Input.insertText'
  || (command.method === 'Input.dispatchMouseEvent' && command.params.type === 'mousePressed')
  || (command.method === 'Input.dispatchKeyEvent' && command.params.type !== 'keyUp');

/** The end of a press (a button let go, a key up, typed text): after it the page may change its size without moving the press. */
export const endsPress = (command: SideCommand): boolean => command.method === 'Input.insertText'
  || (command.method === 'Input.dispatchMouseEvent' && command.params.type === 'mouseReleased')
  || (command.method === 'Input.dispatchKeyEvent' && command.params.type === 'keyUp');

/**
 * B-081: a frame whose picture does not have its metadata's shape – the one frame right after the page took a watcher's box
 * (or gave it back) still holds the old size – is not passed on, so a viewer never draws it squeezed. Reads the JPEG's
 * own size from its header (the first few hundred bytes of the base64); a picture it cannot read passes.
 */
export function frameFits(data: string, meta: Record<string, unknown>): boolean {
  const width = Number(meta.deviceWidth), height = Number(meta.deviceHeight);
  if (!(width > 0 && height > 0)) return true;
  const bytes = Buffer.from(data.slice(0, 4096), 'base64');
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) return true;
    const marker = bytes[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xc3) {
      const h = bytes.readUInt16BE(i + 5), w = bytes.readUInt16BE(i + 7);
      return !(w > 0 && h > 0) || Math.abs(w / h - width / height) <= 0.04 * (width / height);
    }
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return true;
}
