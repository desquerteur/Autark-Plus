// What My day reads of the morning briefing (src/ui/day/day-briefing.ts): today's briefing only, and when the PC
// slept while night work waited. Its written sentences are not shown any more (day-next.ts says what is next).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Briefing } from '../../../src/shared/model/calendar.ts';
import { briefingFor, sleptFact } from '../../../src/ui/day/day-briefing.ts';

const briefing = (patch: Partial<Briefing> = {}): Briefing => ({
  date: '2026-10-31', lines: [], planned: 0, needsYou: 0, doneTaskIds: [], preparedTaskIds: [], waitingToStart: 0, chats: [], createdAt: 0, ...patch,
}) as Briefing;

test('only today\'s briefing counts', () => {
  assert.equal(briefingFor(null, '2026-10-31'), null);
  assert.equal(briefingFor(briefing({ date: '2026-10-30' }), '2026-10-31'), null);
  assert.ok(briefingFor(briefing(), '2026-10-31'));
});

test('the night: when the PC slept, once or several times', () => {
  assert.equal(sleptFact(undefined, 'UTC'), '');
  assert.equal(sleptFact([], 'UTC'), '');
  assert.match(sleptFact([{ from: Date.UTC(2026, 9, 30, 23, 10), to: Date.UTC(2026, 9, 31, 6, 40) }], 'UTC'), /^PC slept 23:10–06:40 – night work paused$/);
  assert.match(sleptFact([{ from: Date.UTC(2026, 9, 30, 23, 10), to: Date.UTC(2026, 9, 31, 1, 0) }, { from: Date.UTC(2026, 9, 31, 2, 0), to: Date.UTC(2026, 9, 31, 6, 40) }], 'UTC'),
    /^PC slept 2× between 23:10 and 06:40 – night work paused$/);
});
