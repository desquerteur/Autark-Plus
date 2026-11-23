// B-055 Q4 – the header feedback cell's press (ui/feedback/press.ts PressTracker): pointer down is
// reported first (the screenshot starts before anything opens), a release before HOLD_MS is a tap,
// holding HOLD_MS or longer is talk (start on the hold, end on release, discarded on cancel),
// without dictation every press is a tap, Enter/Space is a tap that took no screenshot yet.
// Feedback 16.11.2026 (F15): the shortcut Ctrl+Shift+F (Cmd on macOS) – main's FeedbackKey passes its going down and up
// (repeats swallowed, a release only after its press), KeyPress drives the same tracker: short = tap, held = talk.
// Owns: these assertions only. Never: real timers, a DOM or a microphone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_MS, KeyPress, PressTracker } from '../../../src/ui/feedback/press.ts';
import type { Schedule } from '../../../src/ui/feedback/press.ts';
import { HOLD_MS as MIC_HOLD_MS } from '../../../src/ui/feedback/bridge.ts';
import { FEEDBACK_COMBO, FeedbackKey, pageKey } from '../../../src/shared/api/workspace-browser-keys.ts';
import type { KeyInput } from '../../../src/shared/api/workspace-browser-keys.ts';

/** A tracker with a fake clock: `advance(ms)` fires the armed hold timer when it is due. */
function setup(canHold = true) {
  const log: string[] = [];
  let now = 0;
  let due: { at: number; run: () => void } | null = null;
  const schedule: Schedule = (run, ms) => {
    const entry = { at: now + ms, run };
    due = entry;
    return () => { if (due === entry) due = null; };
  };
  const tracker = new PressTracker({
    press: () => log.push('press'),
    tap: (source) => log.push(`tap ${source}`),
    holdStart: () => log.push('hold start'),
    holdEnd: () => log.push('hold end'),
    holdCancel: () => log.push('hold cancel'),
  }, { canHold: () => canHold, schedule });
  const advance = (ms: number) => {
    now += ms;
    const entry = due;
    if (entry && entry.at <= now) { due = null; entry.run(); }
  };
  return { tracker, log, advance, armed: () => due !== null };
}

test('one hold threshold for the cell and the mic button: 300 ms', () => {
  assert.equal(HOLD_MS, 300);
  assert.equal(MIC_HOLD_MS, HOLD_MS);
});

test('pointer down reports the press first; a release before HOLD_MS is a tap from the pointer', () => {
  const s = setup();
  s.tracker.down();
  assert.deepEqual(s.log, ['press'], 'the screenshot can start before anything opens');
  assert.equal(s.tracker.phase, 'down');
  s.advance(HOLD_MS - 1);
  s.tracker.up();
  assert.deepEqual(s.log, ['press', 'tap pointer']);
  assert.equal(s.tracker.phase, 'idle');
  assert.equal(s.armed(), false, 'the hold timer is disarmed');
  s.advance(1000);
  assert.deepEqual(s.log, ['press', 'tap pointer'], 'no late hold');
});

test('holding HOLD_MS is talk: it starts when recognized and ends on release – a second click toggles again', () => {
  const s = setup();
  s.tracker.down();
  s.advance(HOLD_MS);
  assert.deepEqual(s.log, ['press', 'hold start']);
  assert.equal(s.tracker.phase, 'holding');
  s.advance(4000);
  s.tracker.up();
  assert.deepEqual(s.log, ['press', 'hold start', 'hold end']);
  s.tracker.down(); s.advance(80); s.tracker.up();
  assert.deepEqual(s.log.slice(-2), ['press', 'tap pointer']);
});

test('a cancelled pointer discards a talk and ignores a pending press; Escape is the same cancel', () => {
  const s = setup();
  s.tracker.down(); s.advance(100); s.tracker.cancel();
  assert.deepEqual(s.log, ['press'], 'a pending press does nothing');
  s.advance(HOLD_MS);
  assert.deepEqual(s.log, ['press'], 'no hold after the cancel');
  s.tracker.down(); s.advance(HOLD_MS); s.tracker.cancel();
  assert.deepEqual(s.log, ['press', 'press', 'hold start', 'hold cancel']);
  s.tracker.up();
  assert.deepEqual(s.log.at(-1), 'hold cancel', 'the release after a cancel is nothing');
});

test('without dictation every press is a tap, however long', () => {
  const s = setup(false);
  s.tracker.down();
  assert.equal(s.armed(), false);
  s.advance(5000);
  s.tracker.up();
  assert.deepEqual(s.log, ['press', 'tap pointer']);
});

