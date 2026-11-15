// Owner 14.11.2026 (org/standard.ts): every SYSTEM.md keeps the team's standard of its kind as the comment at its end.
// A hire gets it quietly; a changed standard or a new kind (mode manager ↔ not) wakes the agent once; an edit that drops
// the comment gets it back quietly; a second pass changes nothing; an agent at home on another PC is left to that PC;
// the comment never reaches a model (agent-core/prompt.ts coreInstructions).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Org } from '../../../src/runtime/org/service.ts';
import { PromptTemplates, renderTemplate } from '../../../src/runtime/context/templates.ts';
import { systemMdValues } from '../../../src/runtime/org/hire.ts';
import { splitStandard, standardName, startStandards, syncStandard, withStandard, type StandardKind } from '../../../src/runtime/org/standard.ts';
import { coreInstructions } from '../../../src/runtime/agent-core/prompt.ts';
import { defaultSettings } from '../../../src/runtime/settings/defaults.ts';
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
  const systemMd = (values: Readonly<Record<string, string>>, kind: StandardKind) => renderTemplate(prompts.text(standardName(kind)), { ...systemMdValues(settings), ...values });
  const org = new Org({ db, bus, clock: clock(), templatesDir: path.join(RESOURCES, 'agents'), systemMd });
  const woken: Array<{ agentId: string; note?: string; coalesceKey?: string }> = [];
  const wakes = { wake: (input: { agentId: string; note?: string; coalesceKey?: string }) => { woken.push(input); } };
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const s = { db, org, bus, wakes, log, prompts, settings: { get: () => settings } } as unknown as Parameters<typeof startStandards>[0];
  return { s, org, texts, woken, settings };
}

test('the comment: split and join round-trip, every copy goes, a "-->" inside cannot end it early', () => {
  const standard = { kind: 'agent' as const, rev: '0123abcd', text: '# How I work\nA --> B' };
  const text = withStandard('# Mine\nText.', standard);
  assert.match(text, /^# Mine\nText\.\n\n<!-- Autark standard: agent · 0123abcd\n[^\n]+\n\n# How I work\nA -- > B\n-->$/);
  assert.deepEqual(splitStandard(text), { own: '# Mine\nText.', kind: 'agent', rev: '0123abcd' });
  const twice = `${text}\n\nMore of mine.\n\n${withStandard('', { ...standard, kind: 'manager', rev: 'ffffffff' })}`;
  assert.deepEqual(splitStandard(twice), { own: '# Mine\nText.\n\nMore of mine.', kind: 'manager', rev: 'ffffffff' });
  assert.equal(withStandard(twice, standard), withStandard('# Mine\nText.\n\nMore of mine.', standard), 'one comment, the current one, at the end');
  assert.equal(coreInstructions({}, { instructions: text } as never), '# Mine\nText.', 'no comment reaches the model');
});

test('a hire gets the standard quietly; a changed standard wakes it once; a second pass changes nothing', () => {
  const { s, org, texts, woken } = setup();
  const off = startStandards(s);
  const wes = org.create({ name: 'Wes', role: 'Writer', instructions: 'Write tight.', createdBy: HUMAN_ID });
  const saved = org.require(wes.id).instructions;
  assert.match(saved, /\n\n<!-- Autark standard: agent · [0-9a-f]{8}\n[\s\S]*\n## What I have here\n[\s\S]*-->$/, 'the rendered standard as the last comment');
  assert.ok(saved.startsWith('# How I work\n') && splitStandard(saved).own.includes('Write tight.'));
  assert.equal(woken.length, 0, 'a hire is not woken for its own standard');
  assert.equal(syncStandard(s, org.require(wes.id)), 'same');
  texts['standard-agent'] = texts['standard-agent'].replace('I own outcomes, not replies', 'I own outcomes');
  assert.equal(syncStandard(s, org.require(wes.id)), 'woken');
  assert.equal(woken.length, 1);
  assert.match(woken[0].note!, /^The team's standard SYSTEM\.md changed with this version of the app\. The new standard stands as the comment at the end of my SYSTEM\.md/);
  assert.ok(org.require(wes.id).instructions.endsWith('-->') && splitStandard(org.require(wes.id).instructions).own === splitStandard(saved).own, 'my own text stays as it is');
  assert.equal(syncStandard(s, org.require(wes.id)), 'same');
  off();
});

test('mode manager brings the manager standard with one wake; an edit that drops the comment gets it back quietly', () => {
  const { s, org, woken } = setup();
  const off = startStandards(s);
  const ida = org.create({ name: 'Ida', role: 'Researcher', createdBy: HUMAN_ID });
  org.update(ida.id, { mode: 'manager' }, { by: HUMAN_ID });
  const lead = org.require(ida.id).instructions;
  assert.equal(splitStandard(lead).kind, 'manager');
  assert.ok(lead.slice(lead.lastIndexOf('<!--')).includes('## Leading'), 'the comment shows the manager standard');
  assert.equal(woken.length, 1);
  assert.match(woken[0].note!, /^My standard SYSTEM\.md is now the manager one, because I lead an area with people under me\./);
  org.update(ida.id, { instructions: '# How I work\nMine now.\n\n## My role\nLead.' }, { by: ida.id });
  const after = org.require(ida.id).instructions;
  assert.ok(after.startsWith('# How I work\nMine now.\n\n## My role\nLead.\n\n<!-- Autark standard: manager · '), 'the comment is back below my text');
  assert.equal(woken.length, 1, 'no second wake');
  off();
});

test('a new person name re-renders the comment quietly; an archived agent is left as it is', () => {
  const { s, org, woken, settings } = setup();
  const off = startStandards(s);
  const bo = org.create({ name: 'Bo', role: 'Helper', createdBy: HUMAN_ID });
  settings.profile.name = 'Alexandra';
  assert.equal(syncStandard(s, org.require(bo.id)), 'quiet');
  assert.ok(org.require(bo.id).instructions.slice(org.require(bo.id).instructions.lastIndexOf('<!--')).includes('Alexandra'));
  assert.equal(woken.length, 0);
  settings.profile.name = 'Kim';
  assert.equal(syncStandard(s, { ...org.require(bo.id), archivedAt: 1 }), 'same');
  off();
});
