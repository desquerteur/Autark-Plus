// Migration 94 (official 0.3.5): a task's model request is kept per (agent, task), no longer per (agent, chat, task) –
// kv 'next_route_task' keys 'agent:chat:task' become 'agent:task' (the newest wins), the old keys go (agents/next-route.ts).
// Taken over unchanged from the official Autark 0.3.5 (teydra/OpenAutark, Apache-2.0, release build of 09.11.2026),
// whose public source stopped at 091: a profile that official build migrated must open in this fork (AF-022).
// Owns: those kv keys. Never: edits of shipped migrations.

export const sql = /* sql */ `
INSERT INTO kv (ns, key, value, updated_at)
  SELECT 'next_route_task', agent || ':' || substr(rest, instr(rest, ':') + 1), value, updated_at
  FROM (SELECT substr(key, 1, instr(key, ':') - 1) AS agent, substr(key, instr(key, ':') + 1) AS rest, value, updated_at
        FROM kv WHERE ns = 'next_route_task' AND instr(key, ':') > 0)
  WHERE instr(rest, ':') > 0
  ORDER BY updated_at
  ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE excluded.updated_at >= kv.updated_at;
DELETE FROM kv WHERE ns = 'next_route_task' AND instr(key, ':') > 0 AND instr(substr(key, instr(key, ':') + 1), ':') > 0;
`;
