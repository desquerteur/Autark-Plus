// The new task system end to end on the chat harness: the four commands (tools/builtin/tasks.ts), the one give path
// (tasks/give.ts – the receiver told at once, the giver hearing the end, "team" picked now), waits and the person's line,
// pause and resume, pieces waking their task's owner, and the watcher (tasks/watch.ts – a due look wakes once and is
// set forward, a person's work an agent gave wakes that agent when stuck, a snooze's end opens the to-do).
// Owns: these assertions only. Never: real engines or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { PAUSED_REASON } from '../../../src/shared/model/tasks.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';
import { taskTools } from '../../../src/runtime/tools/builtin/tasks.ts';
import { buildVolatile } from '../../../src/runtime/context/prompt-volatile.ts';
import { agent, harness } from '../chat/harness.ts';

const DAY = 24 * 3600_000;

function setup() {
  const h = harness();
  h.org.add(agent('ag_ida', 'Ida', { role: 'QA' }));
  h.org.add(agent('ag_jonas', 'Jonas', { role: 'Dev' }));
  const chat = h.chats.create({ agentIds: ['ag_ida'], createdBy: HUMAN_ID });
  const ctx = (agentId = 'ag_ida', taskId?: string): ToolContext => ({
    agent: h.org.get(agentId)!, runId: 'run_1', conversationId: chat.id, mode: 'general', ...(taskId ? { taskId } : {}),
    services: h.services as RuntimeServices, signal: new AbortController().signal, status: () => {},
  });
  const run = async (name: string, args: Record<string, unknown>, context: ToolContext) => {
    const out = await taskTools.find((tool) => tool.name === name)!.run(args as never, context);
    const text = String((out.content[0] as { text?: string }).text);
    try { return JSON.parse(text); } catch { return text; }
  };
  const wakesOf = (agentId: string) => h.wakeRows().filter((row) => row.agent_id === agentId);
  return { ...h, chat, ctx, run, wakesOf };
}

test('four commands are offered directly; the descriptions start verb-first and stand alone', () => {
  for (const tool of taskTools) {
    const first = tool.description.split(/(?<=\.) /)[0];
    assert.ok(first.length <= 90, `${tool.name}: "${first}" is ${first.length} characters`);
    assert.match(first, /^[A-Z][a-z]+s /, `${tool.name} starts verb-first`);
  }
  assert.deepEqual(taskTools.map((tool) => tool.name), ['tasks.create', 'tasks.give', 'tasks.update', 'tasks.finish', 'tasks.list', 'tasks.get']);
});

