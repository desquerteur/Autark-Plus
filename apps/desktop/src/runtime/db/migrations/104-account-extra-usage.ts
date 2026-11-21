// Migration 104 (17.11.2026, Konrad task_bgykyzcx): `extra_usage` 1 lets routing keep a plan (Claude Code, Codex) whose window is
// used up, because its owner allowed the provider's extra usage (Claude "usage credits", ChatGPT "credits": billed by the
// provider) – shared/model/providers.ts Account.extraUsage, runtime/accounts/candidates.ts. 0 for every account until the
// person switches it on; it travels with the account row in the device sync like `credits`.
// Owns: this column. Never: a balance or a price (no provider offers one to read).

export const sql = /* sql */ `
ALTER TABLE accounts ADD COLUMN extra_usage INTEGER NOT NULL DEFAULT 0;
`;
