// Migration 97 (B-083, owner 08.11.2026: agents run "fast nur Medium Thinking, was ich irgendwie komisch finde"):
// every hire template in resources/agents/*.md carried an `effort:` line (medium or high), and org/hire.ts stored it
// as the agent's fixed effort, which routing applied to every turn – so the agent never chose its own. The templates
// no longer carry one and a hire starts with an empty model policy; here an agent hired from a template loses the
// effort it got from it, when that effort still equals the value the template shipped. An effort someone set later
// to another value stays, as do other agents, other policy keys and rows that are not valid JSON (as in 076).
// Owns: this data move. Never: other agents, other policy keys.

export const sql = /* sql */ `
UPDATE agents SET model_policy = json_remove(model_policy, '$.effort')
WHERE json_valid(model_policy) AND template || ':' || json_extract(model_policy, '$.effort') IN (
  'ceo-assistant:medium', 'computer-operator:high', 'content-creator:medium', 'customer-support:medium',
  'designer:medium', 'finance-bookkeeper:medium', 'legal-assistant:high', 'marketing-lead:high',
  'operations:medium', 'researcher:high', 'sales-outreach:medium', 'secretary:medium',
  'social-media:medium', 'video-editor:high', 'web-developer:high', 'writer:high'
);
`;
