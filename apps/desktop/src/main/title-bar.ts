// Native caption geometry and colors of the app window. Windows/Linux: the window-controls
// overlay (minimize/maximize/close) fills the UI's 48 px header row – in the column layout and in a
// compact window (phone stack), whose top bar is a row of the same height and color (mobile.css) –
// painted in that row's color. macOS traffic lights are centered in that same row. CSS reserves
// the native controls' left and right edges, without adding a strip above the content.
// Feedback 16.11.2026 (F13: "alles dunkel, bis auf oben … die Minus und so weiter"): while a modal dialog's backdrop
// dims the window (the page says so, IPC titleBarDim), the controls take the dimmed colors – the row's color and the
// glyphs' gray under --backdrop, fixed values a unit test keeps equal to tokens.css.
// Owns: overlay/traffic-light options per theme, layout and dimming. Never: imports electron, creates
// windows (window.ts does), defines UI colors (styles/tokens.css is the source; a unit test
// keeps both equal).

import { TITLE_BAR_HEIGHT } from '../shared/api/desktop.ts';
import type { TitleBarLayout } from '../shared/api/desktop.ts';

/** Traffic lights are 14 px tall; x matches the rail's left padding. */
const TRAFFIC_LIGHT_SIZE = 14;
const TRAFFIC_LIGHT_X = 14;

export interface TitleBarColors { color: string; symbolColor: string }

/** Overlay color = the header row's color (--chrome per theme); glyphs in the header icons' gray
 *  (--text at the icons' 70 % opacity over --chrome). */
export function titleBarColors(dark: boolean): TitleBarColors {
  return dark ? { color: '#202020', symbolColor: '#afafaf' } : { color: '#f3f3f3', symbolColor: '#5b5c5f' };
}

/** The same colors under a modal's backdrop (--backdrop over them: #0005 light, #0009 dark), so the controls dim
 *  with the rest of the window. */
export function dimmedColors(dark: boolean): TitleBarColors {
  return dark ? { color: '#0d0d0d', symbolColor: '#464646' } : { color: '#a2a2a2', symbolColor: '#3d3d3f' };
}

/** The overlay ends one pixel above its row's end: Windows rounds the overlay up at fractional
 *  scale factors (48 px at 150 % covered 73 device rows), which would hide the sheet's top edge
 *  line (the first pixel row below the header row) under the caption buttons. The half-pixel
 *  shift of the glyphs' center is not visible. Both layouts share the row height: the compact
 *  window's top bar carries the controls itself instead of a strip above it (23.10.2026). */
export function overlayHeight(_layout: TitleBarLayout): number {
  return TITLE_BAR_HEIGHT - 1;
}

/** BrowserWindow.titleBarOverlay / setTitleBarOverlay options for Windows and Linux. */
export function titleBarOverlay(dark: boolean, layout: TitleBarLayout = 'columns', dim = false): TitleBarColors & { height: number } {
  return { ...(dim ? dimmedColors(dark) : titleBarColors(dark)), height: overlayHeight(layout) };
}

/** macOS traffic lights, vertically centered in the shared header row. */
export function trafficLightPosition(): { x: number; y: number } {
  return { x: TRAFFIC_LIGHT_X, y: Math.round((TITLE_BAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2) };
}
