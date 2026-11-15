// Owner transitions (tasks/owners.ts): the owner moving a 1:1 task to another agent moves it into his 1:1 with that
// agent (routeOwner), and archiving an agent gives its open work to its manager chain, a space or company-wide manager
// (tasks/give.ts, a 1:1 task into the successor's own 1:1), else it waits on the person, who hears it once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { agent, harness } from '../chat/harness.ts';
import { Org } from '../../../src/runtime/org/service.ts';
import { routeOwner, successorFor } from '../../../src/runtime/tasks/owners.ts';
import { findDirect, findOrCreateDirect } from '../../../src/runtime/chat/direct.ts';
import { RESOURCES } from '../store/helpers.ts';
import type { OrgService } from '../../../src/runtime/contracts.ts';

const isMember = (h: ReturnType<typeof harness>, conversationId: string, id: string) =>
  h.chats.members(conversationId).some((member) => member.memberId === id);

/** Harness with the real OrgService (it emits 'agent.removed' on archive). */
function withOrg() {
  const h = harness();
  const org = new Org({ db: h.db, bus: h.bus, clock: h.clock, templatesDir: path.join(RESOURCES, 'agents') });
  (h.services as { org: OrgService }).org = org;
  return { ...h, realOrg: org };
}







test('B-078 D7: the owner assigning a task of his 1:1 to another agent moves it into his 1:1 with that agent (routeOwner)', () => {
  const h = harness();
  h.org.add(agent('ag_ava', 'Ava'));
  h.org.add(agent('ag_bob', 'Bob'));
  const direct = findOrCreateDirect(h.services, 'human', 'ag_ava', { createdBy: 'human' });
  const task = h.tasks.create({ conversationId: direct, title: 'Cut the trailer', assigneeId: 'ag_ava', createdBy: 'human' });
  const room = routeOwner(h.tasks, h.tasks.get(task.id)!, 'ag_bob', 'human');
  assert.equal(room, findDirect(h.services, 'human', 'ag_bob'));
  assert.equal(h.tasks.get(task.id)!.conversationId, room);
  assert.equal(isMember(h, direct, 'ag_bob'), false, 'the 1:1 stays two');
  const group = h.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  const other = h.tasks.create({ conversationId: group.id, title: 'Music', createdBy: 'human' });
  assert.equal(routeOwner(h.tasks, h.tasks.get(other.id)!, 'ag_bob', 'human'), group.id, 'any other chat: the agent joins it');
  assert.ok(isMember(h, group.id, 'ag_bob'));
});

test('without a manager chain: a manager of the space, else a company-wide manager takes over', () => {
  const h = withOrg();
  const company = h.realOrg.create({ name: 'Chief', mode: 'manager', createdBy: 'human' });
  const brand = h.realOrg.saveSpace({ name: 'Brand', kind: 'brand' });
  const home = h.realOrg.saveSpace({ name: 'Private', kind: 'private' });
  const brandLead = h.realOrg.create({ name: 'Brand lead', mode: 'manager', spaceId: brand.id, createdBy: 'human' });
  const subManager = h.realOrg.create({ name: 'Sub', mode: 'manager', spaceId: home.id, managerId: brandLead.id, createdBy: 'human' });
  const writer = h.realOrg.create({ name: 'Writer', spaceId: brand.id, createdBy: 'human' });
  const cook = h.realOrg.create({ name: 'Cook', spaceId: home.id, createdBy: 'human' });
  const org = h.services.org;
  assert.equal(successorFor(org, writer.id)?.id, brandLead.id, 'space manager first');
  assert.equal(successorFor(org, cook.id)?.id, subManager.id, 'a manager of the same space, even below someone');
  h.realOrg.archive(subManager.id);
  assert.equal(successorFor(org, cook.id)?.id, company.id, 'then the company-wide manager');
  assert.equal(successorFor(org, company.id)?.id, brandLead.id, 'a top-level manager of another space is the last resort');

  const chat = h.chats.create({ agentIds: [writer.id], createdBy: 'human' });
  const task = h.tasks.create({ conversationId: chat.id, title: 'Draft the newsletter', assigneeId: writer.id, createdBy: 'human' });
  h.realOrg.archive(writer.id);
  assert.equal(h.tasks.get(task.id)!.assigneeId, brandLead.id);
});




