// One element step of computer use (computer.act through ComputerService.act, split from
// service.ts in B-055): the observed identity as a hard precondition, the person's priority for
// pointer steps (a refused click runs as the element's own pattern action where that is the same
// step – quiet-actions.ts; B-055: also while another agent holds the pointer lease), the lease for
// clicks, focus and window moves, the pointer's travel to a clicked element (Q9: the helper bends
// the planned path onto the element's clickable point), the window memory note, and act-and-verify.
// B-080 (live 06./07.11.: 11 of 13 FAILED verifications were states Chromium/WebView2 apps showed a moment later):
// `expect` travels to the helper, which re-reads every 100 ms until the expected state shows, at most VERIFY_MS
// (without expect: one read after settleMs); a read-back with no control type and no name is a removed element (gone);
// a window that `expect.window` names is looked for in the window list within what is left of the same VERIFY_MS.
// A window step (window_close/minimize/maximize/restore) takes the window id alone.
// Owns: the element action shapes, which actions need the pointer or the lease, and the checks of
// `expect`. Never: retries a step, acts without the observed name and role of its ref, or acts
// with another agent's refs (each agent has its own table, service.ts).

import { WorkforceError } from '../../shared/errors.ts';
import type { MotionStyle } from '../../shared/model/pointer-motion.ts';
import type { HelperClient } from './helper.ts';
import { finite } from './geometry.ts';
import { parseNodes, renderTree, type RefTable, type RefTarget, type UiNode } from './tree.ts';
import { pointerOrQuiet } from './quiet-actions.ts';
import type { ComputerCaller, PointerLease } from './lease.ts';
import type { WindowMemory } from './window-memory.ts';
import { motionStyle, type PointerInput } from './pointer-input.ts';
import { clickPath, type PlannedPath } from './motion.ts';

export type ElementAction =
  | 'invoke' | 'set_value' | 'toggle' | 'expand' | 'collapse' | 'select' | 'scroll_into_view' | 'scroll' | 'focus'
  | 'click' | 'double_click' | 'right_click' | 'window_close' | 'window_minimize' | 'window_maximize' | 'window_restore';

export interface ActExpectation { value?: string; toggle?: 'on' | 'off'; expanded?: boolean; selected?: boolean; gone?: boolean; window?: string }

/** `action`: the step that ran; `note` says when it is not the one asked for (quiet-actions.ts); `shared`: another agent worked in that window lately. */
export interface ActResult { action: ElementAction; target: string; after?: string; exists: boolean; verified?: boolean; checks: string[]; foreground?: string; note?: string; shared?: string }

export interface ActInput {
  ref?: string; window?: number; name?: string; automationId?: string; role?: string; action: ElementAction; value?: string; expect?: ActExpectation; settleMs?: number;
  caller?: ComputerCaller; motion?: MotionStyle; signal?: AbortSignal;
}

/** Element steps that move the pointer or the keyboard focus: gated by the person's presence (quiet swap where possible). */
export const POINTER_ACTIONS: ReadonlySet<ElementAction> = new Set<ElementAction>(['click', 'double_click', 'right_click', 'focus']);
/** Element steps that need the pointer lease: those, and moving or closing windows (they change what the holder's pointer and keys reach). */
export const LEASED_ACTIONS: ReadonlySet<ElementAction> = new Set<ElementAction>([...POINTER_ACTIONS, 'window_close', 'window_minimize', 'window_maximize', 'window_restore']);
const CLICKS: ReadonlySet<ElementAction> = new Set<ElementAction>(['click', 'double_click', 'right_click']);
/** How long the expected state may take to show after the step (the helper's re-read and the window list together). */
export const VERIFY_MS = 2000;
const WINDOW_STEP_MS = 100;

export interface ElementActDeps {
  helper: () => HelperClient;
  input: PointerInput;
  lease: PointerLease;
  windows: WindowMemory;
  /** The caller's own ref table. */
  refs: (caller: ComputerCaller | undefined) => RefTable;
  /** The open windows (expect.window). */
  listWindows: (signal?: AbortSignal) => Promise<Array<{ title: string }>>;
}

/** `waitedMs`: how long the helper re-read for `expect`. */
type ActAnswer = { element?: unknown; exists?: boolean; foreground?: { title?: string }; at?: unknown; waitedMs?: unknown };

