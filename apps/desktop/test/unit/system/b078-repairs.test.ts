// B-078 one-time repairs of data from before the build (system/b078-repairs.ts): a marked 1:1 loses the agents outside
// its pair and their open work moves into their own 1:1 with the giver (chat/direct-repair.ts); the agents' approval-era
// to-dos close and each asking agent gets one wake with the self-check note, the host's and identity asks stay
// (tasks/approval-close.ts); the personal manager of a lived-in organisation gets one look at the team, a fresh one
// nothing (org/org-review.ts). Each runs once. B-080: steps move too, and a later pass moves once what an earlier one left.
// Owns: these assertions only. Never: real engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID, SYSTEM_ID } from '../../../src/shared/ids.ts';
import { findDirect, pairOf } from '../../../src/runtime/chat/direct.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { repairDirectChats } from '../../../src/runtime/chat/direct-repair.ts';
import { ORG_REVIEW_NOTE, wakeOrgReview } from '../../../src/runtime/org/org-review.ts';
import { agent, harness } from '../chat/harness.ts';

function rig() {
  const h = harness();
  h.org.add(agent('ag_mara', 'Mara'));
  h.org.add(agent('ag_konrad', 'Konrad', { template: 'manager', mode: 'manager' }));
  return h;
}

test('a 1:1 with a third agent goes back to two; its open work moves into its own 1:1 with the giver; once', () => {
  const h = rig();
  const chat = h.chats.create({ agentIds: ['ag_mara', 'ag_konrad'], createdBy: HUMAN_ID, settings: { direct: true, directPair: pairOf(HUMAN_ID, 'ag_mara') } });
  const work = h.tasks.create({ conversationId: chat.id, title: 'Check the invoice', assigneeKind: 'agent', assigneeId: 'ag_konrad', createdBy: HUMAN_ID });
  const hers = h.tasks.create({ conversationId: chat.id, title: 'Draft the post', assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: HUMAN_ID });
  assert.equal(repairDirectChats(h.services), 1);
  const active = h.chats.members(chat.id).filter((member) => member.leftAt === undefined).map((member) => member.memberId).sort();
  assert.deepEqual(active, [HUMAN_ID, 'ag_mara'].sort());
  const moved = h.tasks.get(work.id)!;
  assert.notEqual(moved.conversationId, chat.id, 'Konrad works on it in his own 1:1 with the owner');
  const room = h.chats.members(moved.conversationId!).filter((member) => member.leftAt === undefined).map((member) => member.memberId).sort();
  assert.deepEqual(room, [HUMAN_ID, 'ag_konrad'].sort());
  assert.equal(h.tasks.get(hers.id)!.conversationId, chat.id, 'the pair\'s own work stays');
  assert.ok(h.chats.messages(chat.id).some((message) => /Konrad continues one task from here in a 1:1 of its own/.test(message.body)));
  assert.equal(repairDirectChats(h.services), 0, 'once');
});

test('B-080: steps move too – one with its task, a step of another\'s task on its own to its giver', () => {
  const h = rig();
  h.org.add(agent('ag_jonas', 'Jonas'));
  const chat = h.chats.create({ agentIds: ['ag_mara', 'ag_konrad', 'ag_jonas'], createdBy: HUMAN_ID, settings: { direct: true, directPair: pairOf(HUMAN_ID, 'ag_mara') } });
  const work = h.tasks.create({ conversationId: chat.id, title: 'Check the invoice', assigneeKind: 'agent', assigneeId: 'ag_konrad', createdBy: HUMAN_ID });
  const own = h.tasks.create({ conversationId: chat.id, parentId: work.id, title: 'Read the PDF', assigneeKind: 'agent', assigneeId: 'ag_konrad', createdBy: 'ag_konrad' });
  const hers = h.tasks.create({ conversationId: chat.id, title: 'Draft the post', assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: HUMAN_ID });
  const step = h.tasks.create({ conversationId: chat.id, parentId: hers.id, title: 'Find the photo', assigneeKind: 'agent', assigneeId: 'ag_jonas', createdBy: 'ag_mara' });
  for (const id of [work.id, own.id, step.id]) assert.equal(h.tasks.get(id)!.conversationId, chat.id, 'set up in the 1:1');
  assert.equal(repairDirectChats(h.services), 2, 'Konrad and Jonas leave');
  const konrads = h.tasks.get(work.id)!.conversationId;
  assert.notEqual(konrads, chat.id);
  assert.equal(h.tasks.get(own.id)!.conversationId, konrads, 'the step goes with its task');
  const jonas = h.tasks.get(step.id)!.conversationId!;
  assert.notEqual(jonas, chat.id, 'before B-080 a step stayed behind');
  assert.deepEqual(h.chats.members(jonas).filter((member) => member.leftAt === undefined).map((member) => member.memberId).sort(), ['ag_jonas', 'ag_mara'], 'Jonas\'s 1:1 with Mara, who gave it');
  assert.equal(h.tasks.get(hers.id)!.conversationId, chat.id, 'the pair\'s own work stays');
});

