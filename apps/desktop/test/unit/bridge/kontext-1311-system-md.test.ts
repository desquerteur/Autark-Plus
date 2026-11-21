// Bridge 13.11.2026, SYSTEM.md part (bridge/kontext-1311.ts): the copied team standard above "## My role" goes where it
// is a shipped standard or the one recorded for the agent (whitespace aside); an edited head stays as the agent's own
// "# How I work" (without the shipped preface); "## Your role" becomes "## My role" and an old shipped role text today's;
// 14.11.: a file without its own "# How I work" gets the team's on top – the person's own team text, else the standard's
// of its kind. Real form: the B-076 SYSTEM.md (preface, "# How I work", role, what I have here).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ownSystemMd, runKontext1311 } from '../../../src/runtime/bridge/kontext-1311.ts';
import { Org } from '../../../src/runtime/org/service.ts';
import { B076 } from '../../../src/runtime/org/standard-upgrade.ts';
import { renderTemplate } from '../../../src/runtime/context/templates.ts';
import { PromptTemplates } from '../../../src/runtime/context/templates.ts';
import { defaultSettings } from '../../../src/runtime/settings/defaults.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { clock, memoryDb, recordingBus, RESOURCES, tempDir } from '../store/helpers.ts';

/** The B-076 standard as a hire recorded it (kv agent-prompt-defaults template): preface, How I work, role, have. */
const TEMPLATE = [
  'This is my SYSTEM.md{{#creator}}, started by {{creator}}{{/creator}} – the main part of what I read each turn. Its first part is the team\'s standard; the app renews it with each update while I leave it unchanged.',
  '',
  '# How I work',
  'This company is my own work – {{user_name}}, my colleagues, this PC.',
  '',
  '## Judgment',
  '- A request starts work, not a conversation.',
  '',
  '## My role',
  '{{#role}}{{role}}.{{/role}}',
  '',
  '## What I have here',
  '- This PC is my workplace, all of it.',
].join('\n');

const OWN = '## My role\nProduct QA.\n\nIch teste Lumo.\n\n## What I have here\n- This PC is my workplace, all of it.\n- Felix: keine Mails an Kunden (12.11.).';
const head = (name: string, creator = '') => `This is my SYSTEM.md${creator ? `, started by ${creator}` : ''} – the main part of what I read each turn. Its first part is the team's standard; the app renews it with each update while I leave it unchanged.\n\n# How I work\nThis company is my own work – ${name}, my colleagues, this PC.\n\n## Judgment\n- A request starts work, not a conversation.`;
const facts = { templates: [], previous: {}, have: '## What I have here\n- This PC is my workplace, all of it.' };

test('a standard head goes – recorded template (any name and creator) or the hire\'s baseline, whitespace aside', () => {
  const text = `${head('Felix Brandt', 'Jonas')}\n\n${OWN}`;
  assert.equal(ownSystemMd(text, { template: TEMPLATE }, facts), OWN);
  const spaced = text.replace('this PC.', 'this PC.   ').replace('\n\n## Judgment', '\n\n\n## Judgment');
  assert.equal(ownSystemMd(spaced, { baseline: text }, facts), OWN, 'the baseline matches with other whitespace');
  assert.equal(ownSystemMd(OWN, { template: TEMPLATE }, facts), OWN, 'already converted: unchanged (idempotent)');
});

test('an edited head stays as the agent\'s own "# How I work", without the shipped preface', () => {
  const text = `${head('Felix Brandt')}\n- I always answer in German.\n\n${OWN}`;
  const out = ownSystemMd(text, { template: TEMPLATE }, facts);
  assert.ok(out.startsWith('# How I work\nThis company is my own work – Felix Brandt'), out.slice(0, 80));
  assert.ok(out.includes('- I always answer in German.\n\n## My role\nProduct QA.'));
  assert.doesNotMatch(out, /This is my SYSTEM\.md/);
  assert.equal(ownSystemMd(text, undefined, facts), out, 'without a record an edited head is the agent\'s too');
});

test('the last shipped standard head (B-076) goes without any record – an agent whose home moved here', () => {
  const text = `${renderTemplate(B076, { user_name: 'Felix Brandt', creator: 'Jonas' })}\n\n${OWN}`;
  assert.equal(ownSystemMd(text, undefined, facts), OWN);
});

test('an edited preface goes too: the own text starts at its "# How I work"', () => {
  const text = `This is your SYSTEM.md, my own words here.\nMore preface.\n\n# How I work\nI answer in German.\n\n${OWN}`;
  assert.equal(ownSystemMd(text, undefined, facts), `# How I work\nI answer in German.\n\n${OWN}`);
});

