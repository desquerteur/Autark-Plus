// The link-ups between linked PCs (devices/sync/service.ts linkUps, B-087): the rows, secrets and every plan's login go
// – and have arrived – before the wakes that wait for that PC, the settings and files (the long file rescan) after
// them; one link-up per PC at a time; an 'online' during one (a link swap) ends it before its next step and runs it
// again at once, from the same cursor (during its last step: after it, from the cursor it moved – its wakes go once more
// on the new link right away); a run whose link is
// gone ends before its next step, the cursor where it was, so the next link-up still owes it all. Fake parts, a manual
// clock – no network.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '../../../src/runtime/contracts.ts';
import { linkUps, type LinkUpParts } from '../../../src/runtime/devices/sync/service.ts';
import { ManualClock } from './fakes.ts';

const START = 1_000_000;
const FULL = ['roster', 'tabs', 'rows', 'secrets', 'logins', 'wakes', 'files'];

function fixture() {
  const clock = new ManualClock(START);
  const steps: string[] = [];
  const sinces: Array<number | undefined> = []; // the cursor each run's rows went from
  const holds = new Set<string>();
  const waiting = new Map<string, () => void>();
  const fails = new Map<string, false | Error>();
  const cursors = new Map<string, number>();
  const linked = new Set(['dev_b', 'dev_c']);
  const logs: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const note = (message: string, data?: Record<string, unknown>) => { logs.push({ message, data }); };
  const log: Logger = { debug() {}, info: note, warn: note, error: note };
  const step = (name: string) => async (peer: string, since?: number): Promise<boolean> => {
    const key = `${name}:${peer}`;
    steps.push(key);
    if (name === 'rows') sinces.push(since);
    if (holds.has(key)) await new Promise<void>((resolve) => waiting.set(key, resolve));
    const fail = fails.get(key);
    if (fail instanceof Error) throw fail;
    return fail !== false;
  };
  const parts: LinkUpParts = {
    roster: { linkUp: async (peer) => { await step('roster')(peer); } },
    tabs: { catchUp: step('tabs') },
    rows: { catchUp: step('rows'), resume: (peer) => { steps.push(`wakes:${peer}`); } },
    secrets: { catchUp: step('secrets') },
    logins: { catchUp: step('logins') },
    files: { catchUp: step('files') },
  };
  const stamps = { cursor: (peer: string) => cursors.get(peer), setCursor: (peer: string, at: number) => { cursors.set(peer, at); } };
  const run = linkUps({ clock, log }, stamps, parts, (peer) => linked.has(peer));
  return {
    clock, steps, sinces, holds, fails, cursors, linked, logs, run,
    release: (key: string) => { holds.delete(key); waiting.get(key)?.(); waiting.delete(key); },
    /** The steps of `peer` (its wakes too: only its own link-up releases them). */
    of: (peer: string) => steps.filter((entry) => entry.endsWith(`:${peer}`)).map((entry) => entry.split(':')[0]),
    said: (message: string) => logs.filter((entry) => entry.message === message).map((entry) => entry.data),
  };
}

// A timer round first: a swap during the last step releases the wakes again on a 0 ms timer.
const idle = async () => { await new Promise((resolve) => setTimeout(resolve, 5)); for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };

test('B-087: the rows, secrets and every plan\'s login go before the waiting wakes; the settings and files after them', async () => {
  const f = fixture();
  f.run('dev_b');
  await idle();
  assert.deepEqual(f.steps.map((entry) => entry.split(':')[0]), FULL, 'a woken turn on the other PC finds its login and key there');
  assert.equal(f.cursors.get('dev_b'), START, 'a complete link-up moves the cursor to its start');
  assert.deepEqual(f.said('linked PC caught up'), [{ peer: 'dev_b', first: true, complete: true }]);
});

