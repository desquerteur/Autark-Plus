// Skill tools: knowledge.find lists skills and knowledge.open loads one (find.ts); a skill is a plain folder with SKILL.md
// (skills/service.ts) an agent may also write or change like any file.
// Owns: skills.save (with the skill's modes; main: true writes one of the agent's own main skills; a built-in name becomes
// an own copy; from: a public library entry's files written beside it and derived-from "library:<id>@<rev>" recorded) and
// loadedSkillText (a skill's text as the subconscious's own skill opener gives it).
// Never: lets skills grant tool rights or writes into the built-in folder.

import type { ToolContext, ToolDef } from '../types.ts';
import type { SkillInfo } from '../../../shared/model/knowledge.ts';
import { isCoreFolderName } from '../../agent-core/layout.ts';
import '../../contracts/agent-core.ts';
import { failure, json } from '../types.ts';
import { defineTool, internal } from './util.ts';
import { fallbackDescription } from '../../../shared/text/external.ts';
import { catalogChanged } from '../../knowledge/catalog.ts';
import type { LibraryItem } from '../../../shared/model/library.ts';
import { openEntry } from '../../library/hub.ts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A library skill's whole text – the subconscious's skill opener (subconscious/tools.ts). */
export function loadedSkillText(skill: { info: SkillInfo; body: string }): string {
  return `# Skill: ${skill.info.name}\n(folder: ${skill.info.path})\n\n${skill.body}`;
}

const saveSkill = defineTool<{ name: string; description?: string; body: string; modes?: string[]; main?: boolean; from?: string }>({
  name: 'skills.save',
  description: "Saves a way of working as my own skill, which my reports see too. The same name updates mine or makes my copy of a built-in or colleague's skill; the skill writing-skills shows what makes one steer well.",
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 64, description: 'lowercase-hyphen.' }, description: { type: 'string', maxLength: 1024, description: 'What it is for and when; written for me when left out.' },
      body: { type: 'string', minLength: 1, maxLength: 60_000, description: 'Markdown, in my own words.' },
      modes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 64 }, maxItems: 30, description: 'Modes that list it; [] = all; left out keeps them.' },
      main: { type: 'boolean', description: "true: a main skill in my folder's skills/, always listed in my prompt." },
      from: { type: 'string', minLength: 1, maxLength: 80, description: 'The id of a public library entry it builds on; its files come along and derived-from records it.' },
    },
    required: ['name', 'body'], additionalProperties: false,
  },
  category: 'write_local',
  describe: (args) => internal(`Save ${args.main ? 'main ' : ''}skill ${args.name}`, args.name),
  async run(args, ctx) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.name)) return failure('name must be lowercase words joined by hyphens.');
    const existing = ctx.services.skills.get(args.name, ctx.agent.id);
    if (args.modes) {
      const known = ctx.services.modes.list().map((mode) => mode.key);
      const unknown = args.modes.filter((key) => !known.includes(key));
      if (unknown.length) return failure(`Unknown mode${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}. Modes: ${known.join(', ')}.`);
    }
    const ownerAgentId = ctx.agent.id; // skills/service.ts saves in place when it is the agent's own or the shared one, else as an own copy
    const mainProblem = args.main ? mainSaveProblem(ctx, ownerAgentId, existing?.info) : undefined;
    if (mainProblem) return failure(mainProblem);
    let entry: LibraryItem | undefined;
    try { entry = args.from ? await openEntry(args.from.trim()) : undefined; } catch (error) { return failure(`from: ${(error as Error).message}`); }
    // B-078: no description given – the one written before stays; a stand-in from the old body gives way to the new body's.
    const kept = existing && existing.info.description !== fallbackDescription(existing.body) ? existing.info.description : '';
    const info = ctx.services.skills.save({
      name: args.name, description: args.description?.trim() || kept, body: args.body, ownerAgentId, modes: args.modes,
      ...(args.main ? { main: true } : {}), ...(entry ? { derivedFrom: [`library:${entry.id}@${entry.rev}`] } : {}),
    });
    const carried = entry ? carryFiles(entry.files, info.path) : [];
    catalogChanged(ctx.services);
    return json({
      ok: true, name: info.name, modes: info.modes, folder: info.path,
      ...(entry ? { derivedFrom: `library:${entry.id}@${entry.rev}`, carried, license: entry.license } : {}),
    });
  },
});

/**
 * An entry's files written beside SKILL.md (the server lets only plain relative paths through; checked again here): never
 * SKILL.md, a hidden or nested-skill path, or a file already there – what I adapted stays mine.
 */
export function carryFiles(files: Readonly<Record<string, string>>, dir: string): string[] {
  const written: string[] = [];
  for (const [file, content] of Object.entries(files)) {
    const target = path.resolve(dir, file);
    if (!target.startsWith(path.resolve(dir) + path.sep) || /(^|[\\/])(\.|skill\.md$)/i.test(file) || existsSync(target)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
    written.push(file);
  }
  return written;
}

/** Why skills.save cannot write a main skill (undefined = it can). */
function mainSaveProblem(ctx: ToolContext, ownerAgentId: string, existing: SkillInfo | undefined): string | undefined {
  if (!ctx.services.agentCore) return 'Agent folders are not available here, so main skills cannot be saved.';
  if (!isCoreFolderName(ownerAgentId)) return 'This agent has no agent folder, so it cannot have main skills.';
  if (ctx.services.org.get(ownerAgentId)?.archivedAt !== undefined) return 'This agent is archived.';
  if (existing && existing.source === 'agent' && existing.ownerAgentId === ownerAgentId && existing.main !== true) return `The name "${existing.name}" is taken by another skill of mine. Choose another name for the main skill.`;
  return undefined;
}

export const skillTools: ToolDef[] = [saveSkill];
