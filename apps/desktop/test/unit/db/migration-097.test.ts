// Migration 97 (runtime/db/migrations/097-template-effort.ts, B-083, owner 08.11.2026): an agent hired from a template
// loses the fixed effort it copied from it while that effort still equals the template's shipped value; an effort set
// later to another value, an agent without a template and a row that is not valid JSON stay as they are.
// Owns: checks of this data step on a migrate({until: 96}) fixture. Never: hiring or routing behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate, SCHEMA_VERSION } from '../../../src/runtime/db/migrate.ts';

const policy = (db: Db, id: string) => db.get<{ model_policy: string }>('SELECT model_policy FROM agents WHERE id = ?', [id])?.model_policy;

test('migration 97 drops a template\'s shipped effort and keeps every other effort and row', () => {
  const db = new Db(':memory:');
  migrate(db, { until: 96 });
  const add = (id: string, template: string | null, modelPolicy: string) => db.run(
    `INSERT INTO agents (id, name, avatar, model_policy, template, created_by, created_at, updated_at) VALUES (?, ?, '{}', ?, ?, 'human', 0, 0)`,
    [id, id, modelPolicy, template]);
  add('ag_writer', 'writer', '{"effort":"high","pin":"claude:claude-opus-5-5"}');
  add('ag_secretary', 'secretary', '{"effort":"medium"}');
  add('ag_researcher', 'researcher', '{"effort":"max"}');
  add('ag_own', null, '{"effort":"high"}');
  add('ag_head', 'head', '{"effort":"medium"}');
  add('ag_broken', 'writer', 'not json');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 97);
  assert.deepEqual(JSON.parse(policy(db, 'ag_writer')!), { pin: 'claude:claude-opus-5-5' }, 'the template\'s effort goes, the pin stays');
  assert.deepEqual(JSON.parse(policy(db, 'ag_secretary')!), {});
  assert.deepEqual(JSON.parse(policy(db, 'ag_researcher')!), { effort: 'max' }, 'an effort set later to another value stays');
  assert.deepEqual(JSON.parse(policy(db, 'ag_own')!), { effort: 'high' }, 'an agent without a template keeps its effort');
  assert.deepEqual(JSON.parse(policy(db, 'ag_head')!), { effort: 'medium' }, 'a template that shipped no effort: its agent keeps one');
  assert.equal(policy(db, 'ag_broken'), 'not json', 'a row that is not valid JSON is untouched');
  assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION }, 'applied once');
});
