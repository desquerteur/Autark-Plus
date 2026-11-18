// Owner 14.11.2026 (org/standard.ts): every SYSTEM.md keeps the team's standard of its kind as the comment at its end.
// S2 (17.11.2026): the kind follows whether the agent leads (people report to it, or the manager/head template), not its
// mode; a new standard wakes nobody: an own "# How I work" that is still the standard's old one is swapped by code, an own
// text that differs gets the changed lines once as a note with its next turn (the repair-notes row); a hire gets the
// standard quietly; an edit that drops the comment gets it back quietly; a second pass changes nothing; an agent at home on
// another PC is left to that PC; the comment never reaches a model (agent-core/prompt.ts coreInstructions).
// After the review (18.11.2026): only an active report makes a lead, a part that differs only in whitespace is swapped,
// and a change longer than the bound names my own file instead of its lines.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Org } from '../../../src/runtime/org/service.ts';
import { PromptTemplates, renderTemplate } from '../../../src/runtime/context/templates.ts';
import { systemMdValues } from '../../../src/runtime/org/hire.ts';
import { leads, splitStandard, standardName, startStandards, syncStandard, withStandard, type StandardKind } from '../../../src/runtime/org/standard.ts';
import { ownHowIWork } from '../../../src/runtime/org/system-parts.ts';
import { coreInstructions } from '../../../src/runtime/agent-core/prompt.ts';
import { defaultSettings } from '../../../src/runtime/settings/defaults.ts';
import { MAIN_THREAD } from '../../../src/shared/model/origin.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { clock, memoryDb, recordingBus, RESOURCES } from '../store/helpers.ts';

function setup() {
  const settings = defaultSettings({ locale: 'en-US', timezone: 'UTC' });
  settings.profile.name = 'Ada';
  const shipped = new PromptTemplates(() => path.join(RESOURCES, 'prompts'));
  const texts: Record<string, string> = { 'standard-agent': shipped.text('standard-agent'), 'standard-manager': shipped.text('standard-manager') };
  const prompts = { text: (name: string) => texts[name] ?? '' };
  const { bus } = recordingBus();
  const db = memoryDb();
  const time = clock();
  const systemMd = (values: Readonly<Record<string, string>>, kind: StandardKind) => renderTemplate(prompts.text(standardName(kind)), { ...systemMdValues(settings), ...values });
  const org = new Org({ db, bus, clock: time, templatesDir: path.join(RESOURCES, 'agents'), systemMd });
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const s = { db, org, bus, clock: time, log, prompts, settings: { get: () => settings } } as unknown as Parameters<typeof startStandards>[0];
  /** The notes waiting for the agent's next turn (agents/turn-finish.ts takeRepairNotes reads this row). */
  const notes = (agentId: string): string[] => JSON.parse(db.get<{ value: string }>('SELECT value FROM kv WHERE ns = ? AND key = ?', ['repair_notes', `${agentId}:${MAIN_THREAD}`])?.value ?? '[]') as string[];
  return { s, org, texts, settings, notes };
}

