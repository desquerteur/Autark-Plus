// Migration 102 (13.11.2026, task system rebuilt): every unfinished task has one planned look – next_at, when the
// watcher looks at it next (runtime/tasks/next.ts, watch.ts); its index serves the watcher's query. Old rows are brought
// to the four states by the bridge (runtime/bridge/kontext-1311.ts), so older PCs keep reading every row.
// Owns: this column and index. Never: drops a column, deletes a row, or edits a shipped migration.

export const sql = /* sql */ `
ALTER TABLE tasks ADD COLUMN next_at INTEGER;
CREATE INDEX IF NOT EXISTS tasks_next ON tasks(next_at) WHERE next_at IS NOT NULL;
`;
