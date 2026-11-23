// 13.11.2026 (owner: one context per agent): every turn of an agent runs in its main thread – a chat, a chat-free task and
// a mail alike – so one native session, one set of repair notes and one ledger hold all of it; only a split's part has its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_THREAD, threadKey } from '../../../src/shared/model/origin.ts';
import { planTurn } from '../../../src/runtime/agents/turn-prepare.ts';
import { SessionStore } from '../../../src/runtime/agents/sessions.ts';
import { takeRepairNotes } from '../../../src/runtime/agents/turn-finish.ts';
import { setup } from './fixture.ts';

const MAIL = { source: 'app:box', label: 'New mail in me@example.test' };

test('threadKey: the main thread, a split part its own', () => {
  assert.equal(threadKey({}), MAIN_THREAD);
  assert.equal(threadKey({ split: 'sp_1' }), 'split:sp_1');
  assert.equal(threadKey({ split: { splitId: 'sp_2' } }), 'split:sp_2');
});

test('planTurn: a chat, a mail and a chat-free task all plan the one main thread; the origin rides along', async () => {
  const h = setup();
  const chat = (await planTurn(h.services, h.request()))!;
  assert.equal(chat.thread, MAIN_THREAD);
  assert.equal(chat.conversationId, h.chat.id);

  const mail = (await planTurn(h.services, h.request({ conversationId: undefined, reason: 'event', origin: MAIL, notes: [{ text: 'New mail: 1 new message.', at: 1 }] })))!;
  assert.equal(mail.thread, MAIN_THREAD);
  assert.deepEqual(mail.origin, MAIL);

  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Summarise the items', assigneeKind: 'agent', assigneeId: h.tom.id, createdBy: 'human' });
  h.db.run('UPDATE tasks SET conversation_id = NULL, message_id = NULL WHERE id = ?', [task.id]);
  const free = (await planTurn(h.services, h.request({ conversationId: undefined, taskId: task.id, reason: 'manual' })))!;
  assert.equal(free.thread, MAIN_THREAD);
});

test('one session and one set of repair notes per agent: the main thread', () => {
  const h = setup();
  const store = new SessionStore(h.db);
  store.save({ agentId: h.tom.id, conversationId: MAIN_THREAD, engine: 'codex', ref: 'thr_main', generation: 1, cursorSeq: 0, updatedAt: 1 });
  assert.equal(store.get(h.tom.id, threadKey({}), 'codex')?.ref, 'thr_main');
  h.db.run("INSERT INTO kv (ns, key, value, updated_at) VALUES ('repair_notes', ?, ?, 1)", [`${h.tom.id}:${MAIN_THREAD}`, JSON.stringify(['fix the block'])]);
  assert.deepEqual(takeRepairNotes(h.services, h.tom.id, 'split:sp_1'), []);
  assert.deepEqual(takeRepairNotes(h.services, h.tom.id, MAIN_THREAD), ['fix the block']);
});
