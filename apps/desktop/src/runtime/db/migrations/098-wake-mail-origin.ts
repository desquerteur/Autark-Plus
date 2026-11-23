// Owns: durable runtime-authored mail origin on wakes. Never: grants an execution capability.
export const sql = `ALTER TABLE wakes ADD COLUMN mail_origin TEXT;`;
