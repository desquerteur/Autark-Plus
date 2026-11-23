// Work's two regions (B-078 D10, src/ui/tasks/work-model.ts): what lands on "For you" (the agents' work that needs
// the person), what the report says (alsoHandled lines and work nobody asked for, the last three days, deduplicated,
// newest first, at most eight), one owner's slim rows, the search, what Work lists at all – and stuckOf, which the
// team view keeps using.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAUSED_REASON } from '../../../src/shared/model/tasks.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';
import { REPORT_MAX, forYou, isOpenWork, matchingWork, needsThePerson, ownerWork, report } from '../../../src/ui/tasks/work-model.ts';
import { stuckOf } from '../../../src/shared/model/task-stuck.ts';
import { ANNA, DAY, HOUR, MARA, NOW, TOM, ids, task, todo, unowned } from './fixture.ts';

const result = (summary: string, alsoHandled?: string[]) => ({ summary, evidence: [], verification: 'claimed_by_agent' as const, ...(alsoHandled ? { alsoHandled } : {}) });
const step = (patch: Partial<TaskView['steps'][number]> = {}) => ({
  id: `step_${Math.random()}`, title: 'Which logo?', status: 'open', assigneeKind: 'human', sort: 0, createdAt: NOW, widget: { type: 'choice', question: 'Which logo?', options: ['A', 'B'] }, ...patch,
}) as unknown as TaskView['steps'][number];




test('the report: alsoHandled lines and work nobody asked for, the last three days, deduplicated, newest first, at most eight', () => {
  const asked = task({ title: 'Draft the brief', status: 'done', createdBy: 'human', completedAt: NOW - HOUR, result: result('Brief is in the folder', ['Renewed the domain', 'The VPS disk was full – cleaned 12 GB']) });
  const nightly = { conversationId: undefined, origin: { source: 'schedule:sch_1', label: 'Routine "Backup"' } };
  const unasked = task({ title: 'Nightly backup', status: 'done', createdBy: MARA, completedAt: NOW - 2 * HOUR, result: result('Backup ran, 3 GB'), ...nightly });
  // An agent's task for a person's request in a chat (or chat-free from the system) is no line of its own.
  const forARequest = task({ title: 'Find a venue', status: 'done', createdBy: MARA, conversationId: 'conv_1', completedAt: NOW - 90 * 60_000, result: result('Booked the hall') });
  const fromSystem = task({ title: 'Sort the files', status: 'done', createdBy: MARA, conversationId: undefined, origin: { source: 'system', label: 'System' }, completedAt: NOW - 90 * 60_000, result: result('Sorted') });
  const duplicate = task({ title: 'Other', status: 'done', createdBy: 'human', completedAt: NOW - 3 * HOUR, result: result('x', ['renewed the domain']) });
  const old = task({ title: 'Old', status: 'done', createdBy: MARA, completedAt: NOW - 4 * DAY, result: result('Too old') });
  const cancelled = task({ status: 'dropped', createdBy: MARA, completedAt: NOW - HOUR, result: result('Gave up') });
  const ownTodo = todo({ status: 'done', createdBy: 'ag_x', completedAt: NOW - HOUR, result: result('Answered', ['Not mine']) });
  const sub = task({ status: 'done', parentId: 'task_p', createdBy: MARA, completedAt: NOW - HOUR, result: result('A step', ['Step note']) });
  const lines = report([old, duplicate, unasked, asked, cancelled, ownTodo, sub, forARequest, fromSystem], NOW);
  assert.deepEqual(lines.map((line) => line.text), [
    'Renewed the domain', 'The VPS disk was full – cleaned 12 GB', 'Nightly backup: Backup ran, 3 GB',
  ]);
  assert.equal(lines[0].task.id, asked.id, 'each line opens its task');
  assert.deepEqual(report([asked], NOW, { query: 'vps' }).map((line) => line.text), ['The VPS disk was full – cleaned 12 GB']);
  const many = Array.from({ length: 12 }, (_, index) => task({ status: 'done', createdBy: MARA, completedAt: NOW - index * 1000, result: result(`Line ${index}`), ...nightly }));
  assert.equal(report(many, NOW).length, REPORT_MAX);
  assert.deepEqual(report(many, NOW, { max: 3 }).map((line) => line.task.id), ids(many.slice(0, 3)), 'My day keeps its 3 lines');
  // B-080: Work and the pane take every line of the window – WorkReport shows REPORT_MAX of them until "Show all (N)"
  assert.deepEqual(report(many, NOW, { max: Number.POSITIVE_INFINITY }).map((line) => line.task.id), ids(many));
});