test('B-087: one link-up per PC at a time; an online during it (a link swap) runs it once more after it, from the moved cursor', async () => {
  const f = fixture();
  f.holds.add('files:dev_b');
  f.run('dev_b');
  await idle();
  f.clock.advance(5_000);
  f.run('dev_b'); // the swap: the old link closed, the new one came up while the files still went
  f.run('dev_b'); // and once more
  f.run('dev_c'); // another PC runs beside it
  await idle();
  assert.deepEqual(f.of('dev_b'), [...FULL, 'wakes'], 'no second run while the first one runs – only its wakes go once more on the new link (the swap may have cut their hand-over)');
  assert.deepEqual(f.of('dev_c'), FULL, 'each PC has its own, its wakes too');

  f.release('files:dev_b');
  await idle();
  assert.deepEqual(f.of('dev_b'), [...FULL, 'wakes', ...FULL], 'exactly one more run, not one per online');
  assert.deepEqual(f.sinces, [undefined, undefined, START], 'the second run starts from the cursor the first one moved');
  assert.equal(f.cursors.get('dev_b'), START + 5_000);
  assert.deepEqual(f.said('linked PC caught up').filter((data) => data?.peer === 'dev_b'), [
    { peer: 'dev_b', first: true, complete: true },
    { peer: 'dev_b', first: false, complete: true },
  ]);
});

test('B-087: a link swap during an earlier step ends that run at its next step; the rerun starts at once, from the same cursor', async () => {
  const f = fixture();
  f.holds.add('tabs:dev_b');
  f.run('dev_b');
  await idle();
  f.clock.advance(5_000);
  f.run('dev_b'); // the swap cut the side pane in flight
  f.release('tabs:dev_b');
  await idle();
  assert.deepEqual(f.of('dev_b'), ['roster', 'tabs', ...FULL], 'what the swap cut goes again now, not after the rows, wakes and file rescan');
  assert.deepEqual(f.sinces, [undefined], 'the cut run moved no cursor');
  assert.equal(f.cursors.get('dev_b'), START + 5_000);
  assert.deepEqual(f.said('link-up again after a link swap'), [{ peer: 'dev_b' }]);
  assert.deepEqual(f.said('linked PC caught up'), [{ peer: 'dev_b', first: true, complete: true }]);
});

test('B-087: the wakes wait until the secrets and the logins have arrived, not just started', async () => {
  for (const held of ['secrets:dev_b', 'logins:dev_b']) {
    const f = fixture();
    f.holds.add(held);
    f.run('dev_b');
    await idle();
    assert.ok(!f.steps.includes('wakes:dev_b'), `no wake leaves while ${held} is on its way`);
    f.release(held);
    await idle();
    assert.deepEqual(f.steps.map((entry) => entry.split(':')[0]), FULL, `the wakes go once ${held} has arrived`);
  }
});

test('B-087: a run whose link is gone ends before its next step, the cursor where it was; the next link-up owes it all', async () => {
  const f = fixture();
  f.cursors.set('dev_b', 100); // an earlier link-up
  f.holds.add('rows:dev_b');
  f.run('dev_b');
  await idle();
  f.run('dev_b'); // the link came up once more ...
  f.linked.delete('dev_b'); // ... and went again while the rows went
  f.fails.set('rows:dev_b', false);
  f.release('rows:dev_b');
  await idle();
  assert.deepEqual(f.steps, ['roster:dev_b', 'tabs:dev_b', 'rows:dev_b'], 'no secrets, logins, wakes or files are dialed for');
  assert.equal(f.cursors.get('dev_b'), 100, 'the cursor stays');
  assert.deepEqual(f.said('link-up ended, link gone'), [{ peer: 'dev_b' }]);
  assert.deepEqual(f.said('linked PC caught up'), [], 'and no run follows while the link is gone');

  f.fails.clear();
  f.linked.add('dev_b');
  f.run('dev_b'); // the link is back
  await idle();
  assert.deepEqual(f.steps.slice(3).map((entry) => entry.split(':')[0]), FULL);
  assert.deepEqual(f.sinces, [100, 100], 'everything since the old cursor again');
  assert.equal(f.cursors.get('dev_b'), START);
});

test('a link-up that fails is logged, and that PC\'s next link-up runs', async () => {
  const f = fixture();
  f.fails.set('secrets:dev_b', new Error('disk full'));
  f.run('dev_b');
  await idle();
  assert.deepEqual(f.said('linked PC not caught up'), [{ peer: 'dev_b', error: 'disk full' }]);
  assert.equal(f.cursors.get('dev_b'), undefined);
  f.fails.clear();
  f.run('dev_b');
  await idle();
  assert.deepEqual(f.said('linked PC caught up'), [{ peer: 'dev_b', first: true, complete: true }]);
});
