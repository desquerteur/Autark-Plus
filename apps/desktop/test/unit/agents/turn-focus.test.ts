// B-080 (route-category-classifier-wrong): the routing text of a turn (TurnPlan.focus → RouteRequest.text) is what the
// turn is asked – the person's newest line (their card of my task reads as the task), else the task – never colleagues'
// reports, paths and addresses in the chat.
// Without either, a refined mode keeps its own category ('chat' for general, 'manager-planner' for the manager, D12).
// Owns: these assertions only. Never: real engines, routers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.ts';
import { agent } from '../chat/harness.ts';
import { planTurn, routeRequest } from '../../../src/runtime/agents/turn-prepare.ts';
import { resolveCategory } from '../../../src/runtime/routing/categories.ts';
import { GENERAL_MODE } from '../../../src/runtime/modes/service.ts';
import type { ModeInfo } from '../../../src/shared/model/knowledge.ts';

const MANAGER: ModeInfo = { ...GENERAL_MODE, key: 'manager', name: 'Manager', category: 'manager-planner' };

function rig() {
  const h = setup();
  h.org.add(agent('ag_lena', 'Lena'));
  h.chats.setMembers(h.chat.id, { add: ['ag_lena'] }, 'human');
  Object.assign(h.services, { modes: { get: (key: string) => (key === 'manager' ? MANAGER : GENERAL_MODE) } });
  h.chats.send({ conversationId: h.chat.id, authorId: 'ag_lena', body: 'Originalvideo ist fertig, Mails an podcast@example.com gehen raus, der LinkedIn-Post steht.' });
  const category = async (patch: Parameters<typeof h.request>[0] = {}) => {
    const plan = (await planTurn(h.services, h.request(patch)))!;
    return { focus: plan.focus, category: resolveCategory(plan.mode.category, routeRequest(plan).text) };
  };
  return { ...h, category };
}

test('a colleague\'s report alone: no focus – the mode\'s own category (general chat, the manager\'s planning)', async () => {
  const h = rig();
  assert.deepEqual(await h.category(), { focus: undefined, category: 'chat' });
  h.org.add({ ...h.org.get(h.tom.id)!, mode: 'manager' });
  assert.deepEqual(await h.category(), { focus: undefined, category: 'manager-planner' });
});

test('my task is the focus; the person\'s newest line wins over it', async () => {
  const h = rig();
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Postfach-Abgleich der Antworten', notes: 'Wer hat schon auf die Mail geantwortet?', assigneeId: h.tom.id, createdBy: 'human' });
  const onTask = await h.category({ taskId: task.id, reason: 'task', notes: [{ text: 'Video-Schnitt läuft nebenher', at: 0 }] });
  // The person's card of my task (its title only) reads as the whole task.
  assert.ok(h.chats.messages(h.chat.id, { limit: 10 }).some((message) => message.kind === 'task' && message.taskId === task.id && message.authorKind === 'human'));
  assert.equal(onTask.focus, 'Postfach-Abgleich der Antworten\nWer hat schon auf die Mail geantwortet?', 'the task, not the wake note or the colleague');
  assert.equal(onTask.category, 'personal-assistant');
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Schneide das Video' });
  const asked = await h.category({ taskId: task.id, reason: 'message' });
  assert.deepEqual(asked, { focus: 'Schneide das Video', category: 'video-animation' });
});

test('B-083 D6: a task about creators that names video and podcast only as the medium routes as chat, not video work', async () => {
  const h = rig();
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Creator-Ansprache', notes: 'kein Podcast-/Videoauftritt, Mails an Creator', assigneeId: h.tom.id, createdBy: 'human' });
  const onTask = await h.category({ taskId: task.id, reason: 'task' });
  assert.deepEqual(onTask, { focus: 'Creator-Ansprache\nkein Podcast-/Videoauftritt, Mails an Creator', category: 'chat' });
});
