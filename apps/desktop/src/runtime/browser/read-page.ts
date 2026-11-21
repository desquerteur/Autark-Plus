// B-080 (live: 33 HTTP 403 bot checks and 3 YouTube 429s on web.fetch, none read another way): reading one page in the
// agent's own browser – a new tab, its text, the tab closed again. web.fetch (tools/builtin/web.ts) uses it when a site
// turned the direct fetch away as a bot; it is set where the BrowserService is made (devices/connect.ts), so it works in
// every mode, and is absent without one (tests, a runtime without a browser).
// The read leaves the browser as it found it: the tab it opened goes – also when the navigation failed after the tab was
// made (BrowserService.open then names no tab: every tab that was not there before goes) – and the tab that was active
// before is active again, so the agent's next browser step without a tab lands where it worked.
// Owns: that read. Never: hides that it is automated, solves a check, or keeps the tab open after the read.

import type { BrowserService } from './service.ts';
import type { UseContext } from './takeover.ts';

/** What reading one page in my own browser gave: its text, where it ended and whether it still shows a human check. */
export interface BrowserPage { text: string; truncated: boolean; url: string; title: string; humanCheck: boolean }

/** Reads `url` in the agent's own browser (throws like the browser tools: the person's takeover, a navigation error). */
export type BrowserRead = (agentId: string, url: string, options?: { maxChars?: number; use?: UseContext }) => Promise<BrowserPage>;

declare module '../contracts.ts' {
  interface RuntimeServices {
    /** B-080: one page read in the agent's own browser (browser/read-page.ts); absent without a browser. */
    browserRead?: BrowserRead;
  }
}

type Browser = Pick<BrowserService, 'open' | 'extract' | 'tabs'>;

/** The read through `browser`: the tabs before → open a new tab → its text → close that tab, the active one back. */
export function browserReader(browser: Browser): BrowserRead {
  return async (agentId, url, options = {}) => {
    const before = (await browser.tabs(agentId, { use: options.use })).tabs;
    let tab: string | undefined;
    try {
      const state = await browser.open(agentId, { url, newTab: true, use: options.use });
      tab = state.tab;
      const page = await browser.extract(agentId, { tab: state.tab, maxChars: options.maxChars, use: options.use });
      return { text: page.text, truncated: page.truncated, url: page.url, title: page.title, humanCheck: state.humanCheck === true };
    } finally {
      await restore(browser, agentId, before, tab);
    }
  };
}

/** Closes the read's tab (or, when open failed, every tab that was not there before) and activates the one active before. */
async function restore(browser: Browser, agentId: string, before: Awaited<ReturnType<Browser['tabs']>>['tabs'], tab: string | undefined): Promise<void> {
  const known = new Set(before.map((info) => info.tab));
  const made = tab ? [tab] : (await browser.tabs(agentId).catch(() => ({ tabs: [] }))).tabs.map((info) => info.tab).filter((id) => !known.has(id));
  for (const id of made) await browser.tabs(agentId, { close: id }).catch(() => undefined);
  const active = before.find((info) => info.active)?.tab;
  if (active) await browser.tabs(agentId, { activate: active }).catch(() => undefined); // gone meanwhile: nothing to bring back
}
