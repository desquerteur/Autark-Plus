// The side driver's two outside parts (moved out of driver.ts, B-081): the workspace browser's surface for the driver
// (main/workspace-browser.ts has these methods) and what the driver is given (main/desktop.ts).
// Owns: these shapes. Never: behaviour or electron imports.

import type { PageOpener } from '../../shared/api/workspace-browser.ts';
import type { PickedElement } from '../../shared/model/page-pick.ts';
import type { PointerActor, PointerPoint } from '../../shared/model/pointers.ts';
import type { ContentsLike } from './cdp.ts';

/** The workspace browser's surface for the driver (main/workspace-browser.ts). */
export interface SideTabsLike {
  /** Every tab with its space. `active`: the tab the person looks at in `space` now (its slot's tab); `last`: the one side-tabs.json names for it. */
  sideTabs(space?: string): { pages: Array<{ id: string; url: string; title: string; space?: string; opener?: PageOpener }>; active: string | null; last?: string | null };
  /** The tab's page (a restored tab loads); undefined when it cannot be reached. `watcher`: the person watching it from elsewhere wakes it, no agent uses it. */
  sideContents(id: string, watcher?: boolean): ContentsLike | undefined;
  /** Opens a page in `space` (in the background unless `show`) with its opener – in the agent's preview tab there unless `newTab`; returns its id. */
  sideOpen(url: string, opener: PageOpener, show?: boolean, space?: string, newTab?: boolean): string;
  sideKeep?(id: string): void; // the person used the tab (a click or a key in it): an agent's preview stays as a tab of its own
  /** Closes a tab. */
  sideClose(id: string): void;
  /** B-081: a pin from the tab's picker for the app window, or null: the picker ended there. */
  sidePicked?(id: string, pick: PickedElement | null): void;
}

export interface SideDriverDeps {
  browser(): SideTabsLike | null;
  /** A pointer for the runtime's hub (best effort). */
  pointer?(point: Omit<PointerPoint, 'at'>): void;
  /** The person at this PC as a pointer actor. */
  person?(): PointerActor;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}
