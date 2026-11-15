// Migration 94 (08.11.2026, B-080 model-set B): an agent's own model request for a task holds for every turn on that
// task, in whichever chat it runs – kv 'next_route_task' is keyed `<agent>:<task>` (agents/next-route.ts). Rows of the
// older key `<agent>:<chat>:<task>` (the chat empty for a run without one) get the new key; when two of one task
// meet, the newest (updated_at) stays. Rows already in the new form stay as they are.
// Owns: this re-keying. Never: the requests' values, other kv rows, or edits of shipped migrations.

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
