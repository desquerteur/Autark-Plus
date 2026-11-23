// What the person handed off (runtime/day/handed-off.ts through the day service): the person's work an agent or a
// colleague owns, open or done since last evening, with its pieces; never the person's own to-dos, an agent's own
// work or dropped work. Handing an own to-do on is tasks.give (tasks/give.ts), covered there.
// Owns: checks of day.handedOff only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { zonedTime } from '../../../src/runtime/calendar/when.ts';
import { BERLIN, agent, dayFixture } from './fixture.ts';

const wall = (date: string, clock: string) => zonedTime(date, Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)), BERLIN);

test('handed off: open work others own plus what they finished since last evening, with its pieces', async () => {
  const f = dayFixture({ now: wall('2026-10-26', '18:00') });
  f.org.add(agent('ag_mara', 'Mara', { createdAt: 1 }));
  const chat = f.s.chats.create({ agentIds: ['ag_mara'], humans: true, createdBy: HUMAN_ID }).id;
  const make = (title: string, extra: Record<string, unknown> = {}) => f.s.tasks.create({ conversationId: chat, title, assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: HUMAN_ID, ...extra });
  const oldDone = make('Old report');
  f.s.tasks.finish(oldDone.id, { status: 'done', summary: 'Sent.' }, HUMAN_ID);
  f.clock.set(wall('2026-10-26', '21:00'));
  const nightDone = make('Taxes prepared');
  f.s.tasks.finish(nightDone.id, { status: 'done', summary: 'Filed.' }, HUMAN_ID);
  const working = make('Research flights');
  f.s.tasks.create({ conversationId: chat, title: 'Compare prices', assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: 'ag_mara', parentId: working.id });
  const dropped = make('Dropped');
  f.s.tasks.finish(dropped.id, { status: 'dropped', summary: 'Not needed.' }, HUMAN_ID);
  f.s.tasks.create({ conversationId: chat, title: 'Mara\'s own idea', assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: 'ag_mara' });
  await f.day.add({ text: 'Wäsche waschen' }, HUMAN_ID);
  f.clock.set(wall('2026-10-27', '07:00'));
  const list = f.day.handedOff(HUMAN_ID);
  assert.deepEqual(list.map((task) => task.title).sort(), ['Research flights', 'Taxes prepared'].sort());
  assert.deepEqual(list.find((task) => task.id === working.id)?.steps.map((step) => step.title), ['Compare prices']);
  assert.equal(f.day.handedOff(HUMAN_ID, 0).map((task) => task.title).includes('Old report'), true, 'an explicit since reaches further back');
});

test('handed off: a to-do the person gave an agent with tasks.give shows there with its state', async () => {
  const f = dayFixture({ now: wall('2026-10-26', '09:00') });
  f.org.add(agent('ag_mara', 'Mara', { role: 'Manager', mode: 'manager', createdAt: 1 }));
  const [taxes] = (await f.day.add({ text: 'Steuern erledigen' }, HUMAN_ID)).tasks;
  assert.ok(!f.day.handedOff(HUMAN_ID).some((task) => task.id === taxes.id), 'an own to-do is not handed off');
  await f.s.tasks.give(taxes.id, 'ag_mara', HUMAN_ID);
  const shown = f.day.handedOff(HUMAN_ID).find((task) => task.id === taxes.id);
  assert.equal(shown?.assigneeId, 'ag_mara');
  assert.equal(shown?.status, 'open');
});
