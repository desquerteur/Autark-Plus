// Migration 106 (17.11.2026, Konrad task_d4pdwppg "Videos im Chat flüssig"): a heavy video's light preview copy. `preview_file_id` names the
// stored copy (a blob of its own, no media row of its own) the players use instead of the original; `preview_state` says why a video has none
// ('small', 'light', 'long' – no copy needed or possible; 'failed' – tried and not made; null – not decided yet, or not tried on this PC).
// Owns: these columns. Never: the copy's bytes (the blob store holds them) or edits of shipped migrations.

export const sql = /* sql */ `
ALTER TABLE media ADD COLUMN preview_file_id TEXT;
ALTER TABLE media ADD COLUMN preview_state TEXT;
CREATE INDEX IF NOT EXISTS media_preview_file ON media(preview_file_id) WHERE preview_file_id IS NOT NULL;
`;
