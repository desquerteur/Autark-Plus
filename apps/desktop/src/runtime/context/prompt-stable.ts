// The STABLE system prompt, in reading order: (1) "# Who I am" (identity.md: facts of me and my place); (2) "# My SYSTEM.md"
// (one line on its folder, then the file without its comments: my whole standing text – how I work, my role, what I have
// here; org/standard.ts keeps the team's standard as a comment at its end); (3) "## My environment" (environment.ts);
// (4) "## Skills" (skills.md and my main skills); (5) "## More tools": every tool my mode offers beyond the engine's
// direct ones, one line each (tools-meta.ts moreToolsSection); (6) "## Rich answers" (shared/blocks/prompt.ts); (7) the
// mode; (8) last, "## From <the person>": the agent's HUMAN.md (agent-core/human.ts – owner 15.11.2026: the person's own
// lines, "unten angehängt"; nothing but the person changes it). The mode is always the agent's own (agents/turn-prepare.ts).
// Nothing here moves by itself: it changes only with the agent's or the person's own act (SYSTEM.md, settings, org,
// mode, skills index empty ↔ not, a learned tool at a fresh session) or with this PC or app version.
// Owns: the placeholder values and section order. Deterministic: the same agent, mode, engine, model tier and settings
// give byte-identical text.
// Never: timestamps, task state, memory or anything else that changes per turn (the live part, prompt-volatile.ts).

import type { RuntimeServices } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { ModeInfo, SkillInfo } from '../../shared/model/knowledge.ts';
import type { RouteDecision } from '../../shared/model/providers.ts';
import type { EngineCaps } from '../engines/types.ts';
import { blockLine } from '../../shared/blocks/prompt.ts';
import type { PromptOptions } from '../../shared/blocks/prompt.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import { toWireName } from '../engines/shared.ts';
import { UI_HELP_TOOL } from '../tools/builtin/ui.ts';
import type { PromptTemplates } from './templates.ts';
import '../contracts/people.ts';
import { coreInstructions, mainSkillsSection, systemMdSection } from '../agent-core/prompt.ts';
import { environmentSection, languageName, offeredTools } from './environment.ts';
import { moreToolsSection } from '../tools/builtin/tools-meta.ts';
import { offeredTools as engineTools } from '../agents/session-key.ts';

const MAX_REPORTS = 15;
const SKILL_DESCRIPTION_CHARS = 300;