const how = (text: string) => ownHowIWork(splitStandard(text).own).how;
const commentHow = (text: string) => ownHowIWork(text.slice(text.lastIndexOf('<!--')).replace(/^[\s\S]*?\n\n(?=# How I work)/, '').replace(/\n-->$/, '')).how;

test('the comment: split and join round-trip, every copy goes, a "-->" inside cannot end it early', () => {
  const standard = { kind: 'agent' as const, rev: '0123abcd', text: '# How I work\nA --> B' };
  const text = withStandard('# Mine\nText.', standard);
  assert.match(text, /^# Mine\nText\.\n\n<!-- Autark standard: agent · 0123abcd\n[^\n]+\n\n# How I work\nA -- > B\n-->$/);
  assert.deepEqual(splitStandard(text), { own: '# Mine\nText.', kind: 'agent', rev: '0123abcd', held: '# How I work\nA -- > B' });
  const twice = `${text}\n\nMore of mine.\n\n${withStandard('', { ...standard, kind: 'manager', rev: 'ffffffff' })}`;
  assert.deepEqual(splitStandard(twice), { own: '# Mine\nText.\n\nMore of mine.', kind: 'manager', rev: 'ffffffff', held: '# How I work\nA -- > B' });
  assert.equal(withStandard(twice, standard), withStandard('# Mine\nText.\n\nMore of mine.', standard), 'one comment, the current one, at the end');
  assert.equal(coreInstructions({}, { instructions: text } as never), '# Mine\nText.', 'no comment reaches the model');
});

test('S2: a new standard wakes nobody – an untouched standard part is swapped by code, a differing one gets the changed lines once', () => {
  const { s, org, texts, notes } = setup();
  const off = startStandards(s);
  const wes = org.create({ name: 'Wes', role: 'Writer', instructions: 'Write tight.', createdBy: HUMAN_ID });
  const ida = org.create({ name: 'Ida', role: 'Editor', instructions: 'Edit hard.', createdBy: HUMAN_ID });
  const saved = org.require(wes.id).instructions;
  assert.match(saved, /\n\n<!-- Autark standard: agent · [0-9a-f]{8}\n[\s\S]*\n## What I have here\n[\s\S]*-->$/, 'the rendered standard as the last comment');
  assert.ok(saved.startsWith('# How I work\n') && splitStandard(saved).own.includes('Write tight.'));
  assert.equal(how(saved), commentHow(saved), 'a hire starts with the standard\'s own "# How I work"');
  assert.equal(syncStandard(s, org.require(wes.id)), 'same');
  // Ida made the standard part her own.
  org.update(ida.id, { instructions: org.require(ida.id).instructions.replace('I own outcomes, not replies', 'I own outcomes, never just replies') }, { by: ida.id });

  texts['standard-agent'] = texts['standard-agent'].replace('I own outcomes, not replies', 'I own outcomes');
  assert.equal(syncStandard(s, org.require(wes.id)), 'swapped');
  const swapped = org.require(wes.id).instructions;
  assert.match(how(swapped), /I own outcomes: what I leave open/, 'the new standard part, by code');
  assert.ok(splitStandard(swapped).own.includes('Write tight.'), 'the rest of my own text stays');
  assert.equal(how(swapped), commentHow(swapped));
  assert.deepEqual(notes(wes.id), [], 'nothing to read for an untouched part');

  assert.equal(syncStandard(s, org.require(ida.id)), 'noted');
  assert.match(how(org.require(ida.id).instructions), /I own outcomes, never just replies/, 'a text of my own stays as it is');
  const [note] = notes(ida.id);
  assert.match(note, /^The team's standard for my SYSTEM\.md changed with this version of the app\. My own text differs from the standard it replaces/);
  assert.match(note, /\nwas: [^\n]*I own outcomes, not replies[^\n]*\nnow: [^\n]*I own outcomes: what I leave open/, 'the changed line, old and new');
  assert.ok(!note.includes('1:1'), 'no line to a manager or the person');
  assert.equal(note.split('\n').filter((line) => line.startsWith('was: ') || line.startsWith('now: ')).length, 2, 'only the changed lines');
  assert.equal(syncStandard(s, org.require(ida.id)), 'same');
  assert.equal(notes(ida.id).length, 1, 'once');
  off();
});

test('S2: the kind follows whether the agent leads, not its mode; a report brings the manager standard, an edit that drops the comment gets it back quietly', () => {
  const { s, org, notes } = setup();
  const off = startStandards(s);
  const ida = org.create({ name: 'Ida', role: 'Researcher', createdBy: HUMAN_ID });
  org.update(ida.id, { mode: 'manager' }, { by: HUMAN_ID });
  assert.equal(splitStandard(org.require(ida.id).instructions).kind, 'agent', 'a mode alone leads no one');
  const head = org.create({ name: 'Hal', template: 'head', createdBy: HUMAN_ID });
  assert.equal(splitStandard(org.require(head.id).instructions).kind, 'manager', 'a head leads from the start');
  org.update(head.id, { mode: 'computer' }, { by: head.id });
  assert.equal(splitStandard(org.require(head.id).instructions).kind, 'manager', 'a head who borrows a screen mode still leads');

  org.create({ name: 'Bo', role: 'Helper', managerId: ida.id, createdBy: HUMAN_ID });
  const lead = org.require(ida.id).instructions;
  assert.equal(splitStandard(lead).kind, 'manager', 'a report makes Ida one who leads');
  assert.ok(lead.slice(lead.lastIndexOf('<!--')).includes('## Leading'), 'the comment shows the manager standard');
  assert.ok(how(lead).includes('## Leading'), 'her untouched standard part became the manager one by code');
  assert.deepEqual(notes(ida.id), []);
  org.update(ida.id, { instructions: '# How I work\nMine now.\n\n## My role\nLead.' }, { by: ida.id });
  const after = org.require(ida.id).instructions;
  assert.ok(after.startsWith('# How I work\nMine now.\n\n## My role\nLead.\n\n<!-- Autark standard: manager · '), 'the comment is back below my text');
  off();
});

test('S2 fix: only an active report makes a lead – an archived one brings the other kind\'s text back', () => {
  const { s, org, notes } = setup();
  const off = startStandards(s);
  const ida = org.create({ name: 'Ida', role: 'Researcher', createdBy: HUMAN_ID });
  const bo = org.create({ name: 'Bo', role: 'Helper', managerId: ida.id, createdBy: HUMAN_ID });
  assert.equal(leads(org, org.require(ida.id)), true);
  assert.equal(splitStandard(org.require(ida.id).instructions).kind, 'manager');

  org.archive(bo.id);
  assert.equal(leads(org, org.require(ida.id)), false, 'an archived report leads nobody');
  const after = org.require(ida.id).instructions;
  assert.equal(splitStandard(after).kind, 'agent', 'the standard of her kind again');
  assert.ok(!how(after).includes('## Leading'), 'and her untouched standard part with it');
  assert.deepEqual(notes(ida.id), [], 'an untouched part is swapped by code, so there is nothing to read');
  off();
});

test('S2 fix: a report that moves to another manager leaves the old one leading no one – both get their kind\'s text at once', () => {
  const { s, org } = setup();
  const off = startStandards(s);
  const ida = org.create({ name: 'Ida', role: 'Researcher', createdBy: HUMAN_ID });
  const max = org.create({ name: 'Max', role: 'Analyst', createdBy: HUMAN_ID });
  const bo = org.create({ name: 'Bo', role: 'Helper', managerId: ida.id, createdBy: HUMAN_ID });
  assert.equal(splitStandard(org.require(ida.id).instructions).kind, 'manager');

  org.update(bo.id, { managerId: max.id }, { by: HUMAN_ID });
  assert.equal(splitStandard(org.require(max.id).instructions).kind, 'manager', 'the new manager leads');
  assert.equal(splitStandard(org.require(ida.id).instructions).kind, 'agent', 'the old one leads no one, without waiting for a restart');
  off();
});

test('S2 fix: an own standard part that differs from the held one only in whitespace is swapped, not noted', () => {
  const { s, org, texts, notes } = setup();
  const off = startStandards(s);
  const lena = org.create({ name: 'Lena', role: 'Writer', createdBy: HUMAN_ID });
  off(); // her own edit stays as it is: live (company-2) one paragraph of the standard stands split over two lines
  const own = org.require(lena.id).instructions;
  const split = own.replace('I own outcomes, not replies: what I leave open, nobody picks up.', 'I own outcomes, not replies:\nwhat I leave open, nobody picks up.');
  assert.notEqual(split, own, 'the paragraph is split in her file');
  org.update(lena.id, { instructions: split }, { by: lena.id });

  texts['standard-agent'] = texts['standard-agent'].replace('I own outcomes, not replies', 'I own outcomes');
  assert.equal(syncStandard(s, org.require(lena.id)), 'swapped');
  assert.match(how(org.require(lena.id).instructions), /I own outcomes: what I leave open/, 'the new standard part, by code');
  assert.deepEqual(notes(lena.id), [], 'no was/now note for a text that reads the same');
});

test('S2 fix: a change longer than the bound names my own file instead of its lines', () => {
  const { s, org, notes } = setup();
  const off = startStandards(s);
  const ida = org.create({ name: 'Ida', role: 'Researcher', createdBy: HUMAN_ID });
  org.update(ida.id, { instructions: org.require(ida.id).instructions.replace('I own outcomes, not replies', 'I own outcomes, never just replies') }, { by: ida.id });
  org.create({ name: 'Bo', role: 'Helper', managerId: ida.id, createdBy: HUMAN_ID }); // she leads now: the manager standard is a frame of its own

  const [note] = notes(ida.id);
  assert.match(note, /^The team's standard for my SYSTEM\.md is now the one for agents who lead people\. My own text differs/);
  assert.match(note, /More of it changed than reads as lines: the whole new standard stands as the comment at the end of my SYSTEM\.md\.$/);
  assert.ok(!note.includes('was: ') && !note.includes('now: '), 'past the bound the lines stay out');
  assert.ok(org.require(ida.id).instructions.includes('## Leading'), 'and that comment holds the manager standard');
  off();
});

test('a new person name re-renders the comment (and an untouched standard part) quietly; an archived agent is left as it is', () => {
  const { s, org, settings, notes } = setup();
  const off = startStandards(s);
  const bo = org.create({ name: 'Bo', role: 'Helper', createdBy: HUMAN_ID });
  settings.profile.name = 'Alexandra';
  assert.equal(syncStandard(s, org.require(bo.id)), 'quiet');
  const text = org.require(bo.id).instructions;
  assert.ok(text.slice(text.lastIndexOf('<!--')).includes('Alexandra'));
  assert.ok(how(text).includes('Alexandra') && !how(text).includes('Ada'), 'the untouched part follows the name');
  assert.deepEqual(notes(bo.id), []);
  settings.profile.name = 'Kim';
  assert.equal(syncStandard(s, { ...org.require(bo.id), archivedAt: 1 }), 'same');
  off();
});
