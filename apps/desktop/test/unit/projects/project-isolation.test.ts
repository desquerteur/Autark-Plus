// AF-026 – project isolation, a one-way street (runtime/projects/isolation.ts and its gates): an agent in a project
// reaches only its project's agents (and the person) – by chat.send, chat.direct, chat.create, chat.add_members,
// agents.delegate, tasks.create / tasks.assign, agents.list and its own wf (RPC); an agent outside every project reaches
// project agents as before; a project agent answers an outsider in the chat the outsider (or the person) started – and a
// thread on its message – but never in a chat started inside; project A never reaches project B; the person is free.
// Owns: these assertions only. Never: real engines, timers, folders of the person or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ToolContext, ToolDef } from '../../../src/runtime/tools/types.ts';
import { chatTools } from '../../../src/runtime/tools/builtin/chat.ts';
import { chatTreeTools } from '../../../src/runtime/tools/builtin/chat-tree.ts';
import { agentTools } from '../../../src/runtime/tools/builtin/agents.ts';
import { taskTools } from '../../../src/runtime/tools/builtin/tasks.ts';
import { Registry } from '../../../src/runtime/tools/registry.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { PROJECTS_NS, projectId } from '../../../src/runtime/projects/service.ts';
import { mayReach, postRefusal, projectOfAgent, reachRefusal } from '../../../src/runtime/projects/isolation.ts';
import { boundarySectionText, projectBoundarySection } from '../../../src/runtime/projects/boundary-prompt.ts';
import { namedIds } from '../../../src/runtime/rpc/project-gate.ts';
import { buildTree } from '../../../src/runtime/org/tree.ts';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import { agent, harness } from '../chat/harness.ts';
import { OWNER, TestClient, rpcFixture } from '../rpc/s1-helpers.ts';

const SHOP = path.resolve('af026-projects', 'shop');
const BLOG = path.resolve('af026-projects', 'blog');
const TOOLS: ToolDef[] = [...chatTools, ...chatTreeTools, ...agentTools, ...taskTools];

/** Ava and Ben work in "shop", Cy in "blog", Dan in no project (the fake org gets the bits agents.list and agents.org read). */
function place(services: RuntimeServices, org: { add(agent: Agent): void; list(): Agent[] }) {
  Object.assign(org, { spaces: () => [], tree: () => buildTree(org.list()) });
  org.add(agent('ag_ava', 'Ava'));
  org.add(agent('ag_ben', 'Ben'));
  org.add(agent('ag_cy', 'Cy'));
  org.add(agent('ag_dan', 'Dan'));
  const homes = new Map([['ag_ava', SHOP], ['ag_ben', SHOP], ['ag_cy', BLOG]]);
  Object.assign(services, { agentCore: { homes: { stored: (id: string) => homes.get(id) } }, devices: { self: () => ({ id: 'dev_self', name: 'This PC' }), list: () => [] } });
  return homes;
}

function setup() {
  const h = harness();
  Object.assign(h.services, { settings: { get: () => ({ profile: { name: 'Sam', timezone: 'UTC' } }) }, people: { nameOf: () => undefined, get: () => undefined } });
  const homes = place(h.services as RuntimeServices, h.org);
  const run = async (name: string, args: Record<string, unknown>, agentId: string) => {
    const ctx = {
      agent: h.org.get(agentId)!, runId: '', mode: 'general',
      services: h.services as RuntimeServices, signal: new AbortController().signal, status: () => {},
    } as ToolContext;
    let text: string;
    let failed: boolean;
    try {
      const out = await TOOLS.find((item) => item.name === name)!.run(args as never, ctx);
      text = (out.content[0] as { text: string }).text;
      failed = out.isError === true;
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
      failed = true;
    }
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* a plain line */ }
    return { failed, text, data, chatId: data.chatId as string };
  };
  const posts = (chatId: string) => h.chats.messages(chatId).filter((m) => m.kind !== 'status');
  return { ...h, homes, run, posts };
}

const OUTSIDE = /outside my project "shop"/;

