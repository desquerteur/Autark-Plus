// Migration 97 (official 0.3.5): seeded template agents whose effort still equals the template's old fixed one lose it
// (model_policy.effort), so the router picks the effort; an effort the person changed stays.
// Taken over unchanged from the official Autark 0.3.5 (teydra/OpenAutark, Apache-2.0, release build of 09.11.2026),
// whose public source stopped at 091: a profile that official build migrated must open in this fork (AF-022).
// Owns: that field of those agents. Never: other agents, or edits of shipped migrations.

export const sql = /* sql */ `
UPDATE agents SET model_policy = json_remove(model_policy, '$.effort')
WHERE json_valid(model_policy) AND template || ':' || json_extract(model_policy, '$.effort') IN (
  'ceo-assistant:medium', 'computer-operator:high', 'content-creator:medium', 'customer-support:medium',
  'designer:medium', 'finance-bookkeeper:medium', 'legal-assistant:high', 'marketing-lead:high',
  'operations:medium', 'researcher:high', 'sales-outreach:medium', 'secretary:medium',
  'social-media:medium', 'video-editor:high', 'web-developer:high', 'writer:high'
);
`;
