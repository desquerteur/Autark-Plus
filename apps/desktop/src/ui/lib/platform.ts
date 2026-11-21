// Platform detection for the one UI bundle: Electron desktop window or PWA in a browser/phone.
// Also exposes the preload bridge `window.workforce` typed exactly as its contract
// (WorkforceDesktopApi, src/shared/api/desktop.ts).
// Owns: platform/os facts, the isMobile signal and the bridge handle.
// Never: talks RPC or touches app state – callers decide what to do with these facts; never
// declares bridge members the preload does not implement.

import { signal } from '@preact/signals';
import type { WorkforceDesktopApi } from '../../shared/api/desktop.ts';

declare global {
  interface Window {
    workforce?: WorkforceDesktopApi;
  }
}

export type PlatformKind = 'desktop' | 'pwa';
export type OsKind = 'windows' | 'mac' | 'linux' | 'other';

const page: Window | undefined = typeof window === 'undefined' ? undefined : window;
const desktop = Boolean(page?.workforce && typeof page.workforce.connect === 'function');

function detectOs(): OsKind {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const hint = (page?.workforce?.platform ?? (nav as { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform ?? nav?.platform ?? '').toLowerCase();
  if (hint.startsWith('win')) return 'windows';
  if (hint.startsWith('mac') || hint === 'darwin') return 'mac';
  if (hint.includes('linux')) return 'linux';
  return 'other';
}

export const platform: PlatformKind = desktop ? 'desktop' : 'pwa';
export const os: OsKind = detectOs();
/** The desktop bridge (desktop window only; undefined in the PWA). */
export const bridge: WorkforceDesktopApi | undefined = desktop ? page?.workforce : undefined;

/**
 * Phone layout (bottom tabs + stack navigation): narrow windows and the PWA on touch devices.
 * A PWA opened in a wide desktop browser keeps the desktop layout.
 */
export const isMobile = signal(false);

/** The web app on a touch screen (a phone or tablet): it takes the phone's scale (#30). */
export const isTouchApp = (): boolean => platform === 'pwa' && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * #30: how much <html> is zoomed (the app's scale times a theme's text size; lib/appearance.ts sets it). A window is
 * narrow when the room it has at that zoom is under 720 px – a PC window at 150 % gets the phone layout below 1080 px,
 * as an unscaled one does below 720.
 */
export const layoutZoom = signal(1);

/** How much <html> is zoomed now (Chromium's currentCSSZoom; else what lib/appearance.ts set). */
export function pageZoom(): number {
  const own = typeof document === 'undefined' ? undefined : (document.documentElement as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
  return typeof own === 'number' && own > 0 ? own : layoutZoom.peek() || 1;
}

/**
 * #30: window pixels → the pixels a style on a zoomed page means. getBoundingClientRect, clientX/Y and innerWidth are
 * window pixels; `left: 100px` inside the zoomed <html> lands at 100 × zoom. Everything placed at a measured point
 * (menus, popovers, lists, the spotlight) writes its numbers through this.
 */
export function unzoom(px: number): number {
  return px / pageZoom();
}

export function watchLayout(): void {
  const coarse = matchMedia('(pointer: coarse)');
  const update = () => {
    const narrow = window.innerWidth / (layoutZoom.peek() || 1) < 720;
    const next = narrow || (platform === 'pwa' && coarse.matches);
    if (isMobile.peek() !== next) isMobile.value = next;
  };
  update();
  window.addEventListener('resize', update);
  coarse.addEventListener('change', update);
  layoutZoom.subscribe(update);
}

/** Opens a link outside the app (system browser on desktop, a new tab elsewhere). */
export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url) && !url.startsWith('mailto:')) return;
  const api = bridge;
  if (api) {
    // Main refuses some links (and may be gone during a restart): never an unhandled rejection.
    Promise.resolve().then(() => api.openExternal(url)).catch((error: unknown) => { console.warn('[workforce] the link could not be opened', error); });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export const modKey = os === 'mac' ? '⌘' : 'Ctrl+';
