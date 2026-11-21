// B-081: the viewer's picture box on this PC's side tabs (src/runtime/browser/side-view.ts, shared/model/side-view.ts) on a
// manual clock and a fake host: side.pull's `view` is whole px clamped to 200–4096 and survives the hop to a linked PC;
// a caller's first or changed box renews the cast at once with it (past RENEW_MS), every later renewal names it again,
// and another caller's unchanged box never switches it, so a PC and a phone watching at once do not flip the page; when
// the caller whose box the page has stops watching, the box set last of those still watching takes over at once (none
// left: a renewal without a box, so the page gets its own size back).
// Owns: these assertions only. Never: real timers, Electron or a socket.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RENEW_MS, SideViews, sideCaller, sidePullOf } from '../../../src/runtime/browser/side-view.ts';
import { PULL_GRACE_MS, type PullTimers } from '../../../src/runtime/browser/view-pull.ts';
import { SIDE_VIEW_MAX, SIDE_VIEW_MIN, clampView, refusesView, sameView, type SideViewSize } from '../../../src/shared/model/side-view.ts';

const A = 'web-aaaa';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const code = (error: unknown) => (error as { code?: string }).code;

function rig() {
  let now = 10_000;
  const set: Array<{ fn: () => void; ms: number }> = [];
  const timers: PullTimers = { now: () => now, set: (fn, ms) => { set.push({ fn, ms }); return 0; }, clear: () => {} };
  const casts: Array<{ tab: string; on: boolean; view?: SideViewSize }> = [];
  const host = {
    cast: async (args: { tab: string; on: boolean; view?: SideViewSize }) => { casts.push(args); return { ok: true as const, page: { url: 'https://a.example/', title: 'A', back: false, forward: false, loading: false } }; },
    input: async () => ({ ok: true as const }),
    nav: async () => ({ ok: true as const }),
  };
  const views = new SideViews({ host: () => host, pc: () => 'office-pc', timers });
  const pull = (who: string, view?: SideViewSize, via?: string) => {
    void views.pull(sideCaller(who, via), { tab: A, waitMs: 1000, ...(view ? { view } : {}) }, AbortSignal.abort());
  };
  /** One pull that returned; the call ends its watch (its PULL_GRACE_MS went by). */
  const held = async (who: string, view?: SideViewSize) => {
    const from = set.length;
    await views.pull(sideCaller(who), { tab: A, waitMs: 1000, ...(view ? { view } : {}) }, AbortSignal.abort());
    const release = set.slice(from).find((timer) => timer.ms === PULL_GRACE_MS)!;
    return () => release.fn();
  };
  return { casts, pull, held, advance: (ms: number) => { now += ms; }, views: () => casts.filter((c) => c.on).map((c) => c.view) };
}

test('view: whole px clamped to SIDE_VIEW_MIN … SIDE_VIEW_MAX; only width and height; it survives the hop to a linked PC', () => {
  assert.deepEqual([SIDE_VIEW_MIN, SIDE_VIEW_MAX], [200, 4096]);
  assert.deepEqual(clampView(420.4, 859.6), { width: 420, height: 860 });
  assert.deepEqual(clampView(12, 99_999), { width: 200, height: 4096 });
  assert.deepEqual(clampView(Number.NaN, 300), { width: 200, height: 300 });
  assert.equal(sameView({ width: 1, height: 2 }, { width: 1, height: 2 }), true);
  assert.equal(sameView(undefined, undefined), false, 'no box is never the same box');
  assert.deepEqual(sidePullOf({ tab: A, view: { width: 420.7, height: 100 } }).request.view, { width: 421, height: 200 });
  assert.equal(sidePullOf({ tab: A }).request.view, undefined);
  assert.equal(sidePullOf({ tab: A, view: null }).request.view, undefined);
  for (const bad of [{ width: 420 }, { width: 420, height: 860, depth: 1 }, { width: '420', height: 860 }, 'wide', [420, 860]]) {
    assert.throws(() => sidePullOf({ tab: A, view: bad }), (error: unknown) => code(error) === 'bad_request', JSON.stringify(bad));
  }
  // The viewer's PC passes the checked request on (rpc/handlers/side-view.ts: {...request, maxBytes, via}); the tab's PC checks it again.
  const here = sidePullOf({ tab: A, view: { width: 420, height: 860 }, device: 'dev_a' }, ['device']).request;
  assert.deepEqual(sidePullOf({ ...here, maxBytes: 1024 * 1024, via: 'owner' }, ['via']).request.view, { width: 420, height: 860 });
});

