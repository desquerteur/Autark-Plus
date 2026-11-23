// B-054 (owner 29.10.2026: a chat is only where a task was handed over): deleting a chat
// (src/runtime/chat/lifecycle.ts removeConversation). Any unbounded chat lets its tasks live on chat-free – the
// chat's space kept, no anchor, rev bumped, still found by search, pending wakes and reminders kept (now chat-free),
// each re-emitted once – and an open mini-app to-do among them is cancelled (its fence went with the chat). A bounded
// chat (the people's own, or one that ever had a person in it) still takes its tasks along (F-52), FTS rows included.
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';
import { agent, center } from '../task-center/fixture.ts';

const SPACES = [{ id: 'sp_co', name: 'Company', kind: 'company' as const, sort: 0, createdAt: 0 }];

function setup() {
  const h = center({ spaces: SPACES });
  h.org.add(agent('ag_lea', 'Lea', { role: 'Web developer', createdAt: 1 }));
  const upserted: string[] = [];
  h.s.bus.on('task.upserted', (task: TaskView) => { upserted.push(task.id); });
  const ftsHits = (word: string) => h.s.db.all<{ task_id: string }>('SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?', [word]).map((row) => row.task_id);
  return { ...h, upserted, ftsHits };
}




test('B-054 fix: a detached task keeps its pending wake and reminder, now chat-free', () => {
  const h = setup();
  const chat = h.chats.create({ agentIds: ['ag_lea'], humans: true, createdBy: HUMAN_ID });
  const site = h.tasks.create({ conversationId: chat.id, title: 'Check the invoices', assigneeKind: 'agent', assigneeId: 'ag_lea', createdBy: HUMAN_ID });
  h.s.db.run(`INSERT INTO wakes (id, agent_id, conversation_id, task_id, reason, due_at, created_at) VALUES ('wk_t', 'ag_lea', ?, ?, 'task', 9e12, 1)`, [chat.id, site.id]);
  h.s.db.run(`INSERT INTO wakes (id, agent_id, conversation_id, reason, due_at, created_at) VALUES ('wk_c', 'ag_lea', ?, 'message', 9e12, 1)`, [chat.id]);
  h.s.db.run(`INSERT INTO schedules (id, owner_id, conversation_id, task_id, kind, title, spec, created_at) VALUES ('sc_r', 'ag_lea', ?, ?, 'reminder', 'Look again', '{}', 1)`, [chat.id, site.id]);
  h.chats.remove(chat.id);
  const wake = h.s.db.get<{ conversation_id: string | null; task_id: string }>(`SELECT conversation_id, task_id FROM wakes WHERE task_id = ?`, [site.id]);
  assert.deepEqual([wake?.conversation_id, wake?.task_id], [null, site.id]);
  assert.equal(h.s.db.get<{ conversation_id: string | null }>(`SELECT conversation_id FROM wakes WHERE id = 'wk_c'`)?.conversation_id, chat.id, 'a chat-only wake is left as it was');
  assert.equal(h.s.db.get<{ conversation_id: string | null }>(`SELECT conversation_id FROM schedules WHERE id = 'sc_r'`)?.conversation_id, null);
});
