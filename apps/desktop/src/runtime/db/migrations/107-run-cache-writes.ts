// Migration 107 (KI-Runde 17.11.2026, package C): a run keeps the input tokens its turn wrote into the provider's cache
// (cache_write_tokens, a part of input_tokens beside cached_tokens) – on Claude a written token costs its own price, so a run's
// cost can be recomputed from its tokens. NULL where the engine reported none (an old row, an engine without cache writes).
// Owns: the column. Never: fills old rows with guesses.
export const sql = `ALTER TABLE runs ADD COLUMN cache_write_tokens INTEGER;`;
