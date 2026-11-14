// Migration 93 (official 0.3.5): a task carries its files itself (tasks.files, JSON list of attachments) – the files of
// quick tasks move there from kv 'task_quick_post' (tasks/quick.ts quickFiles), whose rows then go.
// Taken over unchanged from the official Autark 0.3.5 (teydra/OpenAutark, Apache-2.0, release build of 09.11.2026),
// whose public source stopped at 091: a profile that official build migrated must open in this fork (AF-022).
// Owns: this column and that move. Never: edits of shipped migrations.

export const sql = /* sql */ `
ALTER TABLE tasks ADD COLUMN files TEXT NOT NULL DEFAULT '[]';
UPDATE tasks SET files = (
    SELECT json_extract(kv.value, '$.attachments') FROM kv WHERE kv.ns = 'task_quick_post' AND kv.key = tasks.id)
  WHERE id IN (
    SELECT key FROM kv WHERE ns = 'task_quick_post'
      AND json_type(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$.attachments') = 'array');
DELETE FROM kv WHERE ns = 'task_quick_post';
`;
