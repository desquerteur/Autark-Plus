// B-080 migrations 93 and 94 (runtime/db/migrations/093-task-files.ts, 094-task-route-keys.ts): tasks.files (JSON,
// '[]' by default) with each quick task's files copied in from the per-PC kv namespace 'task_quick_post', which then
// goes (a broken kv value copies nothing); and kv 'next_route_task' rows of the old `<agent>:<chat>:<task>` key
// re-keyed to `<agent>:<task>` – the newest stays when two of one task meet, other kv rows stay as they are.
// Owns: checks of these schema steps on migrate({until: 92}) fixtures. Never: task or routing behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate, SCHEMA_VERSION } from '../../../src/runtime/db/migrate.ts';

const T = 1_700_000_000_000;
const WAV = { fileId: 'a'.repeat(64), name: 'memo.wav', mime: 'audio/wav', size: 2048 };

function fixture(): Db {
  const db = new Db(':memory:');
  migrate(db, { until: 92 });
  const task = (id: string) => db.run(`INSERT INTO tasks (id, title, notes, status, assignee_kind, created_by, priority, ledger, attempts, sort, rev, created_at, updated_at)
    VALUES (?, ?, '', 'open', 'team', 'human', 0, '{}', 0, 0, 0, ?, ?)`, [id, id, T, T]);
  task('task_quick');
  task('task_plain');
  task('task_broken');
  const kv = (ns: string, key: string, value: string, at: number) => db.run('INSERT INTO kv (ns, key, value, updated_at) VALUES (?, ?, ?, ?)', [ns, key, value, at]);
  kv('task_quick_post', 'task_quick', JSON.stringify({ attachments: [WAV] }), T);
  kv('task_quick_post', 'task_broken', 'not json', T);
  kv('task_quick_post', 'task_gone', JSON.stringify({ attachments: [WAV] }), T); // its task was deleted
  kv('next_route_task', 'ag_ava:ch_1:task_1', JSON.stringify({ effort: 'medium', at: 1 }), 1);
  kv('next_route_task', 'ag_ava:ch_2:task_1', JSON.stringify({ effort: 'high', at: 5 }), 5);
  kv('next_route_task', 'ag_ava::task_2', JSON.stringify({ effort: 'low', at: 3 }), 3);
  kv('next_route_task', 'ag_bo:task_3', JSON.stringify({ effort: 'xhigh', at: 9 }), 9);
  kv('next_route', 'ag_ava:ch_1', JSON.stringify({ at: 2 }), 2);
  return db;
}

test('migration 93: tasks.files with the quick tasks\' files copied in; the per-PC namespace goes', () => {
  const db = fixture();
  assert.deepEqual(migrate(db), { from: 92, to: SCHEMA_VERSION });
  assert.ok(SCHEMA_VERSION >= 94);
  const files = (id: string) => db.get<{ files: string }>('SELECT files FROM tasks WHERE id = ?', [id])?.files;
  assert.deepEqual(JSON.parse(files('task_quick')!), [WAV]);
  assert.equal(files('task_plain'), '[]');
  assert.equal(files('task_broken'), '[]', 'a broken value copies nothing');
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM kv WHERE ns = 'task_quick_post'")?.n, 0);
  const column = db.all<{ name: string; notnull: number; dflt_value: string | null }>(`SELECT name, "notnull", dflt_value FROM pragma_table_info('tasks')`).find((c) => c.name === 'files');
  assert.deepEqual({ notnull: column?.notnull, dflt: column?.dflt_value }, { notnull: 1, dflt: `'[]'` });
});

test('migration 94: task requests keyed by agent and task – the newest of one task stays; new keys and other rows stay', () => {
  const db = fixture();
  migrate(db);
  const rows = db.all<{ ns: string; key: string; value: string }>("SELECT ns, key, value FROM kv WHERE ns IN ('next_route', 'next_route_task') ORDER BY ns, key")
    .map((row) => ({ ns: row.ns, key: row.key, effort: (JSON.parse(row.value) as { effort?: string }).effort }));
  assert.deepEqual(rows, [
    { ns: 'next_route', key: 'ag_ava:ch_1', effort: undefined },
    { ns: 'next_route_task', key: 'ag_ava:task_1', effort: 'high' },
    { ns: 'next_route_task', key: 'ag_ava:task_2', effort: 'low' },
    { ns: 'next_route_task', key: 'ag_bo:task_3', effort: 'xhigh' },
  ]);
});
