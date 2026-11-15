// The task as the agent reads it (context/task-text.ts), from Ida's capture of 14.11.2026: the current task names its chat
// and its parent's id, says "Done when: not set yet." as a plain fact and carries no next look (this turn plans it); a
// task line keeps what a wait is about (an "outside" wait named Felix only there); times in the one absolute form.
// Owns: these assertions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';
import { renderTask, taskLine } from '../../../src/runtime/context/task-text.ts';
import { agent, harness } from '../chat/harness.ts';

test('current task: its chat, its parent\'s id, done-when as a fact, no next look; tasks.get keeps the next look', () => {
  const h = harness();
  h.org.add(agent('ag_ida', 'Ida'));
  const chat = h.chats.create({ agentIds: ['ag_ida'], createdBy: HUMAN_ID });
  const parent = h.tasks.create({ conversationId: chat.id, title: 'Montagstest vorbereiten', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID });
  const piece = h.tasks.create({ conversationId: chat.id, title: 'QR-Code mit Link erzeugen', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID, parentId: parent.id });
  const text = renderTask(h.services as RuntimeServices, h.tasks.get(piece.id)!, 'UTC');
  const head = text.split('\n')[1];
  assert.ok(head.includes(`chat ${chat.id}`), head);
  assert.doesNotMatch(head, /next look/);
  assert.ok(text.includes(`Part of: ${parent.id} Montagstest vorbereiten`), text);
  assert.ok(text.includes('Done when: not set yet.'), text);
  const got = renderTask(h.services as RuntimeServices, h.tasks.get(piece.id)!, 'UTC', '## Task');
  assert.match(got.split('\n')[1], /next look: /);
});

test('a task line keeps the wait\'s why; times are "Thu 12 Nov 19:41", never a bare clock time', () => {
  const now = Date.UTC(2026, 10, 14, 2, 0);
  const since = Date.UTC(2026, 10, 12, 19, 41);
  const task = {
    id: 'task_1', title: 'Montagstest', notes: '', status: 'waiting', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID, priority: 0,
    waitingOn: { on: 'outside', why: 'Warte auf Felix: Handy Mo 7:30 oder nachmittags?', since }, nextAt: now + 60_000,
    ledger: {}, sort: 0, rev: 0, createdAt: since, updatedAt: since, steps: [],
  } as unknown as TaskView;
  const line = taskLine(task, { zone: 'UTC', nameOf: (id) => id }, now);
  assert.equal(line, '- task_1 · waiting on something outside since Thu 12 Nov 19:41: Warte auf Felix: Handy Mo 7:30 oder nachmittags? · Montagstest · I look again Sat 14 Nov 02:01');
});