test('the rule: who is in which project, and who reaches whom', () => {
  const h = setup();
  const s = h.services as RuntimeServices;
  assert.deepEqual(projectOfAgent(s, 'ag_ava'), { id: projectId(SHOP), name: 'shop' });
  assert.equal(projectOfAgent(s, 'ag_dan'), undefined, 'no home: no project');
  assert.equal(mayReach(s, 'ag_ava', 'ag_ben'), true, 'inside → inside');
  assert.equal(mayReach(s, 'ag_ava', 'ag_dan'), false, 'inside → outside');
  assert.equal(mayReach(s, 'ag_ava', 'ag_cy'), false, 'project A → project B');
  assert.equal(mayReach(s, 'ag_cy', 'ag_ava'), false, 'project B → project A');
  assert.equal(mayReach(s, 'ag_dan', 'ag_ava'), true, 'outside → inside');
  assert.equal(mayReach(s, 'ag_dan', 'ag_cy'), true);
  assert.equal(mayReach(s, 'ag_ava', HUMAN_ID), true, 'the person is always reachable');
  assert.equal(mayReach(s, 'ag_ava', 'per_anna000000'), true, 'colleagues are people, not agents');
  assert.match(reachRefusal(s, 'ag_ava', 'ag_dan')!, /^Dan \(ag_dan\) is outside my project "shop"/);

  new KvRepo(h.db).set(PROJECTS_NS, projectId(SHOP), { folder: SHOP, added: true, addedAt: 0, leadId: 'ag_ava' }, 0);
  assert.equal(mayReach(s, 'ag_ava', 'ag_dan'), false, 'the lead (AF-020) is an agent of its project like the others');
  assert.equal(projectOfAgent(s, 'ag_ava')?.name, 'shop');
  new KvRepo(h.db).set(PROJECTS_NS, projectId(SHOP), { folder: SHOP, added: false, addedAt: 0, hidden: true }, 0);
  assert.equal(projectOfAgent(s, 'ag_ava'), undefined, 'a project the person removed from the list is no project');
  assert.equal(mayReach(s, 'ag_ava', 'ag_dan'), true);
});

test('inside → inside: a project agent writes to, opens chats with and gives work to its project\'s agents', async () => {
  const h = setup();
  const direct = await h.run('chat.send', { to: 'ag_ben', text: 'Can you check the cart?' }, 'ag_ava');
  assert.equal(direct.failed, false, direct.text);
  assert.equal(h.posts(direct.chatId).length, 1);
  assert.equal((await h.run('chat.create', { title: 'Cart', members: ['ag_ben'] }, 'ag_ava')).failed, false);
  assert.equal((await h.run('chat.direct', { with: 'Ben', topic: 'Checkout' }, 'ag_ava')).failed, false);
  assert.equal((await h.run('tasks.create', { title: 'Fix totals', assignee: 'ag_ben' }, 'ag_ava')).failed, false);
  const listed = await h.run('agents.list', {}, 'ag_ava');
  assert.deepEqual((JSON.parse(listed.text) as Array<{ id: string }>).map((a) => a.id).sort(), ['ag_ava', 'ag_ben'], 'it sees itself and its project\'s agents only');
});

test('inside → outside: refused on every way, with the reason', async () => {
  const h = setup();
  for (const [name, args] of [
    ['chat.send', { to: 'ag_dan', text: 'Hi Dan' }],
    ['chat.send', { to: 'Dan', text: 'Hi Dan' }],
    ['chat.direct', { with: 'ag_dan' }],
    ['chat.direct', { with: 'ag_dan', topic: 'Ads' }],
    ['chat.create', { title: 'Ads', members: ['ag_ben', 'ag_dan'] }],
    ['agents.delegate', { to: 'ag_dan', title: 'Write the ad' }],
    ['tasks.create', { title: 'Write the ad', assignee: 'ag_dan' }],
    ['agents.update', { agentId: 'ag_dan', role: 'Ads' }],
  ] as const) {
    const out = await h.run(name, args, 'ag_ava');
    assert.equal(out.failed, true, `${name} ${JSON.stringify(args)}`);
    assert.match(out.text, OUTSIDE, `${name}: ${out.text}`);
  }
  const room = h.chats.create({ title: 'Cart', agentIds: ['ag_ava', 'ag_ben'], createdBy: 'ag_ava', lead: 'ag_ava' });
  const added = await h.run('chat.add_members', { chatId: room.id, members: ['ag_dan'] }, 'ag_ava');
  assert.equal(added.failed, true);
  assert.match(added.text, OUTSIDE);
  assert.equal(h.chats.members(room.id).some((m) => m.memberId === 'ag_dan'), false);
  const mine = (await h.run('tasks.create', { title: 'Mine', assignee: 'self' }, 'ag_ava')).data.taskId as string;
  const moved = await h.run('tasks.assign', { taskId: mine, assignee: 'ag_dan' }, 'ag_ava');
  assert.equal(moved.failed, true);
  assert.match(moved.text, OUTSIDE);
  assert.equal(h.chats.list().some((chat) => chat.members.some((m) => m.memberId === 'ag_dan')), false, 'no chat with Dan was opened');
  assert.equal(h.wakeRows().some((row) => row.agent_id === 'ag_dan'), false, 'Dan was never woken');
});

