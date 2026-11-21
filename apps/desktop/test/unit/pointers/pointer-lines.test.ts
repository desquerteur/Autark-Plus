// B-081: the person's pointer in the agents' lines (shared/model/pointers.ts, runtime/pointers/hub.ts) – kept 5 minutes
// for the lines (an agent's 15 s, as before), "is moving over X" under 2 s since the last report, "rests on X (selector),
// last move 40 s ago" after that (minutes from 90 s on, also after a scroll); a click and typing in the past tense;
// agents read as before; viewers (pointers.list, pointers.changed) get only points under 15 s old.
// Owns: these assertions only. Never: a browser, a bus or a timer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PointerHub } from '../../../src/runtime/pointers/hub.ts';
import { POINTER_PERSON_TTL_MS, POINTER_TTL_MS, liveFor, pointersLine, type PointerPoint } from '../../../src/shared/model/pointers.ts';
import { shownPointers } from '../../../src/ui/workspace/pointer-overlay.ts';

const lukas = { kind: 'person' as const, id: 'human', name: 'Lukas' };
const ada = { kind: 'agent' as const, id: 'ag_ada', name: 'Ada' };
const point = (over: Partial<PointerPoint>): PointerPoint => ({ surface: 'side:web-3', actor: lukas, x: 812, y: 430, at: 0, ...over });

test('the wording: moving under 2 s, resting with the time of the last move, clicks and agents as before', () => {
  const now = 1_000_000;
  const buy = { role: 'button', name: 'Buy now', selector: 'div.card > button.buy' };
  assert.equal(pointersLine([point({ target: buy, action: 'move', at: now - 500 })], 'ag_x', now), 'Lukas (person) is moving over button "Buy now" (div.card > button.buy)');
  assert.equal(pointersLine([point({ at: now - 1999 })], 'ag_x', now), 'Lukas (person) is moving at 812,430');
  assert.equal(pointersLine([point({ target: buy, at: now - 40_000 })], 'ag_x', now), 'Lukas (person) rests on button "Buy now" (div.card > button.buy), last move 40 s ago');
  assert.equal(pointersLine([point({ target: { selector: 'main > p' }, at: now - 89_000 })], 'ag_x', now), 'Lukas (person) rests on main > p, last move 89 s ago');
  assert.equal(pointersLine([point({ at: now - 180_000 })], 'ag_x', now), 'Lukas (person) rests at 812,430, last move 3 min ago');
  assert.equal(pointersLine([point({ target: buy, action: 'click', at: now - 3000 })], 'ag_x', now), 'Lukas (person) clicked at button "Buy now" (div.card > button.buy), 3 s ago');
  assert.equal(pointersLine([point({ action: 'scroll', at: now - 500 })], 'ag_x', now), 'Lukas (person) is scrolling at 812,430, just now');
  assert.equal(pointersLine([point({ action: 'scroll', at: now - 180_000 })], 'ag_x', now), 'Lukas (person) rests at 812,430, last move 3 min ago', 'a scroll minutes ago is no "is scrolling"');
  assert.equal(pointersLine([point({ action: 'type', at: now - 120_000 })], 'ag_x', now), 'Lukas (person) typed at 812,430, 2 min ago');
  assert.equal(pointersLine([point({ actor: ada, action: 'scroll', at: now - 3000 })], 'ag_x', now), 'Ada (agent) is scrolling at 812,430, 3 s ago');
  assert.equal(pointersLine([point({ actor: ada, action: 'move', target: { role: 'link', name: 'Docs', ref: 'e3' }, at: now - 1000 })], 'ag_x', now), 'Ada (agent) is pointing at link "Docs" [ref=e3], just now');
  assert.equal(pointersLine([point({ at: now - 4000 })], 'human', now), '', 'never about itself');
});

test('kept: a person 5 minutes for the lines, an agent 15 s; viewers get 15 s only', () => {
  assert.equal(POINTER_PERSON_TTL_MS, 300_000);
  let now = 1_000_000;
  const events: Array<{ surface: string; points: PointerPoint[] }> = [];
  const bus = { emit: (_name: string, payload: { surface: string; points: PointerPoint[] }) => { events.push(payload); } };
  const hub = new PointerHub({ now: () => now, bus: bus as never });
  hub.point({ surface: 'side:web-3', actor: lukas, x: 10, y: 20, target: { role: 'button', name: 'Pay' } });
  now += POINTER_TTL_MS;
  hub.point({ surface: 'side:web-3', actor: ada, x: 30, y: 40, action: 'click' });
  assert.deepEqual(hub.on('side:web-3').map((p) => p.actor.id), ['ag_ada'], 'pointers.list: the person’s 15 s old point is not handed to viewers');
  assert.deepEqual(events.at(-1)?.points.map((p) => p.actor.id), ['ag_ada'], 'pointers.changed: neither (so a viewer’s expiry timer is the agent’s)');
  assert.equal(hub.line('side:web-3', 'ag_ben'), 'Lukas (person) rests on button "Pay", last move 15 s ago\nAda (agent) clicked at 30,40, just now');
  now += POINTER_TTL_MS;
  assert.equal(shownPointers(hub.on('side:web-3'), 'side:web-3', now, {}).length, 0, 'viewers draw nothing 15 s on');
  now += 4 * 60_000 - 2 * POINTER_TTL_MS;
  assert.equal(hub.line('side:web-3', 'ag_ben'), 'Lukas (person) rests on button "Pay", last move 4 min ago');
  now += 60_000;
  assert.equal(hub.line('side:web-3', 'ag_ben'), '', 'gone after 5 minutes');
  assert.equal(liveFor(point({ at: 0 }), POINTER_PERSON_TTL_MS - 1), true);
  assert.equal(liveFor(point({ actor: ada, at: 0 }), POINTER_TTL_MS), false);
});
