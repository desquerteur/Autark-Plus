// Migration 105 (17.11.2026, Konrad task_bgykyzcx #109): `this_pc_only` 1 keeps a plan login's account row and its login files on this PC –
// the device sync (devices/sync/tables.ts accounts) and the login sync (devices/sync/logins.ts) skip it. 0 for every account that exists:
// those stay as they are (shared). Set by "Use" on a found login ("Only on this PC", the default) and by the person's switch in the account row.
// Owns: this column. Never: which PCs a company has.

export const sql = /* sql */ `
ALTER TABLE accounts ADD COLUMN this_pc_only INTEGER NOT NULL DEFAULT 0;
`;
