// HUMAN.md (owner 15.11.2026, agent-core/human.ts): the person's lines to an agent, beside SYSTEM.md.
// - owner 16.11.2026: the "I'm not a robot" line stands once for every agent (settings profile.forEveryAgent, its
//   default by language); a hire starts without a HUMAN.md and shows an empty field;
// - the person writes it (setHuman / agents.setHuman), agents.core shows it;
// - an edit of the instructions and a new standard (org/standard.ts) leave it as it is;
// - the bridge empties, once per PC, a HUMAN.md of an agent at home here that holds only the default line (either
//   language) – a HUMAN.md with anything else, an empty one and a missing one stay as they are.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { humanFile } from '../../../src/runtime/agent-core/human.ts';
import { humanDefault } from '../../../src/shared/model/agent-core.ts';
import { humanMdPart } from '../../../src/runtime/bridge/kontext-1311.ts';
import { syncStandard } from '../../../src/runtime/org/standard.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { coreFixture } from './fixture.ts';

const DE = '„Ich bin kein Roboter“-Prüfungen (CAPTCHAs) löse ich nicht.';
const EN = 'I don\'t solve "I\'m not a robot" checks (CAPTCHAs).';

test('the default line follows the app language', () => {
  assert.equal(humanDefault('de'), DE);
  assert.equal(humanDefault('de-AT'), DE);
  assert.equal(humanDefault('en'), EN);
  assert.equal(humanDefault(undefined), EN);
});

test('a hire starts without a HUMAN.md; the person writes it and empties it', () => {
  const f = coreFixture();
  try {
    f.core.start();
    f.org.setCoreFiles(f.core);
    const wes = f.org.create({ name: 'Wes', role: 'Writer', instructions: 'Write tight.', createdBy: HUMAN_ID });
    assert.equal(existsSync(humanFile(f.data, wes.id)), false, 'the robot line stands for every agent in settings');
    assert.equal(f.core.human(wes.id), '');
    assert.equal(f.core.info(wes.id, true).human, '', 'the agent page shows an empty field');

    assert.equal(f.core.setHuman(wes.id, 'No calls before 10:00.\r\nPrices in NOK.  '), 'No calls before 10:00.\nPrices in NOK.');
    assert.equal(readFileSync(humanFile(f.data, wes.id), 'utf8'), 'No calls before 10:00.\nPrices in NOK.\n');
    assert.equal(f.core.human(wes.id), 'No calls before 10:00.\nPrices in NOK.');

    assert.equal(f.core.setHuman(wes.id, '   '), '', 'emptied: nothing is appended');
    assert.equal(readFileSync(humanFile(f.data, wes.id), 'utf8'), '');
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
    const s = {
      db: f.db, org: f.org, log: f.log, agentCore: f.core, clock: { now: () => 1 },
      settings: { get: () => ({ profile: { name: 'Ada' }, permissions: {} }) },
      prompts: { text: () => standard },
    } as unknown as Parameters<typeof syncStandard>[0];
    assert.equal(syncStandard(s, f.org.require(wes.id)), 'quiet');
    standard = 'Standard two.';
    assert.equal(syncStandard(s, f.org.require(wes.id)), 'noted');
    assert.match(f.org.require(wes.id).instructions, /Standard two\./);
    assert.equal(readFileSync(humanFile(f.data, wes.id), 'utf8'), 'Mine, not the app\'s.\n');
  } finally { f.cleanup(); }
});

test('the bridge empties a HUMAN.md that holds only the default line, once per PC; every other one stays', () => {
  const f = coreFixture();
  try {
    const [de, en, own, empty, none] = ['De', 'En', 'Own', 'Empty', 'None'].map((name) => f.org.create({ name, instructions: name, createdBy: HUMAN_ID }));
    f.core.start();
    writeFileSync(humanFile(f.data, de.id), `${DE}\n`);
    writeFileSync(humanFile(f.data, en.id), `  ${EN}\r\n`);
    writeFileSync(humanFile(f.data, own.id), `${EN}\nAnd no calls before 10:00.\n`);
    writeFileSync(humanFile(f.data, empty.id), '');
    const s = { db: f.db, org: f.org, paths: f.paths, clock: f.time } as unknown as Parameters<typeof humanMdPart>[0];
    assert.equal(humanMdPart(s), 2);
    assert.equal(readFileSync(humanFile(f.data, de.id), 'utf8'), '');
    assert.equal(readFileSync(humanFile(f.data, en.id), 'utf8'), '');
    assert.equal(readFileSync(humanFile(f.data, own.id), 'utf8'), `${EN}\nAnd no calls before 10:00.\n`, 'the person\'s own words stay');
    assert.equal(readFileSync(humanFile(f.data, empty.id), 'utf8'), '');
    assert.equal(existsSync(humanFile(f.data, none.id)), false, 'nothing is written where there was none');
    writeFileSync(humanFile(f.data, de.id), `${DE}\n`);
    assert.equal(humanMdPart(s), 0, 'once per PC');
    assert.equal(readFileSync(humanFile(f.data, de.id), 'utf8'), `${DE}\n`, 'a line the person writes again later stays');
  } finally { f.cleanup(); }
});