test('a caller\'s first or changed box renews the cast at once with it; later renewals name it again; no box names none', async () => {
  const r = rig();
  r.pull('owner');
  assert.deepEqual(r.casts, [{ tab: A, on: true }], 'a viewer without a box: the page keeps its own size');
  r.pull('owner', { width: 420, height: 860 });
  assert.deepEqual(r.views(), [undefined, { width: 420, height: 860 }], 'a new box: at once, inside RENEW_MS');
  r.pull('owner', { width: 420, height: 860 });
  assert.equal(r.casts.length, 2, 'the same box: no renewal before RENEW_MS');
  r.pull('owner', { width: 500, height: 860 });
  assert.deepEqual(r.views().at(-1), { width: 500, height: 860 }, 'a changed box: at once');
  r.advance(RENEW_MS);
  r.pull('owner');
  assert.deepEqual(r.views().at(-1), { width: 500, height: 860 }, 'a later renewal names the box the page has');
  await tick();
});

test('another caller\'s unchanged box never switches it: the one that opened or resized last sets the size', async () => {
  const r = rig();
  r.pull('owner', { width: 420, height: 860 });
  r.pull('dev_phone', { width: 390, height: 700 });
  assert.deepEqual(r.views(), [{ width: 420, height: 860 }, { width: 390, height: 700 }], 'the phone opened last');
  r.advance(RENEW_MS);
  r.pull('owner', { width: 420, height: 860 });
  assert.deepEqual(r.views().at(-1), { width: 390, height: 700 }, 'the PC\'s unchanged box does not take it back');
  r.pull('dev_phone', { width: 390, height: 700 });
  assert.equal(r.casts.length, 3, 'nor does the phone\'s');
  r.pull('owner', { width: 640, height: 860 });
  assert.deepEqual(r.views().at(-1), { width: 640, height: 860 }, 'the PC resized: its box now');
  r.pull('dev_b', { width: 390, height: 700 }, 'owner');
  assert.deepEqual(r.views().at(-1), { width: 390, height: 700 }, 'a linked PC\'s owner is a caller of its own');
  await tick();
});

test('the caller whose box the page has stops watching: the box set last of those still watching at once, none left – no box', async () => {
  const r = rig();
  const pc = await r.held('owner', { width: 1200, height: 800 });
  const phone = [await r.held('dev_phone', { width: 390, height: 700 }), await r.held('dev_phone', { width: 390, height: 700 })];
  assert.deepEqual(r.views(), [{ width: 1200, height: 800 }, { width: 390, height: 700 }], 'the phone opened last');
  phone[0]!();
  assert.equal(r.casts.length, 2, 'one of the phone\'s watches ended, another holds it: its box stays');
  phone[1]!();
  assert.deepEqual(r.casts.at(-1), { tab: A, on: true, view: { width: 1200, height: 800 } }, 'the phone left: the PC\'s own box again, inside RENEW_MS');
  const other = await r.held('dev_b'); // a watcher that names no box
  pc();
  assert.deepEqual(r.casts.at(-1), { tab: A, on: true }, 'no box left: a renewal without one (main gives the page its own size)');
  assert.equal(r.casts.length, 4);
  other();
  assert.deepEqual(r.casts.at(-1), { tab: A, on: false }, 'the last watch ended: the cast goes off, without a renewal before');
  assert.equal(r.casts.length, 5);
  await tick();
});

test('an older PC\'s refusal of `view` reads as such (it is asked again without one); other refusals do not', () => {
  const old = { code: 'bad_request', message: 'Invalid parameter "params.view": expected one of tab, after, maxBytes, waitMs, via.', data: { details: { param: 'params.view' } } };
  assert.equal(refusesView(old), true, 'as the UI gets it (RpcError data)');
  assert.equal(refusesView({ code: 'bad_request', message: old.message, details: { param: 'params.view' } }), true, 'as a WorkforceError');
  assert.equal(refusesView({ code: 'bad_request', message: old.message }), true, 'without details: its message');
  assert.equal(refusesView({ ...old, code: 'unavailable' }), false);
  assert.equal(refusesView({ code: 'bad_request', message: 'Invalid parameter "params.view": …', data: { details: { param: 'tab' } } }), false, 'another param');
  assert.equal(refusesView({ code: 'bad_request', message: 'Invalid parameter "view.width": expected a number.' }), false, 'a bad box is no old PC');
  assert.equal(refusesView(undefined), false);
  assert.equal(refusesView(new Error('x')), false);
});
