// B-085 careful PC access, runtime side: settings.profile.pcAccess ('whole' | 'careful', absent = whole) is a valid
// setting; a hire's SYSTEM.md says the careful agreement in "What I have here" when chosen (standard-manager.md,
// org/hire.ts systemMdValues) and the whole-PC line otherwise; onboarding.start() swaps the Manager's existing
// whole-PC line for the careful one (for whatever name it was hired with, once) before the start text. The line stands
// once, in SYSTEM.md – no "PC reach" line in the live part says it again.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Onboarding, withPcLine } from '../../../src/runtime/onboarding/service.ts';
import { PromptTemplates } from '../../../src/runtime/context/templates.ts';
import { systemMdValues } from '../../../src/runtime/org/hire.ts';
import { SettingsStore } from '../../../src/runtime/settings/service.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { agent, harness } from '../chat/harness.ts';

const RESOURCES = path.resolve(import.meta.dirname, '../../../resources');
const prompts = new PromptTemplates(() => path.join(RESOURCES, 'prompts'));
const WHOLE = /^- This PC is my workplace, all of it: [^\n]*'s logins and the secrets catalog with their passwords and keys\.$/m;
const CAREFUL = /^- This PC is my workplace, the way Ada chose at the start \(careful\): [^\n]*Released folders: none yet\.$/m;
const profile = (extra: Record<string, unknown> = {}) => ({ profile: { name: 'Ada', company: '', ...extra } }) as never;
/** The SYSTEM.md a hire gets (compose/services.ts systemMd). */
const standard = (values: Record<string, string>) => prompts.renderText('standard-manager', values);

function setup() {
  const h = harness();
  const settings = new SettingsStore({ db: h.db, bus: h.bus, clock: h.clock, env: { locale: 'en-US', timezone: 'UTC' } });
  const updates: Array<{ id: string; patch: Partial<Agent>; by: unknown }> = [];
  Object.assign(h.org, {
    update: (id: string, patch: Partial<Agent>, by: unknown) => { updates.push({ id, patch, by }); return h.org.add({ ...h.org.require(id), ...patch }); },
  });
  Object.assign(h.services, { settings, accounts: { list: () => [], detect: async () => ({}) }, prompts });
  const services = h.services as RuntimeServices;
  return { ...h, settings, updates, onboarding: new Onboarding({ services: () => services }) };
}

test('pcAccess is a setting: whole or careful, absent by default, nothing else', () => {
  const h = setup();
  assert.equal(h.settings.get().profile.pcAccess, undefined, 'absent = whole');
  assert.equal(h.settings.update({ profile: { pcAccess: 'careful' } }).profile.pcAccess, 'careful');
  assert.equal(h.settings.update({ profile: { pcAccess: 'whole' } }).profile.pcAccess, 'whole');
  assert.throws(() => h.settings.update({ profile: { pcAccess: 'some' as never } }), /profile\.pcAccess/);
  assert.equal(h.settings.update({ profile: { pcAccess: null as never } }).profile.pcAccess, undefined, 'null clears it');
});

