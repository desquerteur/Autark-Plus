// F-52 tasks across people and agents: work goes to a person only in a chat they belong to; their
// For you holds only their own to-dos (not the owner's, and the owner's list not theirs); only they
// finish their work (as themselves); they delegate to agents of their spaces and hand work to the
// owner; agents hand work to them and hear back; an agent's ask goes to the person who wrote last;
// agents read a person's message as a colleague's, never as the CEO's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleRig, settle } from './rig.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';
import { authorName } from '../../../src/runtime/context/render.ts';
import { realId, viewId, viewTask } from '../../../src/runtime/people/perspective.ts';



test('an agent\'s ask goes to the person who wrote last; agents read people as colleagues', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  r.services.settings.update({ profile: { name: 'Mara' } });
  const anna = await r.join('Anna Berg', { title: 'Designer' });
  const chat = r.chats.create({ agentIds: ['ag_research'], people: [anna.person.id], createdBy: 'human', title: 'Logo' });
  await anna.client.call('messages.send', { conversationId: chat.id, body: '@Research which logo?', mentions: ['ag_research'] });
  const answer = r.chats.postAgentMessage(chat.id, 'ag_research', 'run_1', { body: 'Pick one:\n```ui\n{"type":"choice","question":"Which logo?","options":[{"label":"A"},{"label":"B"}]}\n```', state: 'final' });
  r.tasks.ingestBlocks(r.chats.message(answer.id)!, [{ type: 'choice', question: 'Which logo?', important: true, options: [{ label: 'A' }, { label: 'B' }] }]);
  const asks = await anna.client.call<TaskView[]>('todos.list');
  assert.equal(asks.length, 1, 'the ask is on Anna\'s For you');
  assert.ok(!(await r.owner.call<TaskView[]>('todos.list')).some((entry) => entry.id === asks[0].id));
  await anna.client.call('tasks.finish', { id: asks[0].id, answer: { choice: 'B' } });
  const receipt = r.chats.messages(chat.id).find((message) => message.kind === 'answer')!;
  assert.equal(receipt.authorId, anna.person.id);
  assert.equal(receipt.authorKind, 'human');
  const sent = r.chats.messages(chat.id).find((message) => message.body.startsWith('@Research'))!;
  const ctx = { services: r.services, agentId: 'ag_research', humanName: 'Mara', zone: undefined, now: 0 };
  assert.equal(authorName(ctx, sent), 'Anna Berg (colleague, Designer)');
  assert.equal(authorName(ctx, { authorId: 'human', authorKind: 'human' }), 'Mara');
});

test('perspective: ids map both ways; tasks read from the person\'s side', () => {
  assert.equal(viewId('per_aaaaaaaaaaaa', 'per_aaaaaaaaaaaa'), 'human');
  assert.equal(viewId('per_aaaaaaaaaaaa', 'human'), 'owner');
  assert.equal(viewId('per_aaaaaaaaaaaa', 'ag_x'), 'ag_x');
  assert.equal(realId('per_aaaaaaaaaaaa', 'human'), 'per_aaaaaaaaaaaa');
  assert.equal(realId('per_aaaaaaaaaaaa', 'owner'), 'human');
  const base = { id: 't', conversationId: 'c', title: 'x', notes: '', status: 'open', priority: 0, ledger: {}, attempts: 0, sort: 0, rev: 0, createdAt: 0, updatedAt: 0, steps: [], progress: { done: 0, total: 0 }, conversationTitle: '', running: false } as const;
  const owners = viewTask('per_aaaaaaaaaaaa', { ...base, assigneeKind: 'human', createdBy: 'per_aaaaaaaaaaaa' } as unknown as TaskView);
  assert.deepEqual([owners.assigneeId, owners.createdBy], ['owner', 'human']);
  const mine = viewTask('per_aaaaaaaaaaaa', { ...base, assigneeKind: 'human', assigneeId: 'per_aaaaaaaaaaaa', createdBy: 'human' } as unknown as TaskView);
  assert.deepEqual([mine.assigneeId, mine.createdBy], [undefined, 'owner']);
});

test('an agent managed by a person knows its manager as a colleague', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const anna = await r.join('Anna Berg', { title: 'Design lead' });
  r.org.update('ag_research', { managerId: anna.person.id });
  const { identityValues } = await import('../../../src/runtime/context/prompt-stable.ts');
  const values = identityValues(r.services, r.org.get('ag_research')!);
  assert.equal(values.manager_name, `Anna Berg (colleague, ${anna.person.id}) (Design lead)`);
});

test('a person gives work: to an agent of their spaces, a colleague in the chat, the owner; never another\'s task', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const anna = await r.join('Anna Berg', { scopes: { spaces: ['sp_company'], startChats: true, assignAgents: true } });
  const ben = await r.join('Ben Vogt');
  const chat = r.chats.create({ agentIds: ['ag_research'], people: [anna.person.id, ben.person.id], createdBy: 'human', title: 'Team' });
  const own = await anna.client.call<TaskView>('tasks.create', { conversationId: chat.id, title: 'Write the brief', to: 'me' });
  assert.equal(r.tasks.get(own.id)!.assigneeId, anna.person.id);
  const given = await anna.client.call<TaskView>('tasks.give', { id: own.id, to: 'ag_research' });
  assert.equal(given.assigneeId, 'ag_research');
  assert.ok(r.wakeRows().some((row) => row.agent_id === 'ag_research' && row.task_id === own.id), 'the agent hears it at once');
  await assert.rejects(anna.client.call('tasks.create', { conversationId: chat.id, title: 'x', to: 'ag_secret' }), /do not give tasks to this agent/);
  const forBen = await anna.client.call<TaskView>('tasks.create', { conversationId: chat.id, title: 'Review the brief', to: ben.person.id });
  assert.equal(forBen.assigneeId, ben.person.id);
  assert.deepEqual((await ben.client.call<TaskView[]>('todos.list')).map((entry) => entry.title), ['Review the brief']);
  await assert.rejects(ben.client.call('tasks.update', { id: given.id, patch: { title: 'mine now' } }));
  const forOwner = await anna.client.call<TaskView>('tasks.create', { conversationId: chat.id, title: 'Approve the budget', to: 'owner' });
  assert.equal(r.tasks.get(forOwner.id)!.assigneeId, undefined, 'stored as the owner\'s to-do');
  assert.ok(r.notified.some((note) => note.title?.includes('Approve the budget')), 'the owner is told');
});

test('a person finishes work an agent gave them: the agent hears how it ended', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const anna = await r.join('Anna Berg');
  const chat = r.chats.create({ agentIds: ['ag_research'], people: [anna.person.id], createdBy: 'human', title: 'Launch' });
  const task = await r.tasks.createTo({ conversationId: chat.id, title: 'Pick the colours', createdBy: 'ag_research' }, anna.person.id);
  assert.deepEqual((await anna.client.call<TaskView[]>('todos.list')).map((entry) => entry.title), ['Pick the colours']);
  const done = await anna.client.call<TaskView>('tasks.finish', { id: task.id, note: 'Blue and sand' });
  assert.equal(done.status, 'done');
  await settle();
  assert.ok(r.wakeRows().some((row) => row.agent_id === 'ag_research' && /"Pick the colours", which I gave Anna Berg, is done/.test(row.note ?? '')), 'the giver hears it');
});
