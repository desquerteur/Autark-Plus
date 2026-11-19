// A side-browser tab's page while it lives. A page that closes itself (window.close(), e.g. a confirmation link such as
// Stripe's) leaves `view.webContents` undefined or destroyed; asking it `isDestroyed()` threw "Cannot read properties of
// undefined (reading 'isDestroyed')" in every list, every save and the quit (18.11.2026: the side browser dead from 12:24, an
// update that could not end the app). Owns: that one check. Never: closing, saving or listing tabs.
import type { WebContents } from 'electron';

export interface TabWithPage { view?: { webContents?: WebContents } }

export function livePage(tab: TabWithPage | undefined): WebContents | undefined {
  const contents = tab?.view?.webContents;
  return contents && !contents.isDestroyed() ? contents : undefined;
}
