// Migration 101 (13.11.2026, chat rework): the chat a split part's work is for (Split.chat) – its run carries it as its
// conversation_id, so the chat's live bar shows the part there (agents.split part `chat`) – and when its result reached its
// origin (Split.gatheredAt: each part returns on its own, as soon as it ends).
// Owns: this column. Never: data rows, or edits of shipped migrations.

export const sql = /* sql */ `
ALTER TABLE splits ADD COLUMN chat TEXT;
ALTER TABLE splits ADD COLUMN gathered_at INTEGER;
`;
