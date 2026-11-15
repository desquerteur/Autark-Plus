// HUMAN.md (owner 15.11.2026, agent-core/human.ts): the person's own lines to an agent, beside SYSTEM.md.
// - a hire gets it with the default line in the app's language (German, else English);
// - the person writes it (setHuman / agents.setHuman), agents.core shows it; a file that is there is never seeded over;
// - an edit of the instructions and a new standard (org/standard.ts) leave it as it is;
// - the bridge gives every agent at home here a missing one once – an existing or emptied file stays, a deleted one
//   does not come back at the next start.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { humanDefault, humanFile, seedHuman } from '../../../src/runtime/agent-core/human.ts';
import { humanMdPart } from '../../../src/runtime/bridge/kontext-1311.ts';
import { syncStandard } from '../../../src/runtime/org/standard.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { AgentCore } from '../../../src/runtime/agent-core/service.ts';
import { coreFixture } from './fixture.ts';

const DE = '„Ich bin kein Roboter“-Prüfungen (CAPTCHAs) löse ich nicht.';
const EN = 'I don\'t solve "I\'m not a robot" checks (CAPTCHAs).';

test('the default line follows the app language', () => {
  assert.equal(humanDefault('de'), DE);
  assert.equal(humanDefault('de-AT'), DE);
  assert.equal(humanDefault('en'), EN);
  assert.equal(humanDefault(undefined), EN);
});

test('a hire gets HUMAN.md with the default line in the app language; the person edits it; it is never seeded over', () => {
  const f = coreFixture();
  try {
    const core = new AgentCore({ ...f.deps, language: () => 'de' });
    core.start();
    f.org.setCoreFiles(core);
    const wes = f.org.create({ name: 'Wes', role: 'Writer', instructions: 'Write tight.', createdBy: HUMAN_ID });
    assert.equal(readFileSync(humanFile(f.data, wes.id), 'utf8'), `${DE}\n`);
    assert.equal(core.human(wes.id), DE);
    assert.equal(core.info(wes.id, true).human, DE);

    assert.equal(core.setHuman(wes.id, 'No calls before 10:00.\r\nPrices in NOK.  '), 'No calls before 10:00.\nPrices in NOK.');
    assert.equal(readFileSync(humanFile(f.data, wes.id), 'utf8'), 'No calls before 10:00.\nPrices in NOK.\n');
    assert.equal(seedHuman(f.data, wes.id, 'en'), false, 'a file that is there is left alone');
    assert.equal(core.human(wes.id), 'No calls before 10:00.\nPrices in NOK.');

    assert.equal(core.setHuman(wes.id, '   '), '', 'emptied: nothing is appended');
    assert.equal(readFileSync(humanFile(f.data, wes.id), 'utf8'), '');
    core.stop();
  } finally { f.cleanup(); }
});

test('an edit of the instructions and a new standard leave HUMAN.md as the person wrote it', () => {
  const f = coreFixture();
  try {
    f.core.start();
    f.org.setCoreFiles(f.core);
    const wes = f.org.create({ name: 'Wes', instructions: 'Write tight.', createdBy: HUMAN_ID });
    f.core.setHuman(wes.id, 'Mine, not the app\'s.');
    f.org.update(wes.id, { instructions: 'Write tighter.' }, { by: wes.id, reason: 'agents.update' });
    let standard = 'Standard one.';
    const woken: unknown[] = [];
    const s = {
      db: f.db, org: f.org, log: f.log, agentCore: f.core,
      wakes: { wake: (input: unknown) => { woken.push(input); } },
      settings: { get: () => ({ profile: { name: 'Ada' }, permissions: {} }) },
      prompts: { text: () => standard },
    } as unknown as Parameters<typeof syncStandard>[0];
    assert.equal(syncStandard(s, f.org.require(wes.id)), 'quiet');
    standard = 'Standard two.';
    assert.equal(syncStandard(s, f.org.require(wes.id)), 'woken');
    assert.match(f.org.require(wes.id).instructions, /Standard two\./);
    assert.equal(readFileSync(humanFile(f.data, wes.id), 'utf8'), 'Mine, not the app\'s.\n');
  } finally { f.cleanup(); }
});

test('the bridge gives agents from before a missing HUMAN.md once; an existing or emptied one stays', () => {
  const f = coreFixture();
  try {
    const a = f.org.create({ name: 'A', instructions: 'a', createdBy: HUMAN_ID });
    const b = f.org.create({ name: 'B', instructions: 'b', createdBy: HUMAN_ID });
    const c = f.org.create({ name: 'C', instructions: 'c', createdBy: HUMAN_ID });
    f.core.start(); // folders from before: no HUMAN.md yet (no hook at their hire)
    assert.equal(existsSync(humanFile(f.data, a.id)), false);
    writeFileSync(humanFile(f.data, b.id), 'My own line.\n');
    writeFileSync(humanFile(f.data, c.id), '');
    const s = { db: f.db, org: f.org, paths: f.paths, clock: f.time, settings: { get: () => ({ profile: { language: 'en' } }) } } as unknown as Parameters<typeof humanMdPart>[0];
    assert.equal(humanMdPart(s), 1);
    assert.equal(readFileSync(humanFile(f.data, a.id), 'utf8'), `${EN}\n`);
    assert.equal(readFileSync(humanFile(f.data, b.id), 'utf8'), 'My own line.\n');
    assert.equal(readFileSync(humanFile(f.data, c.id), 'utf8'), '');
    rmSync(humanFile(f.data, a.id));
    assert.equal(humanMdPart(s), 0, 'once per PC');
    assert.equal(existsSync(humanFile(f.data, a.id)), false, 'a deleted HUMAN.md does not come back');
  } finally { f.cleanup(); }
});
