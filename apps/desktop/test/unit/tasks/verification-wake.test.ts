// B-080 (live 05.–08.11.2026: 27 of 30 tasks a model's "no" rejected ran again, 75 runs, adding proof each time) – the
// verification step (tasks/verification.ts): a model's "not shown" stays the "Verifier disagrees" note on the done
// result and costs no turn; a failed runtime check (fact) wakes the assignee once with what failed.
// Owns: these assertions only. Never: a real verifier (a stub subconscious answers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';
import type { Subconscious } from '../../../src/runtime/contracts.ts';

type Verdict = Awaited<ReturnType<Subconscious['verify']>> & { fact?: boolean };

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(verdict: Verdict) {
  const asked: string[] = [];
  const h = harness({ subconscious: { verify: async (task) => { asked.push(task.id); return verdict; } } });
  h.org.add(agent('ag_tom', 'Tom'));
  const chat = h.chats.create({ title: 'Mails', agentIds: ['ag_tom'], createdBy: 'human' });
  const task = h.tasks.create({ conversationId: chat.id, title: 'Send the 40 mails', assigneeId: 'ag_tom', createdBy: 'human', doneWhen: 'The 40 mails are out' });
  const finish = async () => {
    h.tasks.finish(task.id, { status: 'done' as const, ...{ summary: 'Sent 40 mails, sample of 5 checked.', evidence: [{ kind: 'link', label: 'Log', ref: 'https://mail.example/log' }], verification: 'claimed_by_agent' } }, 'ag_tom');
    await settle();
  };
  const verifyWakes = () => h.wakeRows().filter((row) => row.task_id === task.id && /^The runtime checked my result/.test(row.note ?? ''));
  return { ...h, task, asked, finish, verifyWakes };
}


test('a model\'s "not shown" stays the note on the done result and wakes nobody, also on a second completion', async () => {
  const h = setup({ ok: false, checked: true, reason: 'The result does not show: The 40 mails are out' });
  await h.finish();
  const current = h.tasks.get(h.task.id)!;
  assert.equal(current.status, 'done');
  assert.equal(current.result?.verification, 'claimed_by_agent');
  assert.equal(current.result?.verificationNote, 'Verifier disagrees: The result does not show: The 40 mails are out');
  assert.equal(h.verifyWakes().length, 0, 'no turn for a model\'s doubt');
  h.tasks.update(h.task.id, { status: 'open' }, 'human'); // the person reopens it
  await h.finish();
  assert.equal(h.asked.length, 2);
  assert.equal(h.verifyWakes().length, 0);
});

test('a failed runtime check is a fact: one wake for the assignee with what failed', async () => {
  const h = setup({ ok: false, checked: true, fact: true, reason: 'The evidence does not hold: link does not exist (HTTP 404): https://mail.example/log.' });
  await h.finish();
  assert.equal(h.tasks.get(h.task.id)!.result?.verificationNote, 'Verifier disagrees: The evidence does not hold: link does not exist (HTTP 404): https://mail.example/log.');
  const wakes = h.verifyWakes();
  assert.equal(wakes.length, 1);
  assert.match(wakes[0].note!, /^The runtime checked my result: The evidence does not hold: link does not exist \(HTTP 404\)/);
  assert.equal(h.wakes.cancelKey('ag_tom', `verify:${h.task.id}`), true, 'under the key verify:<task id>');
});