test('B-080: a step of a step goes where its chain goes – none stays in the 1:1', () => {
  const h = rig();
  const chat = h.chats.create({ agentIds: ['ag_mara', 'ag_konrad'], createdBy: HUMAN_ID, settings: { direct: true, directPair: pairOf(HUMAN_ID, 'ag_mara') } });
  const top = h.tasks.create({ conversationId: chat.id, title: 'Check the invoice', assigneeKind: 'agent', assigneeId: 'ag_konrad', createdBy: HUMAN_ID });
  const step = h.tasks.create({ conversationId: chat.id, parentId: top.id, title: 'Read the PDF', assigneeKind: 'agent', assigneeId: 'ag_konrad', createdBy: 'ag_konrad' });
  const deeper = h.tasks.create({ conversationId: chat.id, parentId: step.id, title: 'Find page 3', assigneeKind: 'agent', assigneeId: 'ag_konrad', createdBy: 'ag_konrad' });
  assert.equal(repairDirectChats(h.services), 1);
  const room = h.tasks.get(top.id)!.conversationId;
  assert.notEqual(room, chat.id);
  assert.deepEqual([h.tasks.get(step.id)!.conversationId, h.tasks.get(deeper.id)!.conversationId], [room, room], 'the whole chain in Konrad\'s 1:1 with the owner');
});

test('B-080: work an earlier pass left in a 1:1 moves once – with the reminder set there', () => {
  const h = rig();
  h.org.add(agent('ag_jonas', 'Jonas'));
  new KvRepo(h.db).set('b078', 'direct-two', { at: 0, removed: 1 }, 0); // the B-078 pass ran before B-080
  const chat = h.chats.create({ agentIds: ['ag_mara'], createdBy: HUMAN_ID, settings: { direct: true, directPair: pairOf(HUMAN_ID, 'ag_mara') } });
  const hers = h.tasks.create({ conversationId: chat.id, title: 'Draft the post', assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: HUMAN_ID });
  const step = h.tasks.create({ conversationId: chat.id, parentId: hers.id, title: 'Find the photo', assigneeKind: 'agent', assigneeId: 'ag_mara', createdBy: 'ag_mara' });
  h.db.run(`UPDATE tasks SET assignee_id = 'ag_jonas', assigned_by = 'ag_konrad' WHERE id = ?`, [step.id]); // Jonas's step, left behind
  const reminder = h.scheduler.create({ ownerId: 'ag_jonas', conversationId: chat.id, taskId: step.id, kind: 'reminder', title: 'Photo', spec: { at: h.clock.now() + 3_600_000 }, payload: { note: 'Photo' } });
  assert.equal(repairDirectChats(h.services), 1);
  const room = h.tasks.get(step.id)!.conversationId;
  assert.equal(room, findDirect(h.services, 'ag_konrad', 'ag_jonas'), 'into Jonas\'s 1:1 with Konrad, who gave it');
  assert.equal(h.scheduler.get(reminder.id)!.conversationId, room, 'its reminder with it');
  assert.equal(h.tasks.get(hers.id)!.conversationId, chat.id);
  assert.ok(h.chats.messages(chat.id).some((message) => /Jonas continues one task from here in a 1:1 of its own/.test(message.body)));
  assert.equal(repairDirectChats(h.services), 0, 'once');
});


test('the personal manager of a lived-in organisation gets one look at the team; a fresh one gets none', () => {
  const fresh = rig();
  assert.equal(wakeOrgReview(fresh.services), false, 'nobody wrote a line yet');
  const h = rig();
  const chat = h.chats.create({ agentIds: ['ag_konrad'], createdBy: HUMAN_ID });
  h.chats.send({ conversationId: chat.id, body: 'Hello', authorId: HUMAN_ID, authorKind: 'human' });
  h.db.run('DELETE FROM wakes');
  assert.equal(wakeOrgReview(h.services), true);
  assert.equal(wakeOrgReview(h.services), false, 'once');
  const wakes = h.wakeRows().filter((row) => row.agent_id === 'ag_konrad' && row.note === ORG_REVIEW_NOTE);
  assert.equal(wakes.length, 1);
  assert.match(ORG_REVIEW_NOTE, /^Since the update/);
  assert.doesNotMatch(ORG_REVIEW_NOTE, /\bmay\b|allowed|only if/i);
});
