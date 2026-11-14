// Migration 95 (official 0.3.5): an account may say it pays from prepaid credits (accounts.credits 0/1).
// Taken over unchanged from the official Autark 0.3.5 (teydra/OpenAutark, Apache-2.0, release build of 09.11.2026),
// whose public source stopped at 091: a profile that official build migrated must open in this fork (AF-022).
// Owns: this column. Never: data rows, or edits of shipped migrations.

export const sql = /* sql */ `
ALTER TABLE accounts ADD COLUMN credits INTEGER NOT NULL DEFAULT 0;
`;
