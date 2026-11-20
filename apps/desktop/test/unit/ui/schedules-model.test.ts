// #20: the Schedules tab's pure model – the draft → request step (agent job, message, reminder), the list order, the
// history words and the route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, draftOf, emptyDraft, outcomeText, sortSchedules } from '../../../src/ui/schedules/schedules-model.ts';
import { defaultForm } from '../../../src/ui/chat/composer/schedule-form.ts';
import { formatRoute, parseRoute } from '../../../src/ui/lib/router.ts';
import type { Schedule } from '../../../src/shared/model/tasks.ts';

const NOW = Date.UTC(2026, 10, 19, 12, 0);
const daily = { ...defaultForm(NOW, 'Europe/Berlin'), kind: 'repeat' as const, repeat: 'days' as const, clock: '06:00' };

test('an agent job needs an agent and its words; "every day 06:00" becomes times in the zone', () => {
  assert.deepEqual(build({ ...emptyDraft('job', ''), body: 'News' }, daily, NOW), { error: 'Pick the agent.' });
  assert.deepEqual(build(emptyDraft('job', 'ag_1'), daily, NOW), { error: 'Write what the agent should do.' });
  const built = build({ ...emptyDraft('job', 'ag_1'), body: ' Research the news ', conversationId: 'ch_x' }, daily, NOW);
  assert.ok('create' in built);
  assert.equal(built.create.kind, 'routine');
  assert.equal(built.create.agentId, 'ag_1');
  assert.equal(built.create.conversationId, 'ch_x');
  assert.equal(built.create.body, 'Research the news');
  assert.deepEqual([built.create.spec.times, built.create.spec.tz], [['06:00'], 'Europe/Berlin']);
});

test('a message needs a chat; a reminder an agent and has no level', () => {
  assert.deepEqual(build({ ...emptyDraft('message'), body: 'Hi' }, daily, NOW), { error: 'Pick the chat the message is posted in.' });
  const reminder = build({ ...emptyDraft('reminder', 'ag_1'), body: 'Check', important: true }, daily, NOW);
  assert.ok('create' in reminder);
  assert.equal(reminder.create.kind, 'reminder');
  assert.equal(reminder.update.priority, undefined);
});

test('a rule in the past is refused with the form model\'s words', () => {
  const once = { ...defaultForm(NOW, 'UTC'), kind: 'once' as const, date: '2026-11-01', time: '09:00' };
  assert.deepEqual(build({ ...emptyDraft('message'), conversationId: 'ch_x', body: 'Hi' }, once, NOW), { error: 'Pick a time in the future.' });
});

const item = (over: Partial<Schedule>): Schedule => ({ id: 's', ownerId: 'human', kind: 'message', title: 't', spec: {}, payload: {}, runs: 0, active: true, createdAt: 1, ...over });

test('the list shows active schedules by next run, paused ones last', () => {
  const order = sortSchedules([item({ id: 'p', active: false, nextAt: 1 }), item({ id: 'late', nextAt: 9 }), item({ id: 'soon', nextAt: 5 })]).map((s) => s.id);
  assert.deepEqual(order, ['soon', 'late', 'p']);
});

test('a stored job comes back as its draft; history lines say what happened', () => {
  const job = item({ kind: 'routine', ownerId: 'ag_1', title: 'News', conversationId: 'ch_x', payload: { taskTemplate: { title: 'News', notes: 'Do it' }, priority: 'important' } });
  assert.deepEqual(draftOf(job), { type: 'job', title: 'News', body: 'Do it', agentId: 'ag_1', conversationId: 'ch_x', important: true });
  assert.equal(outcomeText({ at: 1, firedAt: 2, outcome: 'ok', manual: true }), 'Run now');
  assert.equal(outcomeText({ at: 1, firedAt: 2, outcome: 'skipped', note: 'Missed while the app was not running' }), 'Skipped · Missed while the app was not running');
});

test('the route #/schedules[/id] round-trips', () => {
  assert.deepEqual(parseRoute('#/schedules'), { view: 'schedules' });
  assert.deepEqual(parseRoute('#/schedules/sch_1'), { view: 'schedules', id: 'sch_1' });
  assert.equal(formatRoute({ view: 'schedules', id: 'new' }), '#/schedules/new');
});
