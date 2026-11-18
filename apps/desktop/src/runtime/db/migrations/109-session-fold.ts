// Migration 109 (KI-Runde 17.11.2026, package S1 – the context fold, agents/context-fold.ts):
// - a native session binding keeps when its context was folded (folded_at: the fold turn on it ended done and the ledger
//   holds its hand-over – the next turn starts the session anew from the folded record) and when the engine compacted it by
//   itself (compacted_at: a fold is due for that cause until one ran). NULL: not folded, not compacted. Another session
//   ref or a new generation of it (a rebuild) clears both (agents/sessions.ts save);
// - the context ledger's sizes move to the one unit of two characters per token (shared/model/context-ledger.ts
//   CHARS_PER_TOKEN): every row there was counted at three characters per token, so it is scaled by 3/2.
// Owns: the two columns and that one rescale.
export const sql = `ALTER TABLE engine_sessions ADD COLUMN folded_at INTEGER;
ALTER TABLE engine_sessions ADD COLUMN compacted_at INTEGER;
UPDATE context_items SET tokens = (tokens * 3 + 1) / 2;`;
