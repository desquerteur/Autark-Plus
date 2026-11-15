// Migration 93 (08.11.2026, B-080 F5): a task keeps the files it was posted with in its own row – `files`, JSON in the
// shape of messages.attachments ([] = none). A quick task has no anchor message to carry them, and the per-PC kv
// namespace 'task_quick_post' they lived in never reached the person's other PCs (live 05.11.: a dictated task kept
// only its file's name). Each quick task's files there are copied into its row; then that namespace goes.
// Owns: this column and that one copy. Never: other kv rows, or edits of shipped migrations.

export const sql = /* sql */ `
ALTER TABLE tasks ADD COLUMN files TEXT NOT NULL DEFAULT '[]';
UPDATE tasks SET files = (
    SELECT json_extract(kv.value, '$.attachments') FROM kv WHERE kv.ns = 'task_quick_post' AND kv.key = tasks.id)
  WHERE id IN (
    SELECT key FROM kv WHERE ns = 'task_quick_post'
      AND json_type(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$.attachments') = 'array');
DELETE FROM kv WHERE ns = 'task_quick_post';
`;