export async function elementAct(deps: ElementActDeps, input: ActInput): Promise<ActResult> {
  const refs = deps.refs(input.caller);
  const style = motionStyle(input.motion);
  let target: RefTarget | undefined;
  if (input.ref) {
    target = refs.get(input.ref);
    if (!target) throw new WorkforceError('not_found', `Unknown ref "${input.ref}". Observe again with computer.ui_tree and use a ref from that output.`);
  } else if (!input.name && !input.automationId && !(input.action.startsWith('window_') && input.window !== undefined)) {
    throw new WorkforceError('bad_request', 'This step needs a ref from computer.ui_tree, or a name/automationId with window; a window step takes the window id alone.');
  }
  if (LEASED_ACTIONS.has(input.action) && !POINTER_ACTIONS.has(input.action)) deps.lease.check(input.caller);
  const { action, note } = POINTER_ACTIONS.has(input.action) ? await pointerOrQuiet(input.action, target, () => deps.input.elementGate(input.caller)) : { action: input.action, note: undefined };
  const settleMs = Math.min(3000, Math.max(0, Math.round(finite(input.settleMs ?? 250, 'settleMs'))));
  const hwnd = target?.hwnd ?? input.window ?? 0;
  const planned = CLICKS.has(action) && style !== 'instant' && target?.rect ? await clickPlan(deps.input, action, target.rect, style) : undefined;
  const args = {
    hwnd: target?.hwnd ?? input.window,
    rid: target?.rid,
    name: target ? undefined : input.name,
    aid: target ? undefined : input.automationId,
    role: target ? undefined : input.role?.toLowerCase(),
    // Hard precondition (checked before acting): the element still has the observed name and role.
    expectName: target?.name,
    expectRole: target?.role,
    action,
    value: input.value,
    settleMs,
    ...(input.expect ? { expect: input.expect } : {}),
    ...(planned ? { path: planned.args } : {}),
  };
  const end = LEASED_ACTIONS.has(action) ? deps.lease.begin(input.caller, hwnd || undefined) : () => undefined;
  let result: ActAnswer;
  try {
    if (planned && CLICKS.has(action)) deps.input.reportClick(input.caller, undefined, target?.rect, planned.path); // B-081: the drawn AI cursor travels with the move
    result = await deps.helper().call<ActAnswer>('act', args, { timeoutMs: 30_000 + VERIFY_MS + (planned?.ms ?? 0), signal: input.signal });
  } catch (error) {
    throw deps.input.humanRefusal(error);
  } finally {
    if (POINTER_ACTIONS.has(action)) deps.input.noteInjected();
    end();
  }
  if (CLICKS.has(action)) deps.input.reportClick(input.caller, result?.at, target?.rect, undefined); // B-081: the path went before the move; here where it arrived
  const shared = deps.windows.use(input.caller, hwnd || undefined);
  const read = parseNodes(result?.element ? [{ ...(result.element as object), d: 0, p: -1 }] : [])[0];
  // A removed element can read back as a dead node (no control type, no name): it is gone (an older helper sends it).
  const dead = read !== undefined && read.role === 'unknown' && !read.name;
  const after = dead ? undefined : read;
  const exists = result?.exists !== false && !dead;
  const label = target ? `${target.role} "${target.name}"` : (input.name ?? input.automationId) ? `${input.role ?? 'element'} "${input.name ?? input.automationId}"` : `window ${input.window}`;
  const waited = typeof result?.waitedMs === 'number' && Number.isFinite(result.waitedMs) ? result.waitedMs : 0;
  const { verified, checks } = input.expect
    ? await verify(input.expect, exists, after, () => deps.listWindows(input.signal), Math.max(0, VERIFY_MS - waited), input.signal)
    : { verified: undefined, checks: [] };
  return {
    action,
    ...(note ? { note } : {}),
    ...(shared ? { shared } : {}),
    target: label,
    after: after ? renderTree([after], hwnd, refs).text : undefined,
    exists,
    verified,
    checks,
    foreground: result?.foreground?.title,
  };
}

/** The path of an element click: from the pointer to the centre of the element's observed rectangle. */
async function clickPlan(input: PointerInput, action: ElementAction, rect: [number, number, number, number], style: MotionStyle): Promise<PlannedPath> {
  const centre = { x: Math.round(rect[0] + rect[2] / 2), y: Math.round(rect[1] + rect[3] / 2) };
  const from = await input.cursor();
  return clickPath(from, centre, style, { button: action === 'right_click' ? 'right' : 'left', count: action === 'double_click' ? 2 : 1, targetSize: Math.max(4, Math.min(rect[2], rect[3])) });
}

/** The postconditions of `expect` against the element's state after the step; `expect.window` is looked for within `leftMs`. */
async function verify(
  expect: ActExpectation, exists: boolean, after: UiNode | undefined, windows: () => Promise<Array<{ title: string }>>, leftMs: number, signal?: AbortSignal,
): Promise<{ verified: boolean; checks: string[] }> {
  let verified = true;
  const checks: string[] = [];
  const check = (ok: boolean, text: string) => { checks.push(`${ok ? 'ok' : 'FAILED'}: ${text}`); if (!ok) verified = false; };
  if (expect.gone !== undefined) check(expect.gone === !exists, expect.gone ? 'element is gone' : 'element still exists');
  if (expect.value !== undefined) check(exists && String(after?.value ?? '') === expect.value, `value is "${expect.value}" (now "${after?.value ?? ''}")`);
  if (expect.toggle !== undefined) check(after?.toggle === expect.toggle, `toggle is ${expect.toggle} (now ${after?.toggle ?? 'unknown'})`);
  if (expect.expanded !== undefined) check((after?.expand === 'expanded') === expect.expanded, `element is ${expect.expanded ? 'expanded' : 'collapsed'} (now ${after?.expand ?? 'unknown'})`);
  if (expect.selected !== undefined) check(Boolean(after?.selected) === expect.selected, `element is ${expect.selected ? '' : 'not '}selected`);
  if (expect.window !== undefined) check(await windowShows(expect.window.toLowerCase(), windows, leftMs, signal), `a window "${expect.window}" is open`);
  return { verified, checks };
}

/** Is a window whose title contains `wanted` open – re-listed every WINDOW_STEP_MS until it shows, at most `leftMs`? */
async function windowShows(wanted: string, windows: () => Promise<Array<{ title: string }>>, leftMs: number, signal?: AbortSignal): Promise<boolean> {
  const until = Date.now() + leftMs;
  for (;;) {
    const list = await windows().catch(() => []);
    if (list.some((window) => window.title.toLowerCase().includes(wanted))) return true;
    if (Date.now() + WINDOW_STEP_MS > until || signal?.aborted) return false;
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, WINDOW_STEP_MS); (timer as { unref?: () => void }).unref?.(); });
  }
}
