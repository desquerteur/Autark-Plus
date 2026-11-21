// Migration 92 (08.11.2026, B-080): a split group keeps the native session its parent's splitting turn ended with
// (SplitGroup.parentSession, JSON: engine, account, ref, context tokens, native turn id), recorded when the group starts –
// a 'fork' part forks that session through that turn, whatever the parent's later turns do to its binding
// (runtime/splits/fork.ts). Groups from before stay without one (their 'fork' parts start from the text seed).
// Owns: this column. Never: data rows, or edits of shipped migrations.

export const sql = /* sql */ `
ALTER TABLE split_groups ADD COLUMN parent_session TEXT;
`;
