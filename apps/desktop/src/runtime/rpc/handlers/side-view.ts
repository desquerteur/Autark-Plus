// RPC handlers: a side-browser tab watched from another PC or from the phone (B-076; shared/model/side-view.ts).
// side.pull / side.pullPart (one state or frame at a time, large frames in parts), side.input (the person's mouse,
// wheel, key and text input; never logged or returned) and side.nav (address, back, forward, reload, the answer to the
// page's dialog). Without `device`, or with this PC's own id, they serve this PC's tabs (runtime/browser/side-view.ts);
// with another PC's id they go there over the link (devices.call → runtime/devices/side-view.ts, CEO links only), the
// caller passed on as `via`.
// The owner and the owner's phones on a secure transport reach them, like browser.pull.
// 16.11.2026 (the owner's phone reaches every setting): side.open opens a page in a new tab of this PC's pane (global),
// shown at once (host op sideBrowser 'open', main/side-driver) – a sign-in that returns to this PC's own address (Google
// Calendar, an app's OAuth) runs there and the phone watches and touches it in its pane; 'manage' on a secure transport,
// like the pane's tabs and files. The tab names the person as its opener (HUMAN_ID).
// Owns: param checks and the choice of PC. Never: casts, maps input or decides who may watch on the other PC.

import { HUMAN_ID } from '../../../shared/ids.ts';
import { GLOBAL_SPACE, browserUrl } from '../../../shared/api/workspace-browser.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import type { SideBrowserResult } from '../../../shared/model/side-browser.ts';
import { SIDE_PART_BYTES, type SidePull } from '../../../shared/model/side-view.ts';
import { inputOf } from '../../browser/input-wire.ts';
import { sideCaller, sideNavOf, sidePartOf, sidePullOf, sideTab, sideViewOf } from '../../browser/side-view.ts';
import { OWNER_CALLER } from '../../browser/view-pull.ts';
import { bad, input, onlyKeys, optId, text, type Obj } from '../params.ts';
import type { HandlerContext, HandlerTable } from '../table.ts';

/** The owner, and a device holding 'todo' on a secure transport (a phone of the owner). */
const DEVICE = { capability: 'todo', secure: true } as const;
/** side.open: the owner, and the owner's phone holding 'manage' on a secure transport (the pane's tabs and files are its). */
const PANE = { capability: 'manage', secure: true } as const;
/** side.open's answer when this PC has no pane to open it in. */
export const PANE_MISSING = "The PC's browser pane is not available – it lives in Autark's window on the PC.";

/** Opens `url` in a new tab of this PC's global pane, shown at once; its tab id. */
async function openInPane(ctx: HandlerContext, url: string): Promise<string | undefined> {
  const host = ctx.services.host;
  if (!host.sideBrowser) throw new WorkforceError('unavailable', PANE_MISSING);
  let result: SideBrowserResult;
  try {
    result = await host.sideBrowser({ action: 'open', url, newTab: true, show: true, space: GLOBAL_SPACE, agent: { id: HUMAN_ID, name: 'You' } });
  } catch (error) {
    if (error instanceof WorkforceError && error.code === 'unavailable') throw new WorkforceError('unavailable', PANE_MISSING);
    throw error;
  }
  if (!result?.ok) throw new WorkforceError('unavailable', result?.error?.slice(0, 400) || PANE_MISSING);
  return result.tab;
}

/** The caller here: the owner, or the device's own id. */
const callerOf = (ctx: HandlerContext): string => (ctx.scope.kind === 'device' ? ctx.scope.deviceId : OWNER_CALLER);

/** The linked PC a call goes to; undefined = this PC (no device, or this PC's own id). */
export function remoteOf(o: Obj, ctx: Pick<HandlerContext, 'services'>): string | undefined {
  const device = optId(o, 'device');
  if (!device) return undefined;
  let self = '';
  try { self = ctx.services.devices.self().id; } catch { self = ''; }
  return device === self ? undefined : device;
}

/** A linked PC's pull reply, as far as the UI relies on it. */
function pullReply(value: unknown): SidePull {
  const reply = value as Partial<SidePull> | null;
  if (!reply || typeof reply !== 'object' || !reply.state || typeof reply.state.at !== 'number' || typeof reply.state.tab !== 'string') {
    throw new WorkforceError('unavailable', 'The other PC sent no picture of this tab.');
  }
  return reply as SidePull;
}

export function register(table: HandlerTable): void {
  table.add('side.pull', async (params, ctx) => {
    const { o, request } = sidePullOf(params, ['device']);
    const device = remoteOf(o, ctx);
    if (!device) return sideViewOf(ctx.services).pull(sideCaller(callerOf(ctx)), request, ctx.signal);
    const maxBytes = Math.min(request.maxBytes ?? SIDE_PART_BYTES, SIDE_PART_BYTES);
    return pullReply(await ctx.services.devices.call(device, 'side.pull', { ...request, maxBytes, via: callerOf(ctx) }, ctx.signal));
  }, DEVICE);

  table.add('side.pullPart', async (params, ctx) => {
    const { o, tab, at, index } = sidePartOf(params, ['device']);
    const device = remoteOf(o, ctx);
    if (!device) return sideViewOf(ctx.services).part(sideCaller(callerOf(ctx)).caller, tab, at, index);
    const reply = await ctx.services.devices.call(device, 'side.pullPart', { tab, at, index, via: callerOf(ctx) }, ctx.signal) as { data?: unknown } | null;
    if (typeof reply?.data !== 'string') throw new WorkforceError('not_found', 'That picture is gone. Look again.');
    return { data: reply.data };
  }, DEVICE);

  table.add('side.input', async (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['device', 'tab', 'input']);
    const tab = sideTab(o);
    const event = inputOf(o.input);
    const device = remoteOf(o, ctx);
    if (device) await ctx.services.devices.call(device, 'side.input', { tab, input: event }, ctx.signal);
    else await sideViewOf(ctx.services).input(tab, event);
    return { ok: true as const };
  }, DEVICE);

  table.add('side.nav', async (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['device', 'tab', 'url', 'action', 'dialog']);
    const tab = sideTab(o);
    const nav = sideNavOf(o);
    const device = remoteOf(o, ctx);
    if (device) await ctx.services.devices.call(device, 'side.nav', { tab, ...nav }, ctx.signal);
    else await sideViewOf(ctx.services).nav(tab, nav);
    return { ok: true as const };
  }, DEVICE);

  table.add('side.open', async (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['url']);
    let url: string;
    try { url = new URL(browserUrl(text(o, 'url', { max: 4000 }))).href; } catch (error) {
      if (error instanceof WorkforceError) throw error;
      bad('url', 'an http(s) address without credentials');
    }
    const tab = await openInPane(ctx, url);
    return { ok: true as const, ...(tab ? { tab } : {}) };
  }, PANE);
}
