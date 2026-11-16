// F13 (owner 15.11.2026: "zwei CEOs … über den Managern"): a person with the role 'ceo' works like the owner – every
// company chat from its start, every agent and space, the company's tasks, hiring and editing agents, adding and removing
// members – but never the owner's own 1:1s, plan accounts, keys, secrets or Settings; a member stays as before, every
// device of a CEO carries the role in its scope, and nothing changes for the owner.
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { peopleRig, settle } from './rig.ts';
import { TestClient } from '../rpc/s1-helpers.ts';
import { agent } from '../chat/harness.ts';
import { clock, memoryDb, recordingBus, RESOURCES } from '../store/helpers.ts';
import { createHandlerTable } from '../../../src/runtime/rpc/handlers/index.ts';
import { register as notes } from '../../../src/runtime/rpc/handlers/notes.ts';
import { allowedScope } from '../../../src/runtime/rpc/table.ts';
import { companyChat, isCeo, readsTask } from '../../../src/runtime/people/access.ts';
import { personRights } from '../../../src/runtime/people/events.ts';
import { PersonTokens } from '../../../src/runtime/people/tokens.ts';
import { Org } from '../../../src/runtime/org/service.ts';
import { identityValues } from '../../../src/runtime/context/prompt-stable.ts';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import type { ConversationSummary, Message } from '../../../src/shared/model/chat.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import type { Person } from '../../../src/shared/model/people.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';

type PersonScope = Extract<ClientScope, { kind: 'person' }>;

/** The rig with Anna made CEO by the owner (a fresh connection, as after the reconnect) and Ben a member. */
async function withCeo() {
  const r = peopleRig({ modules: [notes] });
  const anna = await r.join('Anna Berg', { title: 'Co-founder' });
  const ben = await r.join('Ben Vogt');
  await r.owner.call('people.save', { id: anna.person.id, managerId: 'human' });
  const saved = await r.owner.call<Person>('people.save', { id: anna.person.id, role: 'ceo' });
  const scope = r.service.authenticate(anna.token) as PersonScope;
  const ceo = new TestClient(r.server, { ...scope, secure: true });
  return { r, anna, ben, saved, scope, ceo };
}

const CEO_ONLY = ['agents.archive', 'agents.create', 'agents.restore', 'agents.templates', 'agents.update',
  'people.audit', 'people.chats', 'people.closeInvite', 'people.invite', 'people.remove', 'people.removeDevice', 'people.revoke', 'people.save'];

test('the owner makes a person CEO: top of the org, every space, and their device scope carries the role', async (t) => {
  const { r, anna, ben, saved, scope } = await withCeo();
  t.after(() => r.cleanup());
  assert.equal(saved.role, 'ceo');
  assert.equal(saved.managerId, undefined, 'a new CEO sits at the top (she reported to the owner before)');
  assert.deepEqual(saved.scopes, { spaces: 'all', startChats: true, assignAgents: true });
  assert.equal(scope.role, 'ceo');
  assert.equal((r.service.authenticate(ben.token) as PersonScope).role, 'member', 'a member stays a member');
  assert.equal(r.service.require('human').role, 'ceo', "the owner's own row is CEO");
  assert.notEqual(personRights({ ...saved, role: 'member' }), personRights(saved), 'the role is part of the rights key: her open app reconnects');
  assert.equal(anna.person.role, 'member', 'a new person is a member');
  // A phone paired for her later (pwa/service.ts pairPhone issues a person token) gets the CEO scope too.
  const phone = new PersonTokens(r.db, r.clock).issue(anna.person.id, "Anna's phone");
  assert.equal((r.service.authenticate(phone.token) as PersonScope).role, 'ceo');
  // Demoted again: the role goes, the next token check says member.
  await r.owner.call('people.save', { id: anna.person.id, role: 'member' });
  assert.equal((r.service.authenticate(phone.token) as PersonScope).role, 'member');
  assert.equal(isCeo(r.db, anna.person.id), false);
});