test('tasks.create to a colleague: they hear it at once, it is a piece of my task, it stands under "Given by me"', async () => {
  const h = setup();
  const mine = h.tasks.create({ conversationId: h.chat.id, title: 'Montagstest', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID });
  const out = await h.run('tasks.create', { title: 'Login-Bug nachstellen', to: 'Jonas', doneWhen: 'Der Bug ist reproduziert' }, h.ctx('ag_ida', mine.id));
  assert.equal(out.owner, 'Jonas (ag_jonas)');
  const piece = h.tasks.get(out.taskId)!;
  assert.equal(piece.parentId, mine.id);
  const wake = h.wakesOf('ag_jonas').find((row) => row.task_id === piece.id);
  assert.equal(wake?.reason, 'task');
  assert.match(wake?.note ?? '', /^Ida gave me "Login-Bug nachstellen"\./);
  assert.equal(h.tasks.get(mine.id)!.status, 'open', 'giving a piece holds my own task back in nothing');
  const live = buildVolatile(h.services as RuntimeServices, { agent: h.org.get('ag_ida')!, route: {} as never });
  assert.match(live, /## Given by me\n- task_\S+ · Jonas · open · Login-Bug nachstellen · piece of /);
});

test('the giver hears the end with what it asked; a piece\'s end wakes the owner of its task', async () => {
  const h = setup();
  const mine = h.tasks.create({ conversationId: h.chat.id, title: 'Montagstest', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID });
  const out = await h.run('tasks.create', { title: 'Testdaten', to: 'ag_jonas', doneWhen: 'Zehn Konten' }, h.ctx('ag_ida', mine.id));
  await h.run('tasks.finish', { taskId: out.taskId, status: 'done', summary: 'Zehn Konten angelegt' }, h.ctx('ag_jonas', out.taskId));
  const wake = h.wakesOf('ag_ida').find((row) => row.task_id === mine.id && /a piece of my task/.test(row.note ?? ''));
  assert.ok(wake, 'Ida is woken on her own task');
  assert.match(wake!.note ?? '', /Jonas finished \(claimed, not checked yet\) "Testdaten", a piece of my task "Montagstest"\.\nI had asked: Zehn Konten\nResult: Zehn Konten angelegt/);
});

test('asking the person is a task for them: a widget without to goes to the person, the same open ask comes back once', async () => {
  const h = setup();
  const ask = { title: 'Welche Geräte?', widget: { type: 'choice', options: ['PC', 'Android'] } };
  const first = await h.run('tasks.create', ask, h.ctx());
  assert.match(first.owner, / \(human\)$/);
  const todo = h.tasks.get(first.taskId)!;
  assert.equal(todo.assigneeKind, 'human');
  assert.equal(todo.widget?.question, 'Welche Geräte?');
  assert.ok(h.notified.some((note) => note.kind === 'todo' && note.taskId === todo.id), 'the person is told');
  const again = await h.run('tasks.create', ask, h.ctx());
  assert.deepEqual([again.taskId, again.already], [todo.id, true]);
});

test('a wait on the person: their line in the task\'s chat opens it; a pause holds until they resume', async () => {
  const h = setup();
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Handy-Test', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID });
  const out = await h.run('tasks.update', { status: 'waiting', on: 'who', who: 'human', why: '7:30 oder nachmittags?' }, h.ctx('ag_ida', task.id));
  assert.equal(out.status, 'waiting');
  assert.match(out.next, /^when .* answers \(I look again /);
  h.chats.send({ conversationId: h.chat.id, body: 'Nachmittags, 15 Uhr.', authorId: HUMAN_ID });
  assert.equal(h.tasks.get(task.id)!.status, 'open');
  h.tasks.pause(task.id, HUMAN_ID);
  const paused = h.tasks.get(task.id)!;
  assert.deepEqual([paused.status, paused.waitingOn?.why, paused.nextAt], ['waiting', PAUSED_REASON, undefined]);
  h.tasks.update(task.id, { status: 'open' }, HUMAN_ID);
  assert.equal(h.tasks.get(task.id)!.status, 'open');
});

test('tasks.give: to "me" takes it; the new owner hears of it; the note lands in its notes', async () => {
  const h = setup();
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Release-Notes', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID });
  const out = await h.run('tasks.give', { taskId: task.id, to: 'Jonas', note: 'Die Liste liegt in notes/release.md' }, h.ctx('ag_ida', task.id));
  assert.equal(out.owner, 'Jonas (ag_jonas)');
  const given = h.tasks.get(task.id)!;
  assert.equal(given.assignedBy, 'ag_ida');
  assert.match(given.notes, /From Ida: Die Liste liegt in notes\/release\.md$/);
  assert.ok(h.wakesOf('ag_jonas').some((row) => row.task_id === task.id && /Ida gave me "Release-Notes"/.test(row.note ?? '')));
  const back = await h.run('tasks.give', { taskId: task.id, to: 'me' }, h.ctx('ag_ida'));
  assert.equal(back.owner, 'me');
});

test('"team" with no decision model: the giver keeps it when no manager exists', async () => {
  const h = setup();
  const out = await h.run('tasks.create', { title: 'Pakete zur Post', to: 'team' }, h.ctx());
  assert.equal(out.owner, 'me');
});

test('the watcher: a due look wakes its agent once under the task key and sets the look forward', () => {
  const h = setup();
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Wochenbericht', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: 'ag_ida' });
  h.db.run('DELETE FROM wakes');
  h.clock.advance(1000);
  assert.equal(h.ownership.pass(), 1);
  const wakes = h.wakesOf('ag_ida');
  assert.equal(wakes.length, 1);
  assert.match(wakes[0].note ?? '', /^I go on with my task "Wochenbericht"\./);
  assert.ok(h.tasks.get(task.id)!.nextAt! > h.clock.now(), 'the look moved forward');
  assert.equal(h.ownership.pass(), 0, 'no second wake');
});

test('the watcher: a person\'s work an agent gave them wakes that agent when nothing moved for two days', () => {
  const h = setup();
  const todo = h.tasks.create({ conversationId: h.chat.id, title: 'Vertrag unterschreiben', assigneeKind: 'human', createdBy: 'ag_ida' });
  assert.ok(todo.nextAt !== undefined);
  h.db.run('DELETE FROM wakes');
  h.clock.advance(2 * DAY + 1000);
  h.ownership.pass();
  const wake = h.wakesOf('ag_ida').find((row) => /^"Vertrag unterschreiben", which I gave .*, has not moved since /.test(row.note ?? ''));
  assert.ok(wake, 'Ida is woken');
  assert.deepEqual([wake!.task_id, wake!.conversation_id, wake!.reason], [null, h.chat.id, 'retry'], 'in the chat she gave it from, never on the person task');
});

test('the watcher: stuck person work given from my task wakes me on that task', () => {
  const h = setup();
  const mine = h.tasks.create({ conversationId: h.chat.id, title: 'Vertrieb', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID });
  h.tasks.create({ conversationId: h.chat.id, title: 'Angebot freigeben', assigneeKind: 'human', createdBy: 'ag_ida', parentId: mine.id });
  h.db.run('DELETE FROM wakes');
  h.clock.advance(2 * DAY + 1000);
  h.ownership.pass();
  const wake = h.wakesOf('ag_ida').find((row) => /^"Angebot freigeben", which I gave/.test(row.note ?? ''));
  assert.equal(wake?.task_id, mine.id);
});

test('an archived owner with no successor: the person hears it once, however often the watcher looks', () => {
  const h = setup();
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Rechnungen', assigneeKind: 'agent', assigneeId: 'ag_jonas', createdBy: HUMAN_ID });
  h.org.get('ag_jonas')!.archivedAt = h.clock.now();
  h.db.run('DELETE FROM wakes');
  for (let pass = 0; pass < 3; pass++) { h.clock.advance(3 * DAY); h.ownership.pass(); }
  const blockers = h.notified.filter((note) => note.kind === 'blocker' && note.taskId === task.id);
  assert.equal(blockers.length, 1);
  const after = h.tasks.get(task.id)!;
  assert.deepEqual([after.status, after.waitingOn?.who], ['waiting', HUMAN_ID]);
  assert.ok(after.nextAt! > h.clock.now(), 'its next look is planned');
});

test('a wait on a colleague ends with their line – in the task chat or in our 1:1', async () => {
  const h = setup();
  const room = h.chats.create({ agentIds: ['ag_ida', 'ag_jonas'], createdBy: HUMAN_ID });
  const direct = h.chats.create({ agentIds: ['ag_ida', 'ag_jonas'], createdBy: HUMAN_ID, settings: { direct: true } });
  const here = h.tasks.create({ conversationId: room.id, title: 'Build prüfen', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID });
  h.tasks.update(here.id, { status: 'waiting', waitingOn: { on: 'who', who: 'ag_jonas', why: 'Build-Nummer' } }, 'ag_ida');
  h.chats.send({ conversationId: room.id, body: 'Build 412.', authorId: 'ag_jonas', authorKind: 'agent' });
  assert.equal(h.tasks.get(here.id)!.status, 'open', 'his line in the task chat');
  const elsewhere = h.tasks.create({ conversationId: h.chat.id, title: 'Release-Datum', assigneeKind: 'agent', assigneeId: 'ag_ida', createdBy: HUMAN_ID });
  h.tasks.update(elsewhere.id, { status: 'waiting', waitingOn: { on: 'who', who: 'ag_jonas', why: 'Datum' } }, 'ag_ida');
  h.chats.send({ conversationId: direct.id, body: 'Freitag.', authorId: 'ag_jonas', authorKind: 'agent' });
  assert.equal(h.tasks.get(elsewhere.id)!.status, 'open', 'his line in our 1:1');
});

test('a piece end merged into a queued task wake keeps the piece rank (child wins)', () => {
  const h = setup();
  h.wakes.wake({ agentId: 'ag_ida', reason: 'task', coalesceKey: 'task:task_x', note: 'go on' });
  h.wakes.wake({ agentId: 'ag_ida', reason: 'child', coalesceKey: 'task:task_x', note: 'a piece ended' });
  assert.deepEqual(h.wakesOf('ag_ida').map((row) => row.reason), ['child']);
});

test('the watcher: a snooze whose until passed is open again', () => {
  const h = setup();
  const todo = h.tasks.create({ title: 'Zahnarzt anrufen', assigneeKind: 'human', createdBy: HUMAN_ID });
  h.tasks.update(todo.id, { status: 'waiting', waitingOn: { on: 'outside', why: 'Snoozed', until: h.clock.now() + 3600_000 } }, HUMAN_ID);
  h.clock.advance(3600_000 + 1000);
  h.ownership.pass();
  assert.equal(h.tasks.get(todo.id)!.status, 'open');
});