test('Enter/Space is a tap that took no screenshot yet; a key during a press and a second pointer are ignored', () => {
  const s = setup();
  s.tracker.key();
  assert.deepEqual(s.log, ['tap key']);
  s.tracker.down();
  s.tracker.key();
  s.tracker.down(); // a second finger
  s.tracker.up();
  assert.deepEqual(s.log, ['tap key', 'press', 'tap pointer']);
});

/** A key event as Electron's before-input-event gives it. */
const input = (type: 'keyDown' | 'keyUp', key: string, mods: Partial<KeyInput> = {}): KeyInput =>
  ({ type, key, control: false, meta: false, shift: false, alt: false, code: `Key${key.toUpperCase()}`, ...mods });

test('the shortcut in main: Ctrl+Shift+F goes down once, its repeats are swallowed, only its own release goes up', () => {
  const key = new FeedbackKey();
  const combo = { control: true, shift: true };
  assert.equal(key.step(input('keyUp', 'f'), false), undefined, 'an F typed in a field: its release is the page\'s');
  assert.equal(key.step(input('keyDown', 'F', combo), false), 'down');
  assert.equal(key.step(input('keyDown', 'F', { ...combo, isAutoRepeat: true }), false), 'swallow', 'a held key repeats: no second press');
  assert.equal(key.step(input('keyUp', 'Control'), false), undefined, 'the modifiers are not the release');
  assert.equal(key.step(input('keyUp', 'f'), false), 'up', 'the F goes up, whichever modifier went first');
  assert.equal(key.step(input('keyUp', 'f'), false), undefined, 'one release per press');
  // a release lost to another window: the next press is simply a press again
  assert.equal(key.step(input('keyDown', 'f', combo), false), 'down');
  assert.equal(key.step(input('keyDown', 'f', combo), false), 'down');
  // not the shortcut
  for (const mods of [{ control: true }, { shift: true }, { control: true, shift: true, alt: true }, { meta: true, shift: true }]) {
    assert.equal(new FeedbackKey().step(input('keyDown', 'f', mods), false), undefined, JSON.stringify(mods));
  }
  assert.equal(new FeedbackKey().step(input('keyDown', 'g', combo), false), undefined);
  // macOS: Cmd+Shift+F; Ctrl there is no shortcut
  assert.equal(new FeedbackKey().step(input('keyDown', 'f', { meta: true, shift: true }), true), 'down');
  assert.equal(new FeedbackKey().step(input('keyDown', 'f', combo), true), undefined);
  // a Cyrillic layout: the key in F's place; a Latin letter elsewhere on the F key (Dvorak's U) is not F
  assert.equal(new FeedbackKey().step({ ...input('keyDown', 'а', combo), code: 'KeyF' }, false), 'down');
  assert.equal(new FeedbackKey().step({ ...input('keyDown', 'u', combo), code: 'KeyF' }, false), undefined);
  assert.equal(FEEDBACK_COMBO, 'mod+shift+f');
});

test('the browser shortcuts leave Ctrl+Shift+F free (a site never gets it: main hands it to the app)', () => {
  assert.equal(pageKey(input('keyDown', 'F', { control: true, shift: true }), false, false), undefined);
  assert.equal(pageKey(input('keyDown', 'f', { meta: true, shift: true }), true, false), undefined);
  assert.deepEqual(pageKey(input('keyDown', 'f', { control: true }), false, false), { app: 'find' }, 'Ctrl+F stays find');
});

test('the shortcut is the cell\'s press: short is a tap, held HOLD_MS is talk; a pointer press keeps its own', () => {
  const s = setup();
  const key = new KeyPress(s.tracker);
  key.down(); s.advance(120); key.up();
  assert.deepEqual(s.log, ['press', 'tap pointer'], 'the press froze the window first, the tap opens');
  key.down(); s.advance(HOLD_MS); s.advance(2000); key.up();
  assert.deepEqual(s.log.slice(2), ['press', 'hold start', 'hold end'], 'held: talk, the release ends it');
  key.up();
  assert.equal(s.log.length, 5, 'a release without its press is nothing');
  // a pointer press runs: the key neither starts nor ends it
  s.tracker.down();
  key.down(); key.up();
  assert.deepEqual(s.log.slice(5), ['press']);
  s.tracker.up();
  assert.deepEqual(s.log.slice(5), ['press', 'tap pointer']);
});

test('a lost release: the next press or the window losing the keyboard releases the held key', () => {
  const s = setup();
  const key = new KeyPress(s.tracker);
  key.down(); s.advance(HOLD_MS);
  key.blur();
  assert.deepEqual(s.log, ['press', 'hold start', 'hold end'], 'blur: the talk ends with its words');
  key.down();
  key.down(); // its release went to another window
  assert.deepEqual(s.log.slice(3), ['press', 'tap pointer', 'press'], 'released, then pressed again');
  key.up();
  assert.equal(s.tracker.phase, 'idle');
});
