// Migration 103 (runtime/db/migrations/103-secret-uses.ts, F19 16.11.2026): secrets and secret_groups get `uses` on a database of
// the previous version; a row stored before reads 0 (no count in its SecretInfo), it is applied once.
// Owns: checks of this schema step. Never: the vault's behaviour (test/unit/secrets/catalog.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate, SCHEMA_VERSION } from '../../../src/runtime/db/migrate.ts';
import { toGroup, toInfo, type GroupRow, type SecretRow } from '../../../src/runtime/secrets/groups.ts';

test('migration 103 adds uses to secrets and secret_groups; rows stored before count 0', () => {
  const db = new Db(':memory:');
  migrate(db, { until: 102 });
  db.run(`INSERT INTO secret_groups (id, label, kind, created_at, last_used_at) VALUES ('sgr_old', 'Old login', 'login', 1, 5)`);
  db.run(`INSERT INTO secrets (id, label, kind, created_at, last_used_at, group_id, field) VALUES ('sec_field', 'Old login · password', 'password', 1, 5, 'sgr_old', 'password')`);
  db.run(`INSERT INTO secrets (id, label, kind, created_at) VALUES ('sec_old', 'Old key', 'api_key', 1)`);
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 103);
  for (const table of ['secrets', 'secret_groups']) {
    assert.ok(db.all<{ name: string }>(`PRAGMA table_info(${table})`).some((column) => column.name === 'uses'), table);
  }
  assert.deepEqual(db.all<{ uses: number }>('SELECT uses FROM secrets ORDER BY id').map((row) => row.uses), [0, 0]);
  assert.equal(db.get<{ uses: number }>(`SELECT uses FROM secret_groups WHERE id = 'sgr_old'`)!.uses, 0);
  const info = toInfo(db.get<SecretRow>(`SELECT * FROM secrets WHERE id = 'sec_old'`)!);
  assert.equal(info.uses, undefined, 'never used: no count');
  assert.equal(toGroup(db.get<GroupRow>(`SELECT * FROM secret_groups WHERE id = 'sgr_old'`)!).lastUsedAt, 5, 'the last use stays');
  assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION }, 'applied once');
});
