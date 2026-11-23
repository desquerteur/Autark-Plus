// Owns: durable runtime-authored mail identity on run replay. Never: issues authority.
export const sql = `ALTER TABLE runs ADD COLUMN mail_origin TEXT;`;