test('project A → project B: refused both ways', async () => {
  const h = setup();
  const toB = await h.run('chat.send', { to: 'ag_cy', text: 'Hello blog' }, 'ag_ava');
  assert.equal(toB.failed, true);
  assert.match(toB.text, OUTSIDE);
  const toA = await h.run('chat.send', { to: 'ag_ava', text: 'Hello shop' }, 'ag_cy');
  assert.equal(toA.failed, true);
  assert.match(toA.text, /Ava \(ag_ava\) is outside my project "blog"/);
  const listed = JSON.parse((await h.run('agents.list', {}, 'ag_cy')).text) as Array<{ id: string }>;
  assert.deepEqual(listed.map((a) => a.id), ['ag_cy']);
});

test('outside → inside works as before, and the project agent answers in exactly that chat', async () => {
  const h = setup();
  const asked = await h.run('chat.send', { to: 'ag_ava', text: 'Ava, what is the cart total?' }, 'ag_dan');
  assert.equal(asked.failed, false, asked.text);
  assert.ok(h.wakeRows().some((row) => row.agent_id === 'ag_ava'), 'the project agent is woken');
  assert.equal((await h.run('tasks.create', { title: 'Check the total', assignee: 'ag_ava' }, 'ag_dan')).failed, false);
  const listed = JSON.parse((await h.run('agents.list', {}, 'ag_dan')).text) as Array<{ id: string }>;
  assert.equal(listed.length, 4, 'an agent outside every project sees everyone');

  const answer = await h.run('chat.send', { to: 'ag_dan', text: '42 euros.' }, 'ag_ava');
  assert.equal(answer.failed, false, answer.text);
  assert.equal(answer.chatId, asked.chatId, 'the answer goes into the chat Dan opened');
  assert.equal((await h.run('chat.send', { chatId: asked.chatId, text: 'And shipping is free.' }, 'ag_ava')).failed, false);
  assert.deepEqual(h.posts(asked.chatId).map((m) => m.authorId), ['ag_dan', 'ag_ava', 'ag_ava']);

  const seq = h.posts(asked.chatId)[0]!.seq;
  const thread = await h.run('chat.thread', { chatId: asked.chatId, seq }, 'ag_ava');
  assert.equal(thread.failed, false, thread.text);
  assert.equal((await h.run('chat.send', { chatId: thread.chatId, text: 'Details in this thread.' }, 'ag_ava')).failed, false, 'a thread on the incoming message counts as the same conversation');

  // Still no new conversation outwards: a new topic chat, a group or work for Dan stay refused.
  assert.match((await h.run('chat.direct', { with: 'ag_dan', topic: 'Something else' }, 'ag_ava')).text, OUTSIDE);
  assert.match((await h.run('tasks.create', { title: 'Do it for me', assignee: 'ag_dan' }, 'ag_ava')).text, OUTSIDE);
});

test('a chat with outsiders that was started inside the project is no answer', async () => {
  const h = setup();
  const s = h.services as RuntimeServices;
  const old = h.chats.create({ title: 'Before the project', agentIds: ['ag_ava', 'ag_dan'], createdBy: 'ag_ava', lead: 'ag_ava' });
  const sent = await h.run('chat.send', { chatId: old.id, text: 'Dan, one more thing' }, 'ag_ava');
  assert.equal(sent.failed, true);
  assert.match(sent.text, /Dan \(ag_dan\) is outside my project "shop", and this chat was started inside it/);
  assert.equal(h.posts(old.id).length, 0);
  const byBen = h.chats.create({ title: 'Ben\'s', agentIds: ['ag_ben', 'ag_ava', 'ag_dan'], createdBy: 'ag_ben' });
  assert.ok(postRefusal(s, 'ag_ava', byBen.id), 'started by another agent of the project: still inside');
  assert.equal(postRefusal(s, 'ag_dan', old.id), undefined, 'the outsider itself is free');

  const byPerson = h.chats.create({ title: 'Ad campaign', agentIds: ['ag_ava', 'ag_dan'], createdBy: HUMAN_ID });
  assert.equal((await h.run('chat.send', { chatId: byPerson.id, text: 'Here is the shop\'s side.' }, 'ag_ava')).failed, false, 'a chat the person put together is theirs');
});

