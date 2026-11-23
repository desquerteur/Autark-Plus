// 16.11.2026 – the restart pause (runtime/compose/restart-pause.ts, system.prepareRestart): a pause stops agent work; a
// cancel or the end of RESTART_PAUSE_MS without a restart starts it again and answers the install record; a second pause
// re-arms the timer; a cancel without a pause only answers the record; each pause logs its start, and a shutdown
// (close, compose/lifecycle.ts) ends the timer so nothing starts agent work again.
// Owns: these assertions only. Never: a real dispatcher, timer waits longer than a few milliseconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { RESTART_PAUSE_MS, RestartPause } from '../../../src/runtime/compose/restart-pause.ts';

function rig(ms?: number) {
  const calls: string[] = [];
  const pause = new RestartPause({
    stop: async () => { calls.push('stop'); },
    start: () => { calls.push('start'); },
    dropped: () => { calls.push('dropped'); },
    log: (message) => { calls.push(`log:${message}`); },
    ms,
  });
  return { pause, calls };
}

const STARTED = 'log:restart pause started: agent work stops for the restart, back by itself if none follows';

test('a pause no restart follows ends by itself: work starts again and the install record is answered', async () => {
  const { pause, calls } = rig(20);
  await pause.pause();
  assert.equal(pause.active, true);
  assert.deepEqual(calls, [STARTED, 'stop'], 'the pause says in the log when it starts');
  await sleep(60);
  assert.equal(pause.active, false);
  assert.deepEqual(calls, [STARTED, 'stop', 'dropped', 'start', 'log:restart pause ended: no restart came, agent work resumed']);
});

test('a cancel ends the pause at once and the timer does nothing later', async () => {
  const { pause, calls } = rig(30);
  await pause.pause();
  pause.end('cancel');
  assert.equal(pause.active, false);
  await sleep(60);
  assert.deepEqual(calls, [STARTED, 'stop', 'dropped', 'start', 'log:restart pause cancelled, agent work resumed']);
});

test('a shutdown during a pause ends its timer: nothing starts agent work again, later calls do nothing', async () => {
  const { pause, calls } = rig(20);
  await pause.pause();
  pause.close();
  assert.equal(pause.active, false);
  await sleep(60);
  assert.deepEqual(calls, [STARTED, 'stop'], 'the timer ran out after the close and did nothing');
  pause.end('cancel');
  await pause.pause();
  await sleep(40);
  assert.deepEqual(calls, [STARTED, 'stop'], 'a cancel or a pause during the stop leaves the stopping dispatcher alone');
});

test('a cancel without a pause only answers the install record', () => {
  const { pause, calls } = rig(30);
  pause.end('cancel');
  assert.deepEqual(calls, ['dropped']);
});

test('a second pause re-arms the timer from its own start', async () => {
  const { pause, calls } = rig(40);
  await pause.pause();
  await sleep(25);
  await pause.pause();
  await sleep(25);
  assert.equal(pause.active, true, 'still paused 50 ms after the first pause: the second one counts');
  await sleep(40);
  assert.equal(pause.active, false);
  assert.deepEqual(calls.filter((call) => call === 'start'), ['start'], 'started once');
});

test('the default lets an updater stop the runtime long before the pause ends', () => {
  assert.ok(RESTART_PAUSE_MS >= 60_000 && RESTART_PAUSE_MS <= 5 * 60_000);
});