test('a hire\'s "What I have here": the whole-PC line by default, the careful agreement when chosen – one line, no permission wording', () => {
  assert.equal(systemMdValues(profile()).careful, undefined);
  assert.equal(systemMdValues(profile({ pcAccess: 'whole' })).careful, undefined);
  assert.equal(systemMdValues(profile({ pcAccess: 'careful' })).careful, 'yes');
  const whole = standard(systemMdValues(profile()));
  assert.match(whole, WHOLE);
  assert.doesNotMatch(whole, /careful|Released folders/);
  const careful = standard(systemMdValues(profile({ pcAccess: 'careful' })));
  assert.match(careful, CAREFUL);
  assert.doesNotMatch(careful, WHOLE);
  const line = careful.split('\n').find((entry) => CAREFUL.test(entry))!;
  assert.match(line, /I read and look wherever it helps/, 'where I work freely comes first');
  assert.match(line, /in my workspace, my home project, this app's data folder and the released folders I change, install and delete as my own call, and anywhere whatever Ada asks me to/);
  assert.match(line, /Only a change elsewhere that nobody asked for I check with Ada in one line first/, 'a request is already the go-ahead');
  assert.doesNotMatch(line, /allowed|only if|must ask|may I|permission/i, 'the agent\'s own agreement voice');
  assert.match(careful, /\n- Agreements with Ada: none yet\./, 'the agreements slot follows');
  assert.doesNotMatch(careful, /\{\{|\}\}/);
});

test('withPcLine swaps the whole-PC line for any name it was hired with, once; a text without it gives null', () => {
  const template = prompts.text('standard-manager');
  const values = systemMdValues(profile({ pcAccess: 'careful' }));
  const hired = standard(systemMdValues({ profile: { name: '', company: '' } } as never)); // hired before the name was typed
  assert.match(hired, /the browser with the person's logins/);
  const next = withPcLine(hired, template, values, true)!;
  assert.match(next, CAREFUL);
  assert.doesNotMatch(next, WHOLE);
  assert.equal(next.split('\n').length, hired.split('\n').length, 'one line for one line');
  assert.equal(withPcLine(next, template, values, true), next, 'once');
  const own = 'My own text.\n\n## What I have here\n- A line of my own.';
  assert.equal(withPcLine(own, template, values, true), null, 'an agent that rewrote its line keeps it');
  assert.equal(withPcLine(hired, 'No such part.', values, true), null, 'an own standard without the careful variant changes nothing');
});

test('withPcLine back to whole: a careful line from an earlier run (any name) becomes the whole-PC line; a whole line stays', () => {
  const template = prompts.text('standard-manager');
  const careful = standard(systemMdValues({ profile: { name: 'Bo', company: '', pcAccess: 'careful' } } as never));
  const values = systemMdValues(profile({ pcAccess: 'whole' }));
  const next = withPcLine(careful, template, values, false)!;
  assert.match(next, WHOLE);
  assert.match(next, /the browser with Ada's logins/);
  assert.doesNotMatch(next, /\(careful\)|Released folders/);
  assert.equal(next.split('\n').length, careful.split('\n').length, 'one line for one line');
  assert.equal(withPcLine(next, template, values, false), next, 'once');
  const hired = standard(systemMdValues({ profile: { name: '', company: '' } } as never));
  assert.equal(withPcLine(hired, template, values, false), null, 'a whole line for another name: nothing to swap, no write');
});

test('start(): careful – the Manager\'s SYSTEM.md gets the careful line before its first message; whole – untouched', () => {
  const careful = setup();
  const hired = standard(systemMdValues({ profile: { name: '', company: '' } } as never));
  careful.org.add(agent('ag_boss', 'Manager', { mode: 'manager', template: 'manager', createdAt: 1, instructions: hired }));
  careful.settings.update({ profile: { name: 'Ada', pcAccess: 'careful' } });
  const { conversationId } = careful.onboarding.start();
  assert.equal(careful.updates.length, 1);
  assert.equal((careful.updates[0].by as { by: string }).by, HUMAN_ID);
  assert.match(careful.org.require('ag_boss').instructions, CAREFUL);
  const first = careful.chats.messages(conversationId).filter((message) => message.authorId === 'ag_boss');
  assert.equal(first.length, 1, "the Manager's first message still goes out");
  assert.match(first[0].body, /On this PC I work in my own area\./, 'B-090: the setup question follows careful access');
  careful.onboarding.start();
  assert.equal(careful.updates.length, 1, 'asked twice: no second write');

  const whole = setup();
  whole.org.add(agent('ag_boss', 'Manager', { mode: 'manager', template: 'manager', createdAt: 1, instructions: hired }));
  whole.settings.update({ profile: { name: 'Ada' } });
  whole.onboarding.start();
  assert.equal(whole.updates.length, 0);
  assert.equal(whole.org.require('ag_boss').instructions, hired);
});

test('start() after "Set up team again" with Whole PC: the Manager\'s careful line goes back to the whole PC', () => {
  const h = setup();
  h.org.add(agent('ag_boss', 'Manager', { mode: 'manager', template: 'manager', createdAt: 1, instructions: standard(systemMdValues(profile({ pcAccess: 'careful' }))) }));
  h.settings.update({ profile: { name: 'Ada', pcAccess: 'whole' } });
  h.onboarding.start();
  assert.equal(h.updates.length, 1);
  assert.match(h.org.require('ag_boss').instructions, WHOLE);
  assert.doesNotMatch(h.org.require('ag_boss').instructions, CAREFUL);
});

test('start(): careful chosen but the Manager wrote its own PC line – unchanged, one info line in the log', () => {
  const h = setup();
  const logged: string[] = [];
  Object.assign(h.services, { log: { ...h.services.log, info: (text: string) => { logged.push(text); } } });
  const own = 'My own text.\n\n## What I have here\n- A line of my own.';
  h.org.add(agent('ag_boss', 'Manager', { mode: 'manager', template: 'manager', createdAt: 1, instructions: own }));
  h.settings.update({ profile: { name: 'Ada', pcAccess: 'careful' } });
  h.onboarding.start();
  assert.equal(h.updates.length, 0);
  assert.equal(h.org.require('ag_boss').instructions, own);
  assert.ok(logged.includes('careful PC line not found in the Manager\'s SYSTEM.md'));
});

test('start(): a SYSTEM.md that cannot be written never stops the start', () => {
  const h = setup();
  Object.assign(h.org, { update: () => { throw new Error('SYSTEM.md is not writable'); } });
  h.org.add(agent('ag_boss', 'Manager', { mode: 'manager', template: 'manager', createdAt: 1, instructions: standard(systemMdValues(profile())) }));
  h.settings.update({ profile: { name: 'Ada', pcAccess: 'careful' } });
  const { conversationId } = h.onboarding.start();
  assert.equal(h.settings.get().onboarding.step, 'done');
  assert.ok(h.chats.messages(conversationId).length >= 1);
});
