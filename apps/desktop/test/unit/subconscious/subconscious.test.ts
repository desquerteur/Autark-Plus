// SubconsciousImpl: verify cases, widgetFor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDecisions, fixture } from '../context/fixture.ts';
import type { Task } from '../../../src/shared/model/tasks.ts';

const WEEK = 7 * 86_400_000;


test('widgetFor: keyword fallback without a decision model; decision choice with details carried over', async () => {
  const f = fixture();
  const timer = await f.subconscious.widgetFor('Remind me at 17:00 to call the tax office');
  assert.equal(timer.type, 'timer');
  assert.ok(typeof timer.at === 'string');
  assert.deepEqual(await f.subconscious.widgetFor('Record the intro video'), { type: 'record', mode: 'video', instructions: 'Record the intro video' });

  const choose = fakeDecisions((request) => ({ choice: request.options!.find((option) => option.startsWith('upload:')) }));
  const g = fixture({ decisions: choose.service });
  const upload = await g.subconscious.widgetFor('Send me the receipts from March');
  assert.equal(choose.calls[0].purpose, 'widget');
  assert.deepEqual(upload, { type: 'upload', label: 'Send me the receipts from March' });

  const timerChoice = fakeDecisions((request) => ({ choice: request.options!.find((option) => option.startsWith('timer:')) }));
  const h = fixture({ decisions: timerChoice.service });
  const alarm = await h.subconscious.widgetFor('Call mum in 20 min');
  assert.equal(alarm.type, 'timer');
  assert.equal(alarm.duration, 'PT20M');
});

function doneTask(extra: Partial<Task> = {}): Task {
  return { id: 'task_1', conversationId: 'ch_1', title: 'Write the landing page', notes: '', status: 'done', assigneeKind: 'agent', createdBy: 'human', priority: 0, ledger: {}, sort: 0, rev: 1, createdAt: 0, updatedAt: 0, ...extra };
}