test('the prompt tells a project agent whom it reaches', () => {
  const h = setup();
  const text = projectBoundarySection(h.services as RuntimeServices, { id: 'ag_ava' });
  assert.equal(text, boundarySectionText('shop'));
  assert.match(text, /^## My project\nI work in the project "shop"\. I reach only its agents and the person/);
  assert.equal(projectBoundarySection(h.services as RuntimeServices, { id: 'ag_dan' }), '');
});

test('rpc gate: the params that name agents', () => {
  assert.deepEqual(namedIds('chats.create', { agentIds: ['ag_a', 'ag_b'], title: 'x' }), ['ag_a', 'ag_b']);
  assert.deepEqual(namedIds('chats.members', { id: 'cnv_1', add: ['ag_a'], lead: 'ag_b' }), ['ag_a', 'ag_b']);
  assert.deepEqual(namedIds('tasks.update', { id: 'tsk_1', patch: { assigneeId: 'ag_a' } }), ['ag_a']);
  assert.deepEqual(namedIds('agents.get', { id: 'ag_a' }), ['ag_a']);
  assert.deepEqual(namedIds('tasks.get', { id: 'tsk_1' }), [], 'an id is an agent only for agents.*');
  assert.deepEqual(namedIds('calendar.list', { from: 1, to: 2 }), []);
});

function rpcRig(t: { after(fn: () => void): void }) {
  const f = rpcFixture();
  t.after(f.cleanup);
  const services = f.services as RuntimeServices;
  place(services, f.org);
  const registry = new Registry({ services: () => services });
  for (const tool of chatTools) registry.register(tool);
  services.tools = registry;
  const client = (scope: ClientScope) => new TestClient(f.server, scope);
  return { f, ava: client({ kind: 'owner', agentId: 'ag_ava' }), dan: client({ kind: 'owner', agentId: 'ag_dan' }), owner: client(OWNER) };
}

test('wf as a project agent (RPC): sees and reaches only its project; answers where it was asked', async (t) => {
  const { f, ava } = rpcRig(t);
  const seen = await ava.call<Agent[]>('agents.list', {});
  assert.deepEqual(seen.map((a) => a.id).sort(), ['ag_ava', 'ag_ben']);
  const tree = await ava.call<Array<{ agent: Agent }>>('agents.org');
  assert.deepEqual(tree.map((node) => node.agent.id).sort(), ['ag_ava', 'ag_ben']);

  const created = await ava.request('chats.create', { title: 'Ads', agentIds: ['ag_dan'] });
  assert.equal(created.error?.code, 'forbidden');
  assert.match(created.error!.message, OUTSIDE);
  assert.equal((await ava.request('agents.get', { id: 'ag_cy' })).error?.code, 'forbidden', 'another project\'s agent is not visible');
  assert.equal((await ava.request('chats.create', { title: 'Cart', agentIds: ['ag_ben'] })).error, undefined, 'its own project is fine');

  const mine = f.chats.create({ title: 'Mine', agentIds: ['ag_ava', 'ag_dan'], createdBy: 'ag_ava' });
  const refused = await ava.request('messages.send', { conversationId: mine.id, body: 'Dan?' });
  assert.equal(refused.error?.code, 'forbidden', 'wf send holds the answer rule too');
  const asked = f.chats.create({ title: 'Question', agentIds: ['ag_dan', 'ag_ava'], createdBy: 'ag_dan' });
  f.chats.send({ conversationId: asked.id, body: 'Ava, the total?', authorId: 'ag_dan', authorKind: 'agent' });
  const answered = await ava.call<Message>('messages.send', { conversationId: asked.id, body: '42 euros.' });
  assert.equal(answered.authorId, 'ag_ava');
});

test('wf of an agent outside every project and the person are not limited', async (t) => {
  const { dan, owner } = rpcRig(t);
  assert.equal((await dan.call<Agent[]>('agents.list', {})).length, 4);
  assert.equal((await dan.request('chats.create', { title: 'Ask Ava', agentIds: ['ag_ava'] })).error, undefined);
  assert.equal((await owner.call<Agent[]>('agents.list', {})).length, 4);
  assert.equal((await owner.request('chats.create', { title: 'All', agentIds: ['ag_ava', 'ag_cy', 'ag_dan'] })).error, undefined, 'the person brings anyone together');
});
