// Migration 103 (16.11.2026, owner F19: "die am häufigsten verwendeten … dass die ihr dann auch direkt angezeigt bekommt"):
// how often a secret was used – each field and its login (secrets/service.ts use() counts both). secrets.list leads with the
// entries in use and breaks ties by it (tools/builtin/secrets.ts). The count is this PC's own: the device sync between the CEO's
// PCs neither carries nor writes it (devices/sync/secrets.ts sends units without it; the vault's save and saveGroup leave it).
// Owns: these columns. Never: data rows, or edits of shipped migrations.

export const sql = /* sql */ `
ALTER TABLE secrets ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE secret_groups ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
`;