test('session.info: a CEO gets exactly the CEO methods more than a member – never accounts, keys, secrets or Settings', async (t) => {
  const { r, ceo, ben } = await withCeo();
  t.after(() => r.cleanup());
  const info = await ceo.call<{ allowedMethods: string[]; person: { role: string } }>('session.info');
  const member = await ben.client.call<{ allowedMethods: string[]; person: { role: string } }>('session.info');
  assert.equal(info.person.role, 'ceo');
  assert.equal(member.person.role, 'member');
  assert.deepEqual(info.allowedMethods.filter((method) => !member.allowedMethods.includes(method)).sort(), CEO_ONLY);
  await assert.rejects(ben.client.call('people.save', { name: 'Eve' }), /not allowed/, 'a member stays as today');
  await assert.rejects(ben.client.call('agents.create', { name: 'Eve' }), /not allowed/);
  // The whole table: a CEO's scope reaches person variants only – no plan accounts, keys, secrets, Settings or devices.
  const table = createHandlerTable();
  const ceoScope: PersonScope = { kind: 'person', personId: 'per_aaaaaaaa', deviceId: 'd', tokenId: 't', secure: true, role: 'ceo' };
  for (const method of ['accounts.list', 'accounts.add', 'accounts.login', 'secrets.list', 'secrets.save', 'secrets.export', 'secrets.capture',
    'spend.list', 'settings.get', 'settings.update', 'remote.state', 'remote.decide', 'devices.list', 'pwa.state', 'phone.pairLink', 'models.setPolicy', 'feedback.inboxList']) {
    const entry = table.get(method);
    if (!entry) continue; // a method this build does not have
    if (method === 'settings.get') { assert.ok(allowedScope(entry.scope, ceoScope), 'settings.get answers defaults with their name (personSettings)'); continue; }
    assert.equal(allowedScope(entry.scope, ceoScope), false, method);
  }
  for (const method of CEO_ONLY) {
    assert.ok(allowedScope(table.get(method)!.scope, ceoScope), method);
    assert.equal(allowedScope(table.get(method)!.scope, { ...ceoScope, role: 'member' }), false, `${method}: member`);
    assert.equal(allowedScope(table.get(method)!.scope, { kind: 'device', deviceId: 'phone', capabilities: ['todo', 'chat', 'tasks', 'settings', 'manage'], secure: true }),
      method.startsWith('agents.') || method === 'people.invite' || method === 'people.closeInvite', `${method}: the owner's phone keeps its own tier`);
  }
  const settings = await ceo.call<{ profile: { name: string } }>('settings.get');
  assert.equal(settings.profile.name, 'Anna Berg', "never the owner's setup");
});