export { languageName };

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Placeholder values for the identity template. */
export function identityValues(services: RuntimeServices, agent: Agent): Record<string, string> {
  const profile = safe(() => services.settings.get().profile, undefined);
  const name = profile?.name?.trim() ?? '';
  const boss = agent.managerId ? safe(() => services.people?.get(agent.managerId!), undefined) : undefined; // F-52: a person may manage an agent
  const manager = boss && !boss.owner ? { name: `${boss.name} (colleague, ${agent.managerId})`, role: boss.title }
    : agent.managerId ? safe(() => services.org.get(agent.managerId!), undefined) : undefined;
  const space = agent.spaceId ? safe(() => services.org.spaces().find((item) => item.id === agent.spaceId), undefined) : undefined;
  const reports = safe(() => services.org.list(), [] as Agent[])
    .filter((item) => item.managerId === agent.id && !item.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const reportText = reports.slice(0, MAX_REPORTS).map((item) => (item.role ? `${item.name} (${item.role})` : item.name)).join(', ')
    + (reports.length > MAX_REPORTS ? ` and ${reports.length - MAX_REPORTS} more` : '');
  return {
    agent_name: agent.name,
    agent_role: agent.role?.trim() ?? '',
    team: agent.team?.trim() ?? '',
    space: space?.name ?? '',
    manager_name: manager ? (manager.role ? `${manager.name} (${manager.role})` : manager.name) : '',
    reports: reportText,
    user_given: name ? 'yes' : '',
    user_name: name || 'the person',
    user_label: name || 'CEO',
    company: profile?.company?.trim() ?? '',
    language: languageName(profile?.language),
    timezone: profile?.timezone?.trim() ?? '',
  };
}

/**
 * Block-prompt options: tier for the routed model ('lite' for local/small, mini-apps only for
 * strong/frontier) and the ui.help tool under the name engines see – only when this agent's mode
 * really offers it (the same rule as the turn's tool offer), so the prompt never names a missing tool.
 */
export function blockOptions(services: RuntimeServices, input: { agent: Agent; mode: ModeInfo; route: RouteDecision }): PromptOptions {
  const tier = safe(() => services.catalog.get(input.route.modelId)?.tier, undefined);
  const offered = safe(() => services.tools.specsFor(input.agent, input.mode).some((spec) => spec.name === UI_HELP_TOOL), false);
  return {
    tier: tier === 'local' || tier === 'small' ? 'lite' : 'full',
    app: tier === 'strong' || tier === 'frontier',
    ...(offered ? { helpTool: toWireName(UI_HELP_TOOL) } : {}),
  };
}

/** Mode instructions without a leading "# <Mode> mode" heading (the section has its own). */
function modeBody(mode: ModeInfo): string {
  return mode.instructions.replace(/\r\n?/g, '\n').replace(/^\s*#\s[^\n]*\n+/, '').trim();
}

/** B-049 F5: the mode's one-line description only when it has no instructions (they say the same at length). */
export function modeSection(mode: ModeInfo): string {
  const lines = [`## Mode: ${mode.name}`];
  const body = modeBody(mode);
  if (body) lines.push(body);
  else if (mode.description.trim()) lines.push(mode.description.trim());
  return lines.join('\n');
}

/**
 * "## Skills": the fact line of skills.md (naming knowledge.find / knowledge.open only where `offered` has them) and my main
 * skills by name and description. '' when I have neither (an empty index and no main skill).
 */
export function skillsSection(services: RuntimeServices, templates: PromptTemplates, agent: Agent, mode: ModeInfo, offered: ReadonlySet<string> = offeredTools(services, agent, mode)): string {
  const skills = safe(() => services.skills.indexFor(agent, mode), []);
  const line = (skill: SkillInfo) => `- ${skill.name} – ${excerpt(skill.description, SKILL_DESCRIPTION_CHARS)}`;
  const has = (name: string) => (offered.has(name) ? 'yes' : '');
  const fact = skills.length ? templates.render('skills', { skills: skills.map(line).join('\n'), count: String(skills.length), has_knowledge_find: has('knowledge.find'), has_knowledge_open: has('knowledge.open') }) : '';
  const main = mainSkillsSection(services, agent);
  if (!main) return fact;
  return [fact || '## Skills', main].join('\n');
}

/** "## More tools": what the mode offers beyond this engine's direct tools – the turn's own offer (agents/session-key.ts). */
export function moreToolsFor(services: RuntimeServices, input: { agent: Agent; mode: ModeInfo; route: RouteDecision }): string {
  const usable = safe(() => services.tools.specsFor(input.agent, input.mode), []);
  const caps = safe<Pick<EngineCaps, 'dynamicTools' | 'mcp' | 'ownTools'>>(() => services.engines.get(input.route.engine).caps, { dynamicTools: false, mcp: true, ownTools: true }); // unknown: a CLI engine over the hub
  const direct = safe(() => new Set(engineTools(services, input, caps).names), new Set<string>());
  return moreToolsSection(usable, direct);
}

/** "## From <name>": the agent's HUMAN.md ('' when it has none or it is empty). */
export function humanSection(services: RuntimeServices, agent: Agent, name: string): string {
  const text = safe(() => services.agentCore?.human(agent.id) ?? '', '');
  if (!text) return '';
  return [`## From ${name}`, safe(() => services.secrets.redact(text), text)].join('\n');
}

export function buildStable(services: RuntimeServices, templates: PromptTemplates, input: { agent: Agent; mode: ModeInfo; route: RouteDecision }): string {
  const { agent, mode, route } = input;
  const offered = offeredTools(services, agent, mode); // one offer for the skills line and the environment (the turn's own rule)
  const values = identityValues(services, agent);
  const file = coreInstructions(services, agent);
  return [
    templates.render('identity', values),
    systemMdSection(services, agent, file ? safe(() => services.secrets.redact(file), file) : ''),
    environmentSection(services, { agent, mode, route }, offered), // this PC, workspace, web, screen
    skillsSection(services, templates, agent, mode, offered),
    moreToolsFor(services, { agent, mode, route }),
    blockLine(blockOptions(services, { agent, mode, route })), // one line; the quick reference is ui.help "blocks"
    modeSection(mode),
    humanSection(services, agent, values.user_name), // owner 15.11.2026: the person's own lines stand last
  ].filter((section) => section.trim()).join('\n\n');
}
