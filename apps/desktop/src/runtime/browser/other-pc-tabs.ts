// browser.tabs' lines for a space's websites on the person's other PCs (18.11.2026, owner: "the AI can always see each
// human's tabs"). <data>/side-tabs.json holds every linked PC's websites of each space as 'remote' panels (devices/sync/
// tabs.ts keeps the spaces the same on the owner's PCs): the global pane is the owner's on every PC, a chat's area is
// what everyone in that chat sees. A line names the PC, the address and the title; the page runs there, not here.
// Owns: those lines. Never: opens, closes or reads such a page.

import type { RuntimeServices } from '../contracts.ts';
import { DevicesRepo } from '../devices/repo.ts';
import { readSideTabs, sideTabsFile } from '../root/side-tabs.ts';
import { keptAddress } from '../../shared/api/workspace-browser.ts';

/** The lines (a heading first) for `space`'s websites on other PCs; none when there are none. */
export function otherPcTabs(s: Pick<RuntimeServices, 'db' | 'paths'>, space: string): string[] {
  let tabs;
  try { tabs = (readSideTabs(sideTabsFile(s.paths.data)) ?? {})[space]?.tabs ?? []; } catch { return []; }
  const remote = tabs.filter((tab) => tab.panel === 'remote' && typeof tab.device === 'string' && typeof tab.url === 'string');
  if (!remote.length) return [];
  const repo = new DevicesRepo(s.db);
  const name = (id: string) => repo.get(id)?.name ?? 'another PC';
  return ['Open on the person\'s other PCs (they run there; I see them, I work in the tabs above):',
    ...remote.map((tab) => `- on ${name(tab.device!)} · ${keptAddress(String(tab.url)) ?? '(an address I do not show)'}${typeof tab.title === 'string' && tab.title ? ` · "${tab.title}"` : ''}`)];
}