test("a CEO reads every company chat from its start – never the owner's 1:1s or people's own chats", async (t) => {
  const { r, anna, ben, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const group = r.chats.create({ agentIds: ['ag_research', 'ag_manager'], createdBy: 'human', title: 'Launch' });
  r.chats.send({ conversationId: group.id, body: 'early plan', authorId: 'human', authorKind: 'human' });
  const room = r.chats.create({ agentIds: ['ag_manager', 'ag_secret'], humans: false, createdBy: 'ag_manager', title: 'Agents room' });
  const ownerDirect = r.chats.create({ agentIds: ['ag_research'], createdBy: 'human', title: '' });
  r.chats.send({ conversationId: ownerDirect.id, body: 'private note', authorId: 'human', authorKind: 'human' });
  const ownerBen = r.chats.create({ agentIds: [], people: [ben.person.id], createdBy: 'human', title: 'Ben and me' });
  const bens = r.chats.create({ agentIds: ['ag_research'], humans: false, people: [ben.person.id], createdBy: ben.person.id, title: "Ben's" });
  const theirs = r.chats.create({ agentIds: [], people: [anna.person.id], createdBy: 'human', title: 'Anna and me' });

  assert.equal(companyChat(r.db, group.id), true);
  assert.equal(companyChat(r.db, room.id), true, 'an agents-only room');
  for (const chat of [ownerDirect, ownerBen, bens, theirs]) assert.equal(companyChat(r.db, chat.id), false, chat.title || 'the owner\'s 1:1');
  const titles = (await ceo.call<ConversationSummary[]>('chats.list')).map((chat) => chat.title).sort();
  assert.deepEqual(titles, ['Agents room', 'Anna and me', 'Launch'], 'company chats and her own – no 1:1 of the owner, no people\'s chat');
  assert.deepEqual((await ben.client.call<ConversationSummary[]>('chats.list')).map((chat) => chat.title).sort(), ['Ben and me', "Ben's"], 'a member: their own only');
  const history = await ceo.call<Message[]>('messages.list', { conversationId: group.id });
  assert.ok(history.some((message) => message.body === 'early plan'), 'from the chat\'s start');
  await assert.rejects(ceo.call('messages.list', { conversationId: ownerDirect.id }), /not found/);
  await assert.rejects(ceo.call('chats.get', { id: bens.id }), /not found/);
  await ceo.call('notes.get', { conversationId: group.id });
  await assert.rejects(ceo.call('notes.get', { conversationId: ownerDirect.id }), /Only people in this chat/);

  // Events: she hears the company chat, never the owner's 1:1.
  await ceo.call('events.subscribe', { topics: ['chats', `chat:${group.id}`, `chat:${ownerDirect.id}`] });
  r.chats.send({ conversationId: group.id, body: 'news for everyone', authorId: 'human', authorKind: 'human' });
  r.chats.send({ conversationId: ownerDirect.id, body: 'still private', authorId: 'human', authorKind: 'human' });
  await settle();
  const heard = ceo.events('message.created').map((frame) => (frame.data as Message).body);
  assert.ok(heard.includes('news for everyone'));
  assert.ok(!heard.includes('still private'));
  assert.ok(!ceo.events('conversation.upserted').some((frame) => (frame.data as ConversationSummary).id === ownerDirect.id));

  // Writing in a company chat she is not in makes her a member first; she changes its members like the owner.
  const sent = await ceo.call<Message>('messages.send', { conversationId: group.id, body: 'I am on it' });
  assert.equal(sent.authorId, 'human', 'her own line, in her view');
  assert.ok(r.chats.members(group.id).some((member) => member.memberId === anna.person.id && !member.leftAt));
  await ceo.call('chats.members', { id: group.id, add: [ben.person.id] });
  assert.ok(r.chats.members(group.id).some((member) => member.memberId === ben.person.id));
  await assert.rejects(ben.client.call('chats.members', { id: group.id, add: ['ag_secret'] }), /Only the one who started this chat/, 'a member still may not');
});

test("a CEO reads and changes the company's work – never the owner's own to-dos or a task of the owner's 1:1", async (t) => {
  const { r, anna, ben, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const group = r.chats.create({ agentIds: ['ag_research', 'ag_manager'], createdBy: 'human', title: 'Launch' });
  const ownerDirect = r.chats.create({ agentIds: ['ag_research'], createdBy: 'human', title: '' });
  const inGroup = await r.tasks.createTo({ conversationId: group.id, title: 'Draft the launch post', createdBy: 'human' }, 'ag_research');
  const inDirect = await r.tasks.createTo({ conversationId: ownerDirect.id, title: 'Private errand', createdBy: 'human' }, 'ag_research');
  const agentsOwn = await r.tasks.createTo({ title: 'Clean the notes', createdBy: 'ag_manager' }, 'ag_manager');
  const ownersTodo = await r.tasks.createTo({ title: 'Sign the contract', createdBy: 'ag_manager' }, 'human');
  assert.equal(readsTask(r.db, anna.person.id, inGroup), true);
  assert.equal(readsTask(r.db, anna.person.id, agentsOwn), true);
  assert.equal(readsTask(r.db, anna.person.id, inDirect), false);
  assert.equal(readsTask(r.db, anna.person.id, ownersTodo), false);
  assert.equal(readsTask(r.db, ben.person.id, inGroup), false, 'a member: only their own');
  const listed = (await ceo.call<TaskView[]>('tasks.list')).map((task) => task.title).sort();
  assert.deepEqual(listed, ['Clean the notes', 'Draft the launch post'], 'the SQL rule is the same rule');
  await assert.rejects(ceo.call('tasks.get', { id: inDirect.id }), /not found/i);
  // Gives work to every agent – the private space's too – and changes work that is not hers.
  const given = await ceo.call<TaskView>('tasks.create', { conversationId: group.id, title: 'Plan the budget', to: 'ag_secret' });
  assert.equal(r.tasks.get(given.id)!.assigneeId, 'ag_secret');
  const renamed = await ceo.call<TaskView>('tasks.update', { id: inGroup.id, patch: { title: 'Draft the launch posts' } });
  assert.equal(renamed.title, 'Draft the launch posts');
  await assert.rejects(ben.client.call('tasks.update', { id: inGroup.id, patch: { title: 'x' } }));
  const done = await ceo.call<TaskView>('tasks.finish', { id: agentsOwn.id, note: 'Not needed' });
  assert.equal(done.status, 'done');
});

test('a CEO hires, edits and archives agents and sees them whole; a person manager is set right after the hire', async (t) => {
  const { r, anna, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const hires: Array<Record<string, unknown>> = [];
  const archived: Array<[string, unknown]> = [];
  Object.assign(r.org, {
    templates: () => [{ key: 'writer', name: 'Writer', role: 'Writer' }],
    create: (input: Record<string, unknown>) => {
      hires.push(input);
      return r.org.add(agent('ag_new', String(input.name), { createdBy: String(input.createdBy), ...(input.managerId ? { managerId: String(input.managerId) } : {}) }));
    },
    archive: (id: string, options: unknown) => { archived.push([id, options]); },
  });
  r.org.update('ag_research', { instructions: '# How I work\nQuietly.' });
  r.org.update('ag_secret', { instructions: '# How I work\nPrivately.' });
  const listed = await ceo.call<Agent[]>('agents.list');
  assert.ok(listed.some((entry) => entry.id === 'ag_research' && entry.instructions.includes('Quietly')), 'every agent, with its setup to edit');
  assert.ok(listed.some((entry) => entry.id === 'ag_secret' && entry.instructions === ''), "the owner's private space's agent without its SYSTEM.md");
  assert.equal((await ceo.call<unknown[]>('agents.templates')).length, 1);
  const hired = await ceo.call<Agent>('agents.create', { name: 'Nova', managerId: 'human' });
  assert.equal(hires[0].createdBy, anna.person.id, 'hired by her');
  assert.equal(hires[0].managerId, undefined, 'a hire names agents only');
  assert.equal(r.org.get('ag_new')!.managerId, anna.person.id, 'then placed under her');
  assert.equal(hired.managerId, 'human', 'in her view: under her');
  assert.equal(hired.createdBy, 'human');
  const moved = await ceo.call<Agent>('agents.update', { id: 'ag_new', patch: { managerId: 'owner', role: 'Editor' } });
  assert.equal(r.org.get('ag_new')!.managerId, 'human', "'owner' in her view is the owner");
  assert.equal(moved.managerId, 'owner');
  await ceo.call('agents.archive', { id: 'ag_research' });
  assert.deepEqual(archived, [['ag_research', { by: anna.person.id }]]);
});

test("a CEO adds, edits, invites and removes members – never the owner's row, another CEO's or a role", async (t) => {
  const { r, anna, ben, ceo } = await withCeo();
  t.after(() => r.cleanup());
  const people = await ceo.call<Person[]>('people.list');
  assert.ok(people.some((person) => person.id === 'owner' && person.owner), 'the owner as "owner"');
  assert.ok(people.some((person) => person.id === 'human' && person.role === 'ceo'), 'herself as "human"');
  assert.ok(people.find((person) => person.id === ben.person.id)?.devices?.length, 'members whole, devices too');
  const cara = await ceo.call<Person>('people.save', { name: 'Cara Diaz', managerId: 'human' });
  assert.equal(r.service.require(cara.id).managerId, anna.person.id, "'human' in her view is her");
  assert.equal(r.service.audit(cara.id)[0].actor, anna.person.id, 'the audit names her');
  const invite = await ceo.call<{ url: string }>('people.invite', { id: cara.id });
  assert.match(invite.url, /#join=/);
  await ceo.call('people.remove', { id: cara.id });
  assert.equal(r.service.get(cara.id), undefined);
  await ceo.call('people.save', { id: ben.person.id, title: 'Designer' });
  assert.equal(r.service.require(ben.person.id).title, 'Designer');
  await assert.rejects(ceo.call('people.save', { id: ben.person.id, role: 'ceo' }), /gives and takes the CEO role/);
  await assert.rejects(ceo.call('people.save', { id: 'owner', title: 'x' }), /changes the CEOs/);
  await assert.rejects(ceo.call('people.save', { id: 'human', title: 'x' }), /changes the CEOs/, 'not her own row either');
  await assert.rejects(ceo.call('people.revoke', { id: 'owner' }), /changes the CEOs/);
  const revoked = await ceo.call<Person>('people.revoke', { id: ben.person.id });
  assert.equal(revoked.status, 'revoked');
  assert.equal(r.service.audit(ben.person.id)[0].actor, anna.person.id);
});

test('the owner is unchanged; identity names the other CEO and agents work for both', async (t) => {
  const { r, anna } = await withCeo();
  t.after(() => r.cleanup());
  const all = await r.owner.call<Person[]>('people.list');
  assert.equal(all.find((person) => person.id === anna.person.id)?.role, 'ceo');
  const values = identityValues(r.services, r.org.get('ag_research')!);
  assert.equal(values.ceos, `Anna Berg (${anna.person.id})`);
  r.org.update('ag_research', { managerId: anna.person.id });
  assert.match(identityValues(r.services, r.org.get('ag_research')!).manager_name, /^Anna Berg \(CEO, per_/);
});

test('a human hire: the owner or a CEO person hires as the person does (no agent creator check)', () => {
  const org = new Org({ db: memoryDb(), bus: recordingBus().bus, clock: clock(), templatesDir: path.join(RESOURCES, 'agents') });
  const ava = org.create({ name: 'Ava', createdBy: 'per_aaaaaaaaaa' });
  assert.equal(ava.createdBy, 'per_aaaaaaaaaa');
  assert.equal(ava.managerId, undefined, 'at the top, as an owner hire');
  assert.throws(() => org.create({ name: 'Bo', createdBy: 'ag_missing' }), /not found|no longer/i, 'an agent creator still has to exist');
});
