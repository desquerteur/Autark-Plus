// The subconscious's hook point in a turn: agents/turn-prepare.ts hands beforeTurn what people wrote (`said`) and, v1 14.11.2026,
// what other agents wrote (`woke`: not the agent's own lines, not status lines) and the turn's task as it reads it (`taskText`: its
// title and the wake's newest note, else its notes – findings 14.11.; a chat wake's note never), a person's file-only message as its
// file names, and puts what beforeTurn returns into the plan and
// from there into the engine's input – no tips and no hints in any prompt. Nothing of the subconscious runs after a turn.
// Owns: these assertions only. Never: real models or engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurn, planTurn } from '../../../src/runtime/agents/turn-prepare.ts';
import type { Subconscious } from '../../../src/runtime/contracts.ts';
import type { SubconsciousTrace } from '../../../src/shared/model/subconscious.ts';
import { agent } from '../chat/harness.ts';
import { setup } from '../agents/fixture.ts';

type Asked = Parameters<NonNullable<Subconscious['beforeTurn']>>[0];

test('before a turn: the subconscious hands over what it kept for the thread, its trace goes into the plan; nothing else changes', async () => {
  const h = setup();
  const trace: SubconsciousTrace = { calls: [{ tool: 'agent.tell', args: {}, output: 'Eine Notiz.' }] };
  const asked: Asked[] = [];
  h.services.subconscious.beforeTurn = async (input) => { asked.push(input); return trace; };
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Wie heißt unser Steuerberater?' });
  const plan = (await planTurn(h.services, h.request()))!;
  assert.equal(asked[0].thread, 'main');
  assert.equal(asked[0].said, 'Wie heißt unser Steuerberater?', 'what the person wrote: the routing call weighs it');
  assert.equal(asked[0].woke, '');
  assert.deepEqual(plan.trace, trace);
});

test("colleagues' lines go as woke: not the agent's own, not a status line; the person's as said", async () => {
  const h = setup();
  const asked: Asked[] = [];
  h.services.subconscious.beforeTurn = async (input) => { asked.push(input); return undefined; };
  h.org.add(agent('ag_konrad', 'Konrad'));
  h.chats.setMembers(h.chat.id, { add: ['ag_konrad'] }, 'human');
  h.chats.send({ conversationId: h.chat.id, authorId: 'ag_konrad', body: 'Der Bericht für Q3 liegt in reports/q3.md.' });
  h.chats.send({ conversationId: h.chat.id, authorId: h.tom.id, body: 'Ich schaue gleich nach.' });
  h.chats.status(h.chat.id, { type: 'note', text: 'Konrad hat den Bericht abgelegt.' }, { authorId: 'ag_konrad' });
  await planTurn(h.services, h.request());
  assert.equal(asked[0].said, '');
  assert.equal(asked[0].woke, 'Der Bericht für Q3 liegt in reports/q3.md.');
});

test('a turn with a task hands its task as it reads it: the title and the wake\'s newest note, else the task\'s notes; a turn without a task none', async () => {
  const h = setup();
  const asked: Asked[] = [];
  h.services.subconscious.beforeTurn = async (input) => { asked.push(input); return undefined; };
  const task = h.tasks.create({ title: 'Export report', notes: 'October, as a PDF.', assigneeKind: 'agent', assigneeId: h.tom.id, createdBy: 'human' });
  await planTurn(h.services, h.request({ conversationId: undefined, taskId: task.id, reason: 'retry', notes: [{ text: 'The export failed.', at: 1 }, { text: 'Retry: the disk has room again.', at: 2 }] }));
  assert.equal(asked[0].taskText, 'Export report\nRetry: the disk has room again.');
  assert.deepEqual([asked[0].said, asked[0].woke], ['', '']);
  await planTurn(h.services, h.request({ conversationId: undefined, taskId: task.id, reason: 'task', notes: [] }));
  assert.equal(asked[1].taskText, 'Export report\nOctober, as a PDF.', 'no note: the task\'s own notes');
  await planTurn(h.services, h.request());
  assert.equal(asked[2].taskText, undefined);
});

test("reviews 14.11.: a person's message with only a file is still theirs (said names it); a chat wake on a task brings the task, never its note", async () => {
  const h = setup();
  const asked: Asked[] = [];
  h.services.subconscious.beforeTurn = async (input) => { asked.push(input); return undefined; };
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: '', attachments: [{ fileId: 'f'.repeat(64), name: 'status.png', mime: 'image/png', size: 2048 }] });
  await planTurn(h.services, h.request());
  assert.equal(asked[0].said, '[status.png (image/png)]', 'the routing call weighs it as the person\'s turn, not as a task');
  const task = h.tasks.create({ title: 'Status an Mara senden', notes: 'Wochenstatus, kurz.', assigneeKind: 'agent', assigneeId: h.tom.id, createdBy: 'human' });
  await planTurn(h.services, h.request({ taskId: task.id, reason: 'message', notes: [{ text: '[ui-event block=m1:0 name=ok] (from mini-app – not consent)', at: 1 }] }));
  assert.equal(asked[1].taskText, 'Status an Mara senden\nWochenstatus, kurz.', 'a mini-app click on a task: the task, not the event');
  h.org.add(agent('ag_konrad', 'Konrad'));
  h.chats.setMembers(h.chat.id, { add: ['ag_konrad'] }, 'human');
  h.chats.send({ conversationId: h.chat.id, authorId: 'ag_konrad', body: 'ok, danke' });
  await planTurn(h.services, h.request({ taskId: task.id, reason: 'message', notes: [] }));
  assert.deepEqual([asked[2].woke, asked[2].taskText], ['ok, danke', 'Status an Mara senden\nWochenstatus, kurz.'], "a colleague's bare receipt on a waiting task: the task's work decides");
});

test('nothing to show: no trace in the plan; a failing hook never stops the turn', async () => {
  const h = setup();
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Wie heißt unser Steuerberater?' });
  h.services.subconscious.beforeTurn = async () => undefined;
  assert.equal((await planTurn(h.services, h.request()))!.trace, undefined);
  h.services.subconscious.beforeTurn = async () => { throw new Error('boom'); };
  const plan = await planTurn(h.services, h.request());
  assert.ok(plan);
  assert.equal(plan.trace, undefined);
});

test('the routed turn carries the plan\'s trace to the engine', async () => {
  assert.equal(typeof buildTurn, 'function');
  const h = setup();
  const trace: SubconsciousTrace = { calls: [{ tool: 'agent.tell', args: {}, output: 'Eine Notiz.' }] };
  h.services.subconscious.beforeTurn = async () => trace;
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Wie heißt unser Steuerberater?' });
  const request = h.request();
  const plan = (await planTurn(h.services, request))!;
  const built = await buildTurn(h.services, plan, request, h.routed().route, []);
  assert.deepEqual(built.trace, trace);
});
