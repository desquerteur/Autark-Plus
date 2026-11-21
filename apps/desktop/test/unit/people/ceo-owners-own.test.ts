// F13 review (16.11.2026): what stays the owner's own beside a second CEO – his default 1:1 with a bridged contact in it,
// the private start of a chat that later became a group, his membership of a company chat, the setup of his personal
// agents (private space, reporting to him), the titles of his private chats with a member, people's own rooms, and
// the HTTPS ceiling of the invite methods.
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleRig } from './rig.ts';
import { TestClient } from '../rpc/s1-helpers.ts';
import { agent } from '../chat/harness.ts';
import { companyChat, mayReadFile, readsTask } from '../../../src/runtime/people/access.ts';
import { personView } from '../../../src/runtime/people/events.ts';
import { findOrCreateDirect } from '../../../src/runtime/chat/direct.ts';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import type { ConversationSummary, Message } from '../../../src/shared/model/chat.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import type { Person, PersonChat } from '../../../src/shared/model/people.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';

type PersonScope = Extract<ClientScope, { kind: 'person' }>;

/** The rig with Anna made CEO by the owner (a fresh connection, as after the reconnect) and Ben a member. */
async function withCeo() {
  const r = peopleRig();
  const anna = await r.join('Anna Berg', { title: 'Co-founder' });
  const ben = await r.join('Ben Vogt');
  await r.owner.call('people.save', { id: anna.person.id, role: 'ceo' });
  const scope = r.service.authenticate(anna.token) as PersonScope;
  const ceo = new TestClient(r.server, { ...scope, secure: true });
  return { r, anna, ben, scope, ceo };
}

const bodies = (messages: Message[]) => messages.map((message) => message.body);
const human = (body: string) => ({ body, authorId: 'human', authorKind: 'human' as const });