test('archiving an agent gives its open work to its manager: the fact says where it came from, the successor hears it', () => {
  const h = withOrg();
  const boss = h.realOrg.create({ name: 'Mia', mode: 'manager', createdBy: 'human' });
  const ava = h.realOrg.create({ name: 'Ava', managerId: boss.id, createdBy: 'human' });
  const chat = h.chats.create({ agentIds: [ava.id], createdBy: 'human' });
  const open = h.tasks.create({ conversationId: chat.id, title: 'Cut the trailer', assigneeId: ava.id, createdBy: 'human' });
  const waiting = h.tasks.create({ conversationId: chat.id, title: 'Color grade', assigneeId: ava.id, createdBy: 'human' });
  h.tasks.update(waiting.id, { status: 'waiting', waitingOn: { on: 'outside', why: 'LUT from the studio' } }, ava.id);
  const done = h.tasks.create({ conversationId: chat.id, title: 'Export', assigneeId: ava.id, createdBy: 'human' });
  h.tasks.finish(done.id, { status: 'done', summary: 'Exported' }, ava.id);

  h.realOrg.archive(ava.id);

  for (const id of [open.id, waiting.id]) {
    const task = h.tasks.get(id)!;
    assert.equal(task.assigneeId, boss.id, task.title);
    assert.ok(task.ledger.facts?.includes('Taken over from Ava (archived).'), 'ledger says where it came from');
    assert.ok(h.wakeRows().some((row) => row.agent_id === boss.id && row.task_id === id), 'successor woken');
  }
  assert.equal(h.tasks.get(waiting.id)!.status, 'waiting', 'a wait stays a wait');
  assert.equal(h.tasks.get(done.id)!.assigneeId, ava.id, 'finished work keeps its owner');
  assert.equal(h.wakeRows().filter((row) => row.agent_id === ava.id).length, 0, 'the archived agent has no wakes left');
  assert.ok(isMember(h, chat.id, boss.id), 'successor joined the chat');
});

test('a task of the archived agent\u2019s 1:1 with the owner moves to the successor\u2019s own 1:1', () => {
  const h = withOrg();
  const boss = h.realOrg.create({ name: 'Mia', mode: 'manager', createdBy: 'human' });
  const ava = h.realOrg.create({ name: 'Ava', managerId: boss.id, createdBy: 'human' });
  const direct = findOrCreateDirect(h.services, 'human', ava.id, { createdBy: 'human' });
  const task = h.tasks.create({ conversationId: direct, title: 'Renew the domain', assigneeId: ava.id, createdBy: 'human' });
  h.realOrg.archive(ava.id);
  const room = findDirect(h.services, 'human', boss.id);
  assert.ok(room && room !== direct, 'the successor\u2019s own 1:1 with the owner');
  assert.deepEqual([h.tasks.get(task.id)!.assigneeId, h.tasks.get(task.id)!.conversationId], [boss.id, room]);
  assert.equal(isMember(h, direct, boss.id), false, 'the 1:1 stays two');
});

test('no manager left: open work waits on the person, who hears it once', () => {
  const h = withOrg();
  const ava = h.realOrg.create({ name: 'Ava', createdBy: 'human' });
  h.realOrg.create({ name: 'Bob', createdBy: 'human' });
  const chat = h.chats.create({ agentIds: [ava.id], createdBy: 'human' });
  const task = h.tasks.create({ conversationId: chat.id, title: 'Renew the domain', assigneeId: ava.id, createdBy: 'human' });
  h.realOrg.archive(ava.id);
  const view = h.tasks.get(task.id)!;
  assert.deepEqual([view.status, view.assigneeId, view.waitingOn?.who, view.waitingOn?.why], ['waiting', ava.id, 'human', 'Owner archived: Ava']);
  h.ownership.pass();
  assert.equal(h.notified.filter((entry) => entry.kind === 'blocker' && entry.taskId === task.id).length, 1);
});
