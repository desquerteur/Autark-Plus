// Migration 108 (KI-Runde 17.11.2026, package C): a native session binding keeps the engine's running cost total at the
// thread's last turn (cost_total, Claude Code's total_cost_usd, which counts the whole session) and the session ref it counts
// (cost_ref) – a turn's own cost is the difference to it. NULL: none kept yet (a row from before, an engine without a total).
// Owns: the two columns.
export const sql = `ALTER TABLE engine_sessions ADD COLUMN cost_total REAL;
ALTER TABLE engine_sessions ADD COLUMN cost_ref TEXT;`;
