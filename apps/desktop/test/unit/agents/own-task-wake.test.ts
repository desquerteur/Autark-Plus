// FIXES-3b F2.3 (real pass calls-claude-2026-11-18T16-00-56-739Z, runs run_1m7qpbdbmydnadcv8 → run_1m7qpc0b0tdy6xa5y): work
// I give myself needs no word – the wake that starts it carries no note, so a task I set aside in the turn that made it
// (B-047: a bare task wake for set-aside work is stale) runs no turn; one I leave open still starts.
// Owns: these assertions only. Never: real engines or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.ts';
import { planTurn } from '../../../src/runtime/agents/turn-prepare.ts';

test('a task I make myself and set waiting in the same turn runs no task turn; one I leave open starts (FIXES-3b F2.3)', async () => {
  const h = setup();
  const wakeOf = (taskId: string) => {
    const rows = h.wakeRows().filter((row) => row.task_id === taskId);
    assert.equal(rows.length, 1, 'one wake starts my own task');
    return h.request({ reason: rows[0].reason as 'task', taskId, notes: rows[0].note ? [{ text: rows[0].note, at: 0 }] : [] });
  };
  const waiting = h.tasks.create({ conversationId: h.chat.id, title: 'Steuersatz klären', notes: '', assigneeKind: 'agent', assigneeId: h.tom.id, createdBy: h.tom.id });
  h.tasks.update(waiting.id, { status: 'waiting', waitingOn: { on: 'who', who: 'human', why: '19 oder 20 Prozent' } }, h.tom.id);
  assert.equal(await planTurn(h.services, wakeOf(waiting.id)), undefined, 'the wait I set is the newest state of my own work');

  const open = h.tasks.create({ conversationId: h.chat.id, title: 'Angebot schreiben', notes: 'Für Berger', assigneeKind: 'agent', assigneeId: h.tom.id, createdBy: h.tom.id });
  const plan = await planTurn(h.services, wakeOf(open.id));
  assert.equal(plan?.task?.id, open.id, 'open work I made starts by its wake');
});