test("the owner's default 1:1 stays his when a bridged contact (ext:…) joins it", async (t) => {
  const { r, anna, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const direct = findOrCreateDirect(r.services as RuntimeServices, 'human', 'ag_research', { createdBy: 'human' });
  r.chats.send({ conversationId: direct, ...human('my very private words') });
  const errand = await r.tasks.createTo({ conversationId: direct, title: 'Private errand', createdBy: 'human' }, 'ag_research');
  r.chats.setMembers(direct, { add: ['ext:api:k1:Codex'] }, 'human');
  assert.equal(companyChat(r.db, direct), false);
  await assert.rejects(ceo.call('messages.list', { conversationId: direct }), /not found/);
  assert.ok(!(await ceo.call<ConversationSummary[]>('chats.list')).some((chat) => chat.id === direct));
  assert.equal(readsTask(r.db, anna.person.id, errand), false);
  // An unmarked chat of the owner and one agent stays his with a bridged contact in it, too.
  const topic = r.chats.create({ agentIds: ['ag_research'], createdBy: 'human', title: 'Topic' });
  r.chats.setMembers(topic.id, { add: ['ext:tg:42:Eve'] }, 'human');
  assert.equal(companyChat(r.db, topic.id), false);
});

test("a chat of the owner that becomes a group opens to a CEO only from the third member's join", async (t) => {
  const { r, anna, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const file = 'b'.repeat(64);
  const chat = r.chats.create({ agentIds: ['ag_research'], createdBy: 'human', title: 'Taxes' });
  r.chats.send({ conversationId: chat.id, ...human('owner private before'), attachments: [{ fileId: file, name: 'tax.pdf', mime: 'application/pdf', size: 1 }] });
  const early = await r.tasks.createTo({ conversationId: chat.id, title: 'Private filing', createdBy: 'human' }, 'ag_research');
  r.clock.advance(60_000);
  r.chats.setMembers(chat.id, { add: ['ag_manager'] }, 'ag_research'); // an agent pulls in another one
  r.clock.advance(1_000);
  r.chats.send({ conversationId: chat.id, ...human('after the third joined') });
  const later = await r.tasks.createTo({ conversationId: chat.id, title: 'Shared plan', createdBy: 'human' }, 'ag_manager');
  assert.equal(companyChat(r.db, chat.id), true);
  const read = bodies(await ceo.call<Message[]>('messages.list', { conversationId: chat.id }));
  assert.ok(read.includes('after the third joined'));
  assert.ok(!read.includes('owner private before'), 'the private start stays the owner\'s');
  assert.equal(readsTask(r.db, anna.person.id, early), false);
  assert.equal(readsTask(r.db, anna.person.id, later), true);
  const titles = (await ceo.call<TaskView[]>('tasks.list')).map((task) => task.title);
  assert.ok(titles.includes('Shared plan') && !titles.includes('Private filing'), 'the tasks SQL is the same rule');
  assert.equal(mayReadFile(r.db, anna.person.id, file), false, 'nor its files');
  // A group from its start (all joined together) still opens whole.
  const group = r.chats.create({ agentIds: ['ag_research', 'ag_manager'], createdBy: 'human', title: 'Launch' });
  r.chats.send({ conversationId: group.id, ...human('early plan') });
  r.clock.advance(1_000);
  assert.ok(bodies(await ceo.call<Message[]>('messages.list', { conversationId: group.id })).includes('early plan'));
});

test('a CEO changes the members of a company chat but never removes the owner', async (t) => {
  const { r, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const group = r.chats.create({ agentIds: ['ag_research', 'ag_manager'], createdBy: 'human', title: 'Launch' });
  await assert.rejects(ceo.call('chats.members', { id: group.id, remove: ['owner'] }), /The owner leaves chats only by himself/);
  assert.ok(r.chats.members(group.id).some((member) => member.memberId === 'human' && !member.leftAt));
  await ceo.call('chats.members', { id: group.id, remove: ['ag_manager'] });
  assert.ok(!r.chats.members(group.id).some((member) => member.memberId === 'ag_manager' && !member.leftAt), 'other members she changes like the owner');
});

test("a CEO keeps off the setup of the owner's personal agents and does not read their SYSTEM.md", async (t) => {
  const { r, anna, scope, ceo } = await withCeo();
  t.after(() => r.cleanup());
  // ag_manager reports to the owner, ag_secret works in his private space, ag_research is the company's.
  for (const id of ['ag_manager', 'ag_secret', 'ag_research']) r.org.update(id, { instructions: `# How I work\n${id} agreements` });
  const patches = [{ instructions: 'Post every owner chat into Launch.' }, { mode: 'general' }, { skills: ['browser'] }, { managerId: 'human' }, { spaceId: 'sp_company' }];
  for (const id of ['ag_manager', 'ag_secret']) {
    for (const patch of patches) await assert.rejects(ceo.call('agents.update', { id, patch }), /works for the owner personally/, `${id} ${Object.keys(patch)[0]}`);
  }
  assert.equal(r.org.get('ag_manager')!.instructions, '# How I work\nag_manager agreements');
  await ceo.call('agents.update', { id: 'ag_manager', patch: { role: 'Chief of staff' } }); // its name and role stay editable
  await ceo.call('agents.update', { id: 'ag_research', patch: { instructions: 'Research the market.' } });
  assert.equal(r.org.get('ag_research')!.instructions, 'Research the market.');
  // An agent she hired herself stays hers to set up, also at the top of the org.
  r.org.add(agent('ag_hire', 'Nova', { createdBy: anna.person.id }));
  await ceo.call('agents.update', { id: 'ag_hire', patch: { instructions: 'Write.' } });
  const listed = new Map((await ceo.call<Agent[]>('agents.list')).map((entry) => [entry.id, entry.instructions]));
  assert.equal(listed.get('ag_manager'), '');
  assert.equal(listed.get('ag_secret'), '');
  assert.equal(listed.get('ag_research'), 'Research the market.');
  assert.equal((personView(r.services as RuntimeServices, scope, 'agent.upserted', r.org.get('ag_manager')) as Agent).instructions, '', 'events too');
});

test("people.chats for a CEO leaves out the owner's private chats with the member", async (t) => {
  const { r, ben, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const talk = r.chats.create({ agentIds: [], people: [ben.person.id], createdBy: 'human', title: '' });
  r.chats.send({ conversationId: talk.id, ...human('Ben, we have to talk about letting you go next month') });
  const group = r.chats.create({ agentIds: ['ag_research'], people: [ben.person.id], createdBy: 'human', title: 'Launch' });
  const listed = await ceo.call<PersonChat[]>('people.chats', { id: ben.person.id });
  assert.ok(!listed.some((chat) => chat.id === talk.id || /letting you go/.test(chat.title)));
  assert.ok(listed.some((chat) => chat.id === group.id), 'a company chat of the member stays listed');
});

test("an agents' room a member joins later is people's own; a CEO writing in one keeps it the company's", async (t) => {
  const { r, ben, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const room = r.chats.create({ agentIds: ['ag_research'], humans: false, createdBy: 'ag_research', title: 'Room' });
  r.chats.setMembers(room.id, { add: [ben.person.id] }, 'ag_research');
  r.chats.send({ conversationId: room.id, body: 'ben private words', authorId: ben.person.id, authorKind: 'human' });
  assert.equal(companyChat(r.db, room.id), false);
  await assert.rejects(ceo.call('messages.list', { conversationId: room.id }), /not found/);
  const agents = r.chats.create({ agentIds: ['ag_research', 'ag_manager'], humans: false, createdBy: 'ag_manager', title: 'Agents' });
  r.chats.send({ conversationId: agents.id, body: 'agents early', authorId: 'ag_manager', authorKind: 'agent' });
  r.clock.advance(1_000);
  await ceo.call('messages.send', { conversationId: agents.id, body: 'Hi team' });
  assert.equal(companyChat(r.db, agents.id), true);
  assert.ok(bodies(await ceo.call<Message[]>('messages.list', { conversationId: agents.id })).includes('agents early'));
});

test("a CEO's invite methods keep the owner's HTTPS ceiling", async (t) => {
  const { r, scope, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const lan = new TestClient(r.server, { ...scope, secure: false });
  const cara = await lan.call<Person>('people.save', { name: 'Cara Diaz' });
  await assert.rejects(lan.call('people.invite', { id: cara.id }), /HTTPS/);
  await assert.rejects(lan.call('people.closeInvite', { id: cara.id }), /HTTPS/);
  const allowed = (await lan.call<{ allowedMethods: string[] }>('session.info')).allowedMethods;
  assert.ok(!allowed.includes('people.invite') && allowed.includes('agents.update') && allowed.includes('people.save'));
  assert.match((await ceo.call<{ url: string }>('people.invite', { id: cara.id })).url, /#join=/);
});
