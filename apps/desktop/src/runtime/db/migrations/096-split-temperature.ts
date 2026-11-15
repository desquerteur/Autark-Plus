// Migration 96 (08.11.2026, B-083 Ultra): a part's temperature (Split.temperature, 0..2) like its model and effort –
// agents.split sets it, agents.split_tell changes it; engines that sample with one send it (split-turn.ts planSplit).
// Owns: this column. Never: data rows, or edits of shipped migrations.

export const sql = /* sql */ `
ALTER TABLE splits ADD COLUMN temperature REAL;
`;
