// What Work's "Your tasks" lists and how each row looks (src/ui/tasks/work-model.ts yourTasks, yourStatus, B-078):
// the person's handed-out tasks stay on Work – open ones and the ones finished in the last three days, newest first,
// one status form each (spinner while a turn works on it, check when done, dimmed cross when cancelled). B-080: what he
// said in his own chats counts as handed out too (inMyChat, not from a schedule); the search's hits over every task
// (searchHits) under the open matches found here (searchRows) and what an evidence chip opens (evidenceTarget).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_DAYS, evidenceTarget, searchHits, searchRows, yourStatus, yourTasks } from '../../../src/ui/tasks/work-model.ts';
import { DAY, HOUR, MARA, NOW, TOM, ids, task, todo, unowned } from './fixture.ts';


test('yourTasks: only what the person handed out – not agents\' tasks, not their own to-dos, not steps', () => {
  const mine = task({ createdBy: 'human' });
  const toTeam = unowned({ createdBy: 'human' });
  const agents = task({ createdBy: 'ag_mara' });
  const step = task({ createdBy: 'human', parentId: 'task_p' });
  const own = todo({ createdBy: 'human' });
  const list = yourTasks([mine, toTeam, agents, step, own], [], NOW);
  assert.deepEqual(ids(list.map((entry) => entry.task)), ids([mine, toTeam].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)));
});


test('yourTasks: the spinner follows the live activity or the task\'s running flag', () => {
  const idle = task({ status: 'open' });
  const live = task({ status: 'open' });
  const flagged = task({ status: 'open', running: true });
  const list = yourTasks([idle, live, flagged], [], NOW, { activeIds: new Set([live.id]) });
  const status = Object.fromEntries(list.map((entry) => [entry.task.id, entry.status]));
  assert.equal(status[idle.id], 'open');
  assert.equal(status[live.id], 'working');
  assert.equal(status[flagged.id], 'working');
});

test('yourTasks: skips what the For-you cards show, a duplicate id once, narrows to the search', () => {
  const asks = task({ status: 'waiting', title: 'Pick a colour' });
  const plain = task({ title: 'Write the invoice' });
  assert.deepEqual(ids(yourTasks([asks, plain], [], NOW, { skip: new Set([asks.id]) }).map((e) => e.task)), [plain.id]);
  const dup = task({ status: 'done', completedAt: NOW - HOUR });
  assert.equal(yourTasks([], [dup, dup], NOW).length, 1);
  assert.deepEqual(ids(yourTasks([asks, plain], [], NOW, { query: 'INVOICE' }).map((e) => e.task)), [plain.id]);
});

test("B-080: an agent's task made in one of his own chats is his handed-out work – not one in an internal chat, from a schedule, or his own to-do", () => {
  // Live 05.–08.11.: 98 top-level tasks, 1 created by the person; he hands out work by speaking in his chats.
  const mine = new Set(['ch_mine']);
  const inMyChat = (id: string) => mine.has(id);
  const said = task({ createdBy: MARA, conversationId: 'ch_mine', status: 'open', updatedAt: NOW - HOUR });
  const running = task({ createdBy: MARA, conversationId: 'ch_mine', status: 'open', updatedAt: NOW - 2 * HOUR });
  const finished = task({ createdBy: MARA, conversationId: 'ch_mine', status: 'done', completedAt: NOW - 3 * HOUR });
  const internal = task({ createdBy: MARA, conversationId: 'ch_team_room' });
  const scheduled = task({ createdBy: MARA, conversationId: 'ch_mine', origin: { source: 'schedule:sch_1', label: 'Nightly backup' } });
  const own = todo({ createdBy: MARA, conversationId: 'ch_mine' });
  const list = yourTasks([said, running, internal, scheduled, own], [finished], NOW, { activeIds: new Set([running.id]), inMyChat });
  assert.deepEqual(ids(list.map((entry) => entry.task)), ids([said, running, finished]));
  assert.deepEqual(list.map((entry) => entry.status), ['open', 'working', 'done'], 'the open circle, the spinner, the check');
  assert.deepEqual(yourTasks([said], [], NOW), [], 'without inMyChat only what he typed on Work counts, as before');
});

test("B-080: the search's hits – finished tasks and steps too – minus what Work shows and his own to-dos, the live copy first", () => {
  const shownCard = task({ status: 'waiting' });
  const finished = task({ status: 'done', completedAt: NOW - HOUR, title: 'Memoryansicht audit' });
  const step = task({ parentId: 'task_parent', status: 'done', completedAt: NOW - HOUR });
  const own = todo();
  const stale = task({ status: 'open' });
  const live = { ...stale, status: 'open' as const, running: true };
  const rows = searchHits([shownCard, finished, step, own, stale], [live], new Set([shownCard.id]));
  assert.deepEqual(ids(rows), ids([live, finished, step]), 'running first, then by status');
  assert.equal(rows[0].running, true, "the store's live copy of an open task");
  assert.deepEqual(ids(searchHits([own], [], new Set(), { keepOwn: true })), [own.id], "a person's device keeps its own to-dos");
});

test("B-080: the search's rows keep the open matches found here (a chat's name, a word part) and add the answer's other hits under them", () => {
  const byChat = task({ status: 'open', title: 'Draft', conversationId: 'ch_launch' }); // found by its chat's name only
  const byPart = task({ status: 'open', title: 'Memoryansicht' }); // 'ansicht': a word part the full-text search misses
  const shownCard = task({ status: 'waiting' });
  const finished = task({ status: 'done', completedAt: NOW - HOUR });
  const step = task({ parentId: 'task_parent', status: 'open' });
  const local = [byChat, byPart, shownCard];
  const shown = new Set([shownCard.id]);
  assert.deepEqual(ids(searchRows(local, undefined, local, shown)), ids([byChat, byPart]), 'until the answer: the open matches');
  const rows = searchRows(local, [finished, byPart, step], local, shown);
  assert.deepEqual(ids(rows), ids([byChat, byPart, step, finished]), 'the open matches first in their order, then the new hits');
  assert.deepEqual(ids(searchRows(local, [], local, shown)), ids([byChat, byPart]), 'an answer without them keeps them');
});

test('B-080: an evidence chip opens a link, an image path or another path; anything else stays static', () => {
  assert.deepEqual(evidenceTarget('https://openautark.com/release'), { kind: 'link', ref: 'https://openautark.com/release' });
  assert.deepEqual(evidenceTarget(' C:\\Users\\ann\\shot.PNG '), { kind: 'image', ref: 'C:\\Users\\ann\\shot.PNG' });
  assert.deepEqual(evidenceTarget('C:/work/notes/audit.md'), { kind: 'path', ref: 'C:/work/notes/audit.md' });
  assert.deepEqual(evidenceTarget('/home/me/report.txt'), { kind: 'path', ref: '/home/me/report.txt' });
  assert.deepEqual(evidenceTarget('\\\\nas\\share\\a.jpg'), { kind: 'image', ref: '\\\\nas\\share\\a.jpg' });
  for (const ref of [undefined, '', 'run_item_42', 'notes/audit.md', 'mailto:me@example.com']) assert.equal(evidenceTarget(ref), undefined, String(ref));
});
