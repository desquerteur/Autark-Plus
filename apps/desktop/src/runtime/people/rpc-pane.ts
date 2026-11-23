// What a person's device may call, part 5: the tabs shared with them (owner 18.11.2026: people who are not in the same
// profile share tabs when they want the other one to see them). A tab is shared by being in a chat's area – the space
// 'chat:<id>' of <data>/side-tabs.json, "shared by everyone in that chat". tabs.get returns the websites of the areas
// of the chats the person reads (access.ts chatAccess), as the owner's phone sees them ('remote' panels naming the PC
// they run on); tabs.changed reaches them in the same form (events.ts, sharedPane). side.pull / side.pullPart /
// side.input / side.nav serve only such a tab: a person looks at it and works in it like the owner's phone does (they
// are trusted colleagues); the work itself is the owner's handlers (rpc/handlers/side-view.ts sideHandlers).
// Owns: which tabs are a person's and these variants. Never: the owner's other spaces, their files or app panels.

import type { PaneTabs } from '../../shared/api/methods-tabs.ts';
import { chatSpace, type SideSpaces } from '../../shared/api/workspace-browser.ts';
import { WorkforceError } from '../../shared/errors.ts';
import type { RuntimeServices } from '../contracts.ts';
import { paneTabs } from '../devices/sync/tabs.ts';
import { sideTab } from '../browser/side-view.ts';
import { remoteOf, sideHandlers } from '../rpc/handlers/side-view.ts';
import { input } from '../rpc/params.ts';
import type { HandlerContext, HandlerTable } from '../rpc/table.ts';
import { chatAccess } from './access.ts';
import { caller } from './rpc-base.ts';

type Services = Pick<RuntimeServices, 'db' | 'chats'>;

/** `pane` (the PC's spaces as its phone sees them) as person `personId` sees it: the websites of their chats' areas. */
export function sharedPane(s: Services, personId: string, pane: PaneTabs): PaneTabs {
  const spaces: SideSpaces = {};
  for (const [key, space] of Object.entries(pane.spaces)) {
    const match = /^chat:(.+)$/.exec(key);
    const chat = match ? s.chats.get(match[1]) : undefined;
    if (!chat || !chatAccess(s.db, personId, chat)) continue;
    const tabs = space.tabs.filter((tab) => tab.panel === 'remote');
    if (!tabs.length) continue;
    spaces[chatSpace(chat.id)] = { ...(space.shown !== undefined && tabs.some((tab) => tab.id === space.shown) ? { shown: space.shown } : {}), tabs };
  }
  return { device: pane.device, spaces };
}

/** Throws 'not found' unless the call's tab (on its `device`, else this PC) is shared with the person. */
function sharedTab(params: unknown, ctx: HandlerContext): void {
  const person = caller(ctx);
  const o = input(params);
  const tab = sideTab(o);
  const pane = sharedPane(ctx.services, person.id, paneTabs(ctx.services));
  const device = remoteOf(o, ctx) ?? pane.device;
  const shared = Object.values(pane.spaces).some((space) => space.tabs.some((entry) => entry.tab === tab && entry.device === device));
  if (!shared) throw new WorkforceError('not_found', 'That tab is not shared with you.', { details: { tab } });
}

export function registerPersonPane(table: HandlerTable): void {
  table.addPerson('tabs.get', (_params, ctx) => sharedPane(ctx.services, caller(ctx).id, paneTabs(ctx.services)));
  for (const [method, handler] of Object.entries(sideHandlers)) {
    table.addPerson(method as keyof typeof sideHandlers, (async (params: unknown, ctx: HandlerContext) => {
      sharedTab(params, ctx);
      return handler(params, ctx);
    }) as never);
  }
}
