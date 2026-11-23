// The kontext-1311 bridge's tool-name part: tools an agent learned to hold directly under a name the 13.11. rebuild
// merged take the tool that does it now, each once; a second run changes nothing.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RENAMED_TOOLS, renameInSystemMd, renameLearned, withToolNames } from '../../../src/runtime/bridge/kontext-1311.ts';
import { LEARNED_NS } from '../../../src/runtime/tools/learned.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { clock, memoryDb } from '../store/helpers.ts';

test('learned tools under a merged name become the tool that does it now, once each; idempotent', () => {
  const db = memoryDb();
  const s = { db, clock: clock() } as unknown as Pick<RuntimeServices, 'db' | 'clock'>;
  const kv = new KvRepo(db);
  kv.set(LEARNED_NS, 'ag_a', { core: ['skills.load', 'knowledge.open', 'secrets.run'], used: ['knowledge.recall', 'references.find'] }, 1);
  kv.set(LEARNED_NS, 'ag_b', { core: ['schedules.remind'], used: [] }, 1);
  assert.equal(renameLearned(s), 1);
  assert.deepEqual(kv.get(LEARNED_NS, 'ag_a'), { core: ['knowledge.open', 'shell.exec'], used: ['knowledge.find'] });
  assert.deepEqual(kv.get(LEARNED_NS, 'ag_b'), { core: ['schedules.remind'], used: [] }, 'nothing merged: untouched');
  assert.equal(renameLearned(s), 0, 'a second run changes nothing');
  for (const now of Object.values(RENAMED_TOOLS)) assert.ok(!(now in RENAMED_TOOLS), `${now} is a name of today`);
});

test('a SYSTEM.md names the tool that does it now; other names and words stay; idempotent', () => {
  assert.equal(withToolNames('Ich nutze ihn nur per Handle – secrets.run mit env LUMO_QA_USER. Dann skills.load, nicht my.secrets.run oder secrets.runner.'),
    'Ich nutze ihn nur per Handle – shell.exec mit env LUMO_QA_USER. Dann knowledge.open, nicht my.secrets.run oder secrets.runner.');
  const agents = [{ id: 'ag_ida', instructions: '## My role\nchat.notes.append for notes, knowledge.find to look.' }, { id: 'ag_jonas', instructions: '## My role\nNothing old.' }];
  const updates: Array<[string, string]> = [];
  const org = { list: () => agents, get: (id: string) => agents.find((a) => a.id === id), update: (id: string, patch: { instructions: string }) => { updates.push([id, patch.instructions]); agents.find((a) => a.id === id)!.instructions = patch.instructions; } };
  const s = { db: memoryDb(), org } as unknown as Parameters<typeof renameInSystemMd>[0];
  assert.equal(renameInSystemMd(s), 1);
  assert.deepEqual(updates, [['ag_ida', '## My role\nchat.notes.write for notes, knowledge.find to look.']]);
  assert.equal(renameInSystemMd(s), 0, 'a second run changes nothing');
});
