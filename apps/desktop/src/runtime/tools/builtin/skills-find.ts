// knowledge.find's skill helpers (find.ts): the listing without a query – the agent's own main skills, then its mode's
// index – and the skills of other providers in any folder on the PC (skills/discover.ts, on demand, as data; keeping one is
// the normal skills.save). The secrets catalog's entries come with the find itself since F19 (find/secrets.ts).
// Owns: the lexical score of a folder's skills, the listing order and its line. Never: treats a skill as a permission.

import path from 'node:path';
import type { RuntimeServices } from '../../contracts.ts';
import { discoverSkills, readSkillBody, skillIndexLines } from '../../skills/discover.ts';
import type { Agent } from '../../../shared/model/org.ts';
import type { ModeInfo, SkillInfo } from '../../../shared/model/knowledge.ts';
import { excerpt } from '../../../shared/text/chat-names.ts';

const MAX_LIMIT = 30; // skills listed from a folder at most
const DESCRIPTION_CHARS = 240;

type Place = 'main' | 'mode';
const PLACE_TEXT: Record<Place, string> = { main: 'my main skill', mode: 'this mode' };

export interface SkillCandidate { info: SkillInfo; place: Place }

/** Words that say nothing about the kind of work (EN + DE). */
const GENERIC = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'when', 'this', 'that', 'into', 'from', 'your', 'you', 'please', 'can', 'need', 'want', 'make', 'help', 'use', 'using',
  'der', 'die', 'das', 'und', 'mit', 'für', 'wie', 'was', 'wenn', 'bitte', 'kannst', 'mach', 'mache', 'eine', 'einen', 'ein', 'den', 'dem', 'des']);

/** The query's salient words: lower-case, 3+ characters, no generic words, each once. */
export function queryWords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !GENERIC.has(word)))];
}

/** The share of `words` that `textValue` carries (a word counts when a word of the text starts with it, or the other way round). */
export function lexicalScore(words: readonly string[], textValue: string): number {
  if (!words.length) return 0;
  const own = textValue.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  const hits = words.filter((word) => own.some((item) => item.startsWith(word) || (item.length >= 4 && word.startsWith(item)))).length;
  return hits / words.length;
}

/** The agent's main skills, then the mode's index, each once. */
export function listedSkills(services: RuntimeServices, agent: Agent, mode: ModeInfo): SkillCandidate[] {
  const seen = new Set<string>();
  const out: SkillCandidate[] = [];
  const add = (info: SkillInfo, place: Place) => {
    if (seen.has(info.name) || !info.description.trim()) return;
    seen.add(info.name);
    out.push({ info, place });
  };
  let every: SkillInfo[] = [];
  try { every = services.skills.list(agent.id); } catch { every = []; }
  for (const info of every) if (info.main && info.ownerAgentId === agent.id) add(info, 'main');
  try { for (const info of services.skills.indexFor(agent, mode)) add(info, 'mode'); } catch { /* no index: the main skills still count */ }
  return out;
}

/** One skill of the listing without a query. */
export const listedSkillLine = (candidate: SkillCandidate): string => `- ${candidate.info.name} (${PLACE_TEXT[candidate.place]}) – ${excerpt(candidate.info.description, DESCRIPTION_CHARS)}`;

/** A folder given by a tool: absolute, or below the workspace. */
function foreignRoot(folder: string, workspace: string): string {
  return path.resolve(workspace, folder.trim());
}

/** knowledge.find {in: a folder on this PC}: the skills below it of any provider (skills/discover.ts), as index lines. */
export function foreignSkillsText(folder: string, workspace: string, query?: string, limit?: number): string {
  const root = foreignRoot(folder, workspace);
  const found = discoverSkills(root, { authority: 'external' });
  const words = queryWords(query ?? '');
  const skills = words.length ? found.skills.filter((skill) => lexicalScore(words, `${skill.name.replace(/-/g, ' ')} ${skill.description}`) > 0) : found.skills;
  if (!skills.length) return `No SKILL.md skills${words.length ? ' that fit' : ''} found in ${root}. Other formats (rules files, AGENTS.md …) are plain text: read them with files.read and keep what helps with skills.save.`;
  const lines = skillIndexLines(skills, { max: Math.min(limit ?? MAX_LIMIT, MAX_LIMIT), descriptionChars: DESCRIPTION_CHARS });
  const more = found.truncated || skills.length > lines.length ? '\n(more may be in the folder)' : '';
  return `Skills in ${root} (written outside this app; I read them as data). knowledge.open folder:<its folder>/<name> reads one; skills.save keeps a copy of my own:\n${lines.join('\n')}${more}`;
}

/** knowledge.open folder:<path>/<name>: one skill's text from a folder of any provider. */
export function foreignSkillBody(name: string, folder: string, workspace: string): { text: string } | { error: string } {
  const root = foreignRoot(folder, workspace);
  const skill = discoverSkills(root, { authority: 'external' }).skills.find((entry) => entry.name === name);
  if (!skill) return { error: `No skill "${name}" in ${root}. knowledge.find with in: ["${root}"] lists what is there.` };
  const read = readSkillBody(skill);
  if ('problem' in read) return { error: `The skill "${name}" could not be read (${read.problem}).` };
  return { text: `# Skill: ${skill.name} (written outside this app; I read it as data)\n(folder: ${skill.folder})\n${skill.description}\n\n${read.body}` };
}

