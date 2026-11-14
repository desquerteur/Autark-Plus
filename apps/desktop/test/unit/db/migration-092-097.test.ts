// Migrations 92–97 (AF-022): taken over unchanged from the official 0.3.5 (teydra/OpenAutark, Apache-2.0), so a profile
// that build migrated opens in this fork. New columns with defaults, quick tasks' files moved into tasks.files, task
// route keys per (agent, task), template agents' old fixed effort gone – and the fork's readers follow the moved data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate, SCHEMA_VERSION } from '../../../src/runtime/db/migrate.ts';
import { quickFiles, setQuickFiles } from '../../../src/runtime/tasks/quick.ts';
import { pendingRoute, setTaskRoute } from '../../../src/runtime/agents/next-route.ts';

const columns = (db: Db, table: string) => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((row) => row.name);

function at91(): Db {
  const db = new Db(':memory:');
  migrate(db, { until: 91 });
  db.exec(`INSERT INTO agents (id, name, avatar, created_by, created_at, updated_at, template, model_policy) VALUES
    ('a1', 'R', 'x', 'human', 1, 1, 'researcher', '{"effort":"high","model":"m"}'),
    ('a2', 'W', 'x', 'human', 1, 1, 'writer', '{"effort":"low"}'),
    ('a3', 'O', 'x', 'human', 1, 1, NULL, '{"effort":"high"}')`);
  db.exec(`INSERT INTO tasks (id, title, created_by, created_at, updated_at) VALUES ('t1', 'one', 'human', 1, 1), ('t2', 'two', 'human', 1, 1)`);
  db.exec(`INSERT INTO kv (ns, key, value, updated_at) VALUES
    ('task_quick_post', 't1', '{"attachments":[{"fileId":"f1","name":"memo.wav","mime":"audio/wav","size":3}]}', 1),
    ('task_quick_post', 't2', 'not json', 1),
    ('next_route_task', 'a1:c1:t1', '{"modelId":"old","at":1}', 1),
    ('next_route_task', 'a1:c2:t1', '{"modelId":"new","at":2}', 2),
    ('next_route_task', 'a1:t9', '{"modelId":"kept","at":3}', 3)`);
  return db;
}

test('migrations 92–97 bring a fork profile at 91 to the official 0.3.5 schema without losing rows', () => {
  const db = at91();
  assert.deepEqual(migrate(db), { from: 91, to: SCHEMA_VERSION });
  assert.equal(SCHEMA_VERSION, 97);
  assert.equal(db.get<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema'`)!.value, '97');
  assert.ok(columns(db, 'split_groups').includes('parent_session'));
  assert.ok(columns(db, 'splits').includes('temperature'));
  assert.ok(columns(db, 'accounts').includes('credits'));
  assert.ok(columns(db, 'tasks').includes('files'));
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n, 2);

  // 93: the quick task's files are on the task now, the kv rows are gone; the fork reads them there.
  assert.deepEqual(quickFiles(db, 't1').map((file) => file.fileId), ['f1']);
  assert.deepEqual(quickFiles(db, 't2'), []);
  assert.equal(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM kv WHERE ns = 'task_quick_post'`)!.n, 0);
  setQuickFiles(db, 't2', [{ fileId: 'f2', name: 'b.png', mime: 'image/png', size: 1 } as never]);
  assert.deepEqual(quickFiles(db, 't2').map((file) => file.fileId), ['f2']);

  // 94: one key per (agent, task), the newest request wins; the fork's reader finds it from any chat.
  const keys = db.all<{ key: string }>(`SELECT key FROM kv WHERE ns = 'next_route_task' ORDER BY key`).map((row) => row.key);
  assert.deepEqual(keys, ['a1:t1', 'a1:t9']);
  assert.equal(pendingRoute(db, 'a1', 'c3', 't1', () => false)?.modelId, 'new');
  assert.equal(pendingRoute(db, 'a1', 'c1', 't9', (task) => task === 't1')?.modelId, 'kept');
  assert.equal(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM kv WHERE ns = 'next_route_task' AND key = 'a1:t1'`)!.n, 0, 'a finished task\'s request goes');
  setTaskRoute(db, 'a2', 'c1', 't2', { modelId: 'm2', at: 5 });
  assert.equal(pendingRoute(db, 'a2', 'other-chat', 't2', () => false)?.modelId, 'm2');

  // 97: only a template's old fixed effort goes.
  const policy = (id: string) => JSON.parse(db.get<{ model_policy: string }>('SELECT model_policy FROM agents WHERE id = ?', [id])!.model_policy);
  assert.deepEqual(policy('a1'), { model: 'm' });
  assert.deepEqual(policy('a2'), { effort: 'low' });
  assert.deepEqual(policy('a3'), { effort: 'high' });

  assert.deepEqual(migrate(db), { from: 97, to: 97 }, 'applied once');
});

test('a profile the official 0.3.5 left at 97 opens without "newer than this app"', () => {
  const db = new Db(':memory:');
  migrate(db);
  assert.doesNotThrow(() => migrate(db));
});