test('an old shipped form goes; "## Your role" becomes "## My role" with what I have here added; an own text stays', () => {
  const old = '# Standing instructions\nThis is your SYSTEM.md, started by Mara. You keep it current as your role grows; lessons go to memory, ways of working that worked go to skills.\n\n## How you work\nLook at what is known, decide, act, say what changed. Whoever you report to wants results and real blockers; colleagues you work with directly. What worked, leave behind: a skill improved, a note corrected.\n<<Still open: how you recognise this role going well, and what counts most when two good things conflict, for instance "speed before polish while the offer is being tested".>>\n\n## Who and what you work with\n<<Still open: the colleagues, folders and accounts of this work, and an earlier piece that shows what good looks like here.>>\n\n## Money\nThe money skill shows how this team weighs a purchase.\n<<Still open: any standing agreement, for instance "hosting renewals are settled".>>';
  assert.equal(ownSystemMd(`${old}\n\n## Your role\nResearcher.`, undefined, facts), '## My role\nResearcher.\n\n## What I have here\n- This PC is my workplace, all of it.');
  assert.equal(ownSystemMd('I write tight copy.', undefined, facts), 'I write tight copy.', 'no role heading: an own text as it is');
});

test('runKontext1311: every agent at home here converted once – the own team text on top, else the standard\'s How I work', () => {
  const temp = tempDir('wf-bridge-');
  try {
    const db = memoryDb();
    const time = clock();
    const prompts = new PromptTemplates(() => path.join(RESOURCES, 'prompts'), () => undefined, { data: () => temp.dir });
    const org = new Org({ db, bus: recordingBus().bus, clock: time, templatesDir: path.join(RESOURCES, 'agents') });
    const settings = defaultSettings({ locale: 'en-US', timezone: 'UTC' });
    settings.profile.name = 'Felix Brandt';
    const ida = org.create({ name: 'Ida', role: 'Product QA', instructions: 'x', createdBy: HUMAN_ID });
    org.update(ida.id, { instructions: `${head('Felix Brandt', 'Jonas')}\n\n${OWN}` });
    const kv = new KvRepo(db);
    kv.set('agent-prompt-defaults', ida.id, { template: TEMPLATE, baseline: '' }, 0);
    const own = path.join(temp.dir, 'prompts');
    mkdirSync(own, { recursive: true });
    writeFileSync(path.join(own, 'rules.md'), '# How we work\nOur own way.\n');
    writeFileSync(path.join(own, 'agent-default.md'), 'Preface {{creator}}.\n\n{{rules}}\n\n## My role\n{{role}}.\n');
    kv.set('prompt-defaults', 'agent-default', { text: 'Preface {{creator}}.\n\n{{rules}}\n\n## My role\n{{role}}.' }, 0);
    const logs: unknown[] = [];
    const s = {
      db, clock: time, org, prompts, settings: { get: () => settings },
      paths: { data: temp.dir, resources: RESOURCES },
      log: { info: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(['warn', ...args]) },
    } as unknown as RuntimeServices;
    runKontext1311(s);
    assert.equal(org.require(ida.id).instructions, `# How I work\nOur own way.\n\n${OWN}`, 'the person\'s own team text (rules.md) is its How I work');
    assert.equal(kv.get('agent-prompt-defaults', ida.id), undefined, 'the old record goes');
    org.update(ida.id, { instructions: `${head('Felix Brandt')}\n\n${OWN}` });
    runKontext1311(s);
    assert.ok(org.require(ida.id).instructions.startsWith('This is my SYSTEM.md'), 'once per PC: a second start changes nothing');
    assert.ok(!logs.some((entry) => Array.isArray(entry) && entry[0] === 'warn'), JSON.stringify(logs));
  } finally {
    temp.cleanup();
  }
});

test('runKontext1311: without an own team text the standard\'s How I work of the agent\'s kind goes on top', () => {
  const temp = tempDir('wf-bridge-');
  try {
    const db = memoryDb();
    const time = clock();
    const prompts = new PromptTemplates(() => path.join(RESOURCES, 'prompts'), () => undefined, { data: () => temp.dir });
    const org = new Org({ db, bus: recordingBus().bus, clock: time, templatesDir: path.join(RESOURCES, 'agents') });
    const settings = defaultSettings({ locale: 'en-US', timezone: 'UTC' });
    settings.profile.name = 'Felix Brandt';
    const max = org.create({ name: 'Max', role: 'Writer', instructions: OWN, createdBy: HUMAN_ID });
    const lead = org.create({ name: 'Lea', role: 'Head', mode: 'manager', instructions: '## My role\nHead.', createdBy: HUMAN_ID });
    const s = {
      db, clock: time, org, prompts, settings: { get: () => settings }, paths: { data: temp.dir, resources: RESOURCES }, log: { info() {}, warn() {} },
    } as unknown as RuntimeServices;
    runKontext1311(s);
    const text = org.require(max.id).instructions;
    assert.ok(text.startsWith('# How I work\nThis company is my own work – Felix Brandt,') && text.endsWith(`\n\n${OWN}`), text.slice(0, 120));
    assert.ok(!text.includes('## Leading'));
    assert.ok(org.require(lead.id).instructions.includes('\n## Leading\n'), 'a manager gets the manager standard\'s How I work');
  } finally {
    temp.cleanup();
  }
});
