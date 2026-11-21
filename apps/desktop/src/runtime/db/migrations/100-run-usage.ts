// B-089 (11.11.2026: what a run costs, written down): a run keeps the part of its input the provider served from its
// cache (cached_tokens, a part of input_tokens) and how many model requests the turn made (model_calls). Both stay NULL
// where the engine reported nothing – an old row, or an engine that gives no count.
// Owns: the two columns. Never: fills old rows with guesses.
export const sql = `ALTER TABLE runs ADD COLUMN cached_tokens INTEGER;
ALTER TABLE runs ADD COLUMN model_calls INTEGER;`;
