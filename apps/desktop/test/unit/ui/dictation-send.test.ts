// AF-017 (desquerteur/Autark-Plus#18) – dictate and send (src/ui/chat/composer/dictation-send.ts, controls.ts,
// MicButton.tsx talkPress, settings preferences.dictationSend): what follows a take, the countdown, the push-to-talk
// key, the send cell during a take, a held mic sending on release, and the setting's validation.
// Owns: these assertions only. Never: records, transcribes or renders (the take is faked through voice.ts's signals).

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { afterTake, cancelCountdown, countdowns, isTalkKey, secondsLeft, startCountdown } from '../../../src/ui/chat/composer/dictation-send.ts';
import { composerControls } from '../../../src/ui/chat/composer/controls.ts';
import { PressTracker } from '../../../src/ui/feedback/press.ts';
import { SECTIONS } from '../../../src/runtime/settings/schema.ts';

test('after a take: ✓ follows the preference, ➤ and a released hold always send', () => {
  assert.equal(afterTake('done', undefined), 'keep');
  assert.equal(afterTake('done', 'off'), 'keep');
  assert.equal(afterTake('done', 'on'), 'send');
  assert.equal(afterTake('done', 'countdown'), 'countdown');
  assert.equal(afterTake('send', 'off'), 'send');
  assert.equal(afterTake('release', 'off'), 'send');
});

test('the countdown sends after 2 s unless cancelled; one per chat', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let sent = 0;
    startCountdown('ch_c', () => sent++, 2000, 1000);
    assert.equal(secondsLeft(countdowns.value.get('ch_c')!, 1000), 2);
    mock.timers.tick(1999);
    assert.equal(sent, 0);
    mock.timers.tick(1);
    assert.equal(sent, 1);
    assert.equal(countdowns.value.has('ch_c'), false);
    startCountdown('ch_c', () => sent++);
    startCountdown('ch_c', () => sent++); // a second take restarts it, never two
    assert.equal(cancelCountdown('ch_c'), true);
    mock.timers.tick(5000);
    assert.equal(sent, 1, 'a cancelled countdown sends nothing');
    assert.equal(cancelCountdown('ch_c'), false);
  } finally {
    mock.timers.reset();
  }
});

test('push-to-talk key: Ctrl+Shift+Space (Cmd on a Mac), nothing else', () => {
  const event = (patch: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) =>
    ({ key: ' ', code: 'Space', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...patch });
  assert.equal(isTalkKey(event({ ctrlKey: true, shiftKey: true }), false), true);
  assert.equal(isTalkKey(event({ metaKey: true, shiftKey: true }), true), true);
  assert.equal(isTalkKey(event({ ctrlKey: true }), false), false);
  assert.equal(isTalkKey(event({ ctrlKey: true, shiftKey: true, altKey: true }), false), false);
  assert.equal(isTalkKey(event({ ctrlKey: true, shiftKey: true, key: 'a', code: 'KeyA' }), false), false);
});

test('during a take the send cell is ➤ even in an empty field – also while an agent works; not while transcribing', () => {
  assert.deepEqual(composerControls({ hasContent: false, transcribing: false, dictating: true }), { primary: 'send' });
  assert.deepEqual(composerControls({ hasContent: false, transcribing: false, working: true, dictating: true }), { primary: 'send' }, 'not Stop: ➤ sends the take');
  assert.deepEqual(composerControls({ hasContent: false, transcribing: true, dictating: true }), { primary: 'send-disabled' });
});

test('a held mic talks, and the release sends; a short press is a tap', () => {
  const log: string[] = [];
  let fire: (() => void) | null = null;
  const tracker = new PressTracker({
    press: () => log.push('press'), tap: () => log.push('tap'),
    holdStart: () => log.push('start'), holdEnd: () => log.push('send'), holdCancel: () => log.push('discard'),
  }, { canHold: () => true, schedule: (run) => { fire = run; return () => { fire = null; }; } });
  tracker.down(); fire!(); tracker.up();
  assert.deepEqual(log, ['press', 'start', 'send']);
  log.length = 0;
  tracker.down(); tracker.up();
  assert.deepEqual(log, ['press', 'tap']);
  log.length = 0;
  tracker.down(); fire!(); tracker.cancel();
  assert.deepEqual(log, ['press', 'start', 'discard'], 'Esc or a lost pointer discards a held take');
});

test('settings.json: preferences.dictationSend is off, on or countdown (default off)', () => {
  const key = SECTIONS.find((section) => section.key === 'preferences')!.keys.find((entry) => entry.key === 'dictationSend');
  assert.ok(key, 'the setting is described for the AI');
  assert.deepEqual((key as { options?: readonly string[] }).options, ['off', 'on', 'countdown']);
  assert.equal((key as { default?: unknown }).default, 'off');
});
