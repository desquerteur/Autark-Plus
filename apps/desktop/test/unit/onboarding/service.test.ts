// First run, runtime side (runtime/onboarding/service.ts, brief.ts): start() ends the layer – step 'done'
// and completed, the Manager's first chat (made when there is none) and B-090 the Manager's first message there (the
// shipped resources/prompts/onboarding.md, or the fallback), which wakes nobody – the person's answer is the first
// turn; reset() opens the layer again at 'ai'. The line's own cases: start-line.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Onboarding } from '../../../src/runtime/onboarding/service.ts';
import { PromptTemplates } from '../../../src/runtime/context/templates.ts';
import { SettingsStore } from '../../../src/runtime/settings/service.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { agent, harness } from '../chat/harness.ts';

const RESOURCES = path.resolve(import.meta.dirname, '../../../resources');

function setup(options: { prompts?: boolean } = {}) {
  const h = harness();
  const settings = new SettingsStore({ db: h.db, bus: h.bus, clock: h.clock, env: { locale: 'en-US', timezone: 'UTC' } });
  Object.assign(h.services, {
    settings,
    accounts: { list: () => [], detect: async () => ({}) },
    ...(options.prompts ? { prompts: new PromptTemplates(() => path.join(RESOURCES, 'prompts')) } : {}),
  });
  const services = h.services as RuntimeServices;
  const make = () => new Onboarding({ services: () => services });
  return { ...h, services, settings, make };
}

/** Passive or holding-back wording the first message must never carry. */
const PASSIVE = /facts only|no steps|not ahead of it|never change|approval|permission mode/i;
/** The Manager's lines in a chat. */
const managerLines = (h: ReturnType<typeof setup>, conversationId: string, managerId: string) => h.chats.messages(conversationId).filter((message) => message.authorId === managerId);

test('start(): step done and completed, the Manager\'s first chat and its first message there; nobody wakes – also when asked twice', () => {
  const h = setup({ prompts: true });
  const onboarding = h.make();
  assert.equal(h.settings.get().onboarding.step, 'tour', 'a new install starts with the feedback tour');
  const manager = h.org.add(agent('ag_boss', 'Manager', { mode: 'manager', template: 'manager', createdAt: 1 }));
  h.settings.update({ profile: { name: 'Lena Hess', company: '', language: 'en' } });

  const { conversationId } = onboarding.start();
  const chat = h.chats.list().find((entry) => entry.id === conversationId);
  assert.ok(chat, 'a chat with the Manager was made (there was none)');
  assert.deepEqual(chat.members.filter((member) => member.kind === 'agent').map((member) => member.memberId), [manager.id]);
  assert.deepEqual(h.settings.get().onboarding, { completed: true, step: 'done' }, 'the first run completes the onboarding itself');

  assert.equal(h.wakeRows().length, 0, 'B-090: no wake until the person answers');
  assert.equal(h.chats.messages(conversationId).filter((message) => message.authorId === HUMAN_ID).length, 0, 'nothing in the person\'s name');
  const [line] = managerLines(h, conversationId, manager.id);
  assert.match(line.body, /^Hi Lena Hess, I'm your Manager – your right hand in Autark\./);
  assert.match(line.body, /whatever stays open I decide myself/, 'every question is optional');
  assert.match(line.body, /I build a head set up like me and working beside me; I stay your direct contact, and for parallel work I split myself \(Ultra\)/, 'B-078 structure');
  assert.match(line.body, /The passwords saved in your browsers I move unread into the secrets catalog/);
  assert.match(line.body, /which AI models carry us better – for the work, for decisions and for search by meaning/);
  assert.match(line.body, /I keep your answers as agreements for the whole team\./);
  assert.match(line.body, /If I should wait, just say so/);
  assert.equal(PASSIVE.test(line.body), false, `no passive or holding-back line: ${line.body}`);
  assert.equal(/\{\{|<!--/.test(line.body), false, 'no placeholder or maintainer note left');

  assert.deepEqual(onboarding.start(), { conversationId }, 'the same chat again');
  assert.equal(managerLines(h, conversationId, manager.id).length, 1, 'not posted twice');
  assert.equal(h.wakeRows().length, 0);
});

test('start() uses the Manager\'s existing first chat and refuses without a Manager; without the prompt templates the fallback text', () => {
  const h = setup();
  const onboarding = h.make();
  assert.throws(() => onboarding.start(), /no Manager/);
  const manager = h.org.add(agent('ag_boss', 'Manager', { mode: 'manager', createdAt: 1 }));
  const first = h.chats.create({ title: 'Manager', agentIds: [manager.id], createdBy: 'human' });
  assert.equal(onboarding.start().conversationId, first.id);
  const [line] = managerLines(h, first.id, manager.id);
  assert.match(line.body, /^Hi, I'm your Manager/, 'without the prompt templates the fallback text');
  assert.equal(PASSIVE.test(line.body), false, line.body);
});

test('reset(): the layer is open again at the first card; start() closes it again', () => {
  const h = setup();
  const onboarding = h.make();
  h.org.add(agent('ag_boss', 'Manager', { mode: 'manager', createdAt: 1 }));
  onboarding.start();
  assert.deepEqual(h.settings.get().onboarding, { completed: true, step: 'done' });
  onboarding.reset();
  assert.deepEqual(h.settings.get().onboarding, { completed: false, step: 'ai' });
  onboarding.start();
  assert.deepEqual(h.settings.get().onboarding, { completed: true, step: 'done' });
});
