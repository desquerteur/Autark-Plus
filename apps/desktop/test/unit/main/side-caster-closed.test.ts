// Feedback 17.11.2026 (Nora, "Uncaught Exception: TypeError: Object has been destroyed at pass … Timeout._onTimeout"):
// a window the person or an agent closes while a watched frame waits for its CAST_FRAME_GAP_MS slot. The timer then reads
// the zoom of a page that is gone – Electron throws and its default dialog stays in front of the shared screen. The cast
// ends with its page instead: nothing is sent, nothing throws, the page's release runs once.
// Owns: these assertions only. Never: Electron, real pages or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAST_FRAME_GAP_MS, SideCaster } from '../../../src/main/side-driver/caster.ts';
import { SideTab } from '../../../src/main/side-driver/tab.ts';
import type { SideCastUpdate } from '../../../src/shared/model/side-view.ts';
import { FakeContents } from './side-driver-fakes.ts';

const TAB = 'web-1234';
const GONE = () => { throw new TypeError('Object has been destroyed'); };

function manual() {
  const clock = { now: 50_000 };
  let seq = 0;
  const pending = new Map<number, { fn: () => void; at: number }>();
  return {
    clock,
    set: (fn: () => void, ms: number) => { const id = ++seq; pending.set(id, { fn, at: clock.now + ms }); return id; },
    clear: (id: unknown) => { pending.delete(id as number); },
    waiting: () => pending.size,
    advance(ms: number) {
      const end = clock.now + ms;
      for (;;) {
        const next = [...pending].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        clock.now = next[1].at;
        pending.delete(next[0]);
        next[1].fn();
      }
      clock.now = end;
    },
  };
}

async function rig() {
  const timers = manual();
  const contents = new FakeContents(timers.clock);
  const tab = new SideTab(TAB, contents, { now: () => timers.clock.now, person: () => {} });
  const updates: SideCastUpdate[] = [];
  const released: string[] = [];
  const caster = new SideCaster({
    tab: (id) => (id === TAB ? tab : undefined), release: (id) => { released.push(id); }, send: (update) => { updates.push(update); },
    now: () => timers.clock.now, setTimer: timers.set, clearTimer: timers.clear,
  });
  await caster.cast({ tab: TAB, on: true });
  const frame = (sessionId: number) => contents.debugger.emit('Page.screencastFrame', { sessionId, data: 'AAAA', metadata: { deviceWidth: 1280, deviceHeight: 800, offsetTop: 0, pageScaleFactor: 1 } });
  return { timers, contents, caster, updates, released, frame };
}

test('the window closes while a frame waits for its slot: the timer ends the cast, nothing throws, nothing more is sent', async () => {
  const r = await rig();
  r.frame(1); // goes at once
  r.frame(2); // waits for its slot
  const sent = r.updates.filter((update) => update.frame).length;
  assert.equal(sent, 1);
  r.contents.destroyed = true; // the window is closed: every read of the page throws
  r.contents.getZoomFactor = GONE;
  r.contents.getURL = GONE;
  r.contents.getTitle = GONE;
  assert.doesNotThrow(() => r.timers.advance(CAST_FRAME_GAP_MS + 10));
  assert.equal(r.updates.filter((update) => update.frame).length, sent, 'the waiting frame has nobody to go to');
  assert.equal(r.caster.watched(TAB), false, 'the cast ended with its page');
  assert.deepEqual(r.released, [TAB], 'its page is let go once');
  assert.equal(r.timers.waiting(), 0, 'no timer is left behind');
});

test('the page is read as gone only inside the read (isDestroyed still false): the frame ends the cast just the same', async () => {
  const r = await rig();
  r.frame(1);
  r.frame(2);
  r.contents.getZoomFactor = GONE; // the race: closed between the check and the read
  assert.doesNotThrow(() => r.timers.advance(CAST_FRAME_GAP_MS + 10));
  assert.equal(r.caster.watched(TAB), false);
});

test('a frame from a page that is already gone ends the cast at once, not at the next slot', async () => {
  const r = await rig();
  r.contents.destroyed = true;
  r.contents.getZoomFactor = GONE;
  assert.doesNotThrow(() => r.frame(1));
  assert.equal(r.caster.watched(TAB), false);
  assert.equal(r.updates.filter((update) => update.frame).length, 0);
});

test('a cast of a page that stays open is not touched: the waiting frame goes at its slot', async () => {
  const r = await rig();
  r.frame(1);
  r.frame(2);
  r.timers.advance(CAST_FRAME_GAP_MS + 10);
  assert.equal(r.updates.filter((update) => update.frame).length, 2);
  assert.equal(r.caster.watched(TAB), true);
});
