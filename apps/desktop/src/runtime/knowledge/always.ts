// One "always" rule (B-078 D12): what always stands in the main AI's prompt is one set – the skills marked
// `metadata.always: true` (skills/service.ts alwaysFor) and the memory files in a pinned/ folder (knowledge/service.ts
// pinned) – under one cap, ALWAYS_CHARS: a short text whole, a long one by its description with where to read it, and a
// line past the cap as its pointer – its name or title and where to read it (B-080, live 07.11.2026: the newest pinned
// note was missing from all five agents' prompts). So every pinned note and always-skill stands, whole or by its title.
// Order is fixed (skills alphabetical, then the notes oldest first), so the same set gives the same text. It is rendered in the
// volatile "pinned" section (context/prompt-volatile.ts): a pinned note belongs to a chat and carries the day it was saved,
// and a change to one renews no native session (the stable prefix stays as it is, B-059).
// Owns: the set, its cap and its lines. Never: anything else from memory, a body longer than its cap, or a member of the set left out.

import type { RuntimeServices } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { KnowledgeItem, ModeInfo, SkillInfo } from '../../shared/model/knowledge.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import { dayName } from '../context/time.ts';

/** The one cap of the whole and described lines that always stand in the prompt; past it each stands by its pointer. */
export const ALWAYS_CHARS = 3600;
/** A text up to this size stands whole; a longer one by its description. */
export const WHOLE_CHARS = 1200;
const DESCRIPTION_CHARS = 300;

export interface AlwaysSet { skills: SkillInfo[]; notes: KnowledgeItem[] }

/** A member's line as it fits, and its pointer line for when it does not. */
interface AlwaysLine { full: string; pointer: string }

/** The always-skills this agent's route reaches in this mode and the pinned notes of its places (and this chat). */
export function alwaysSet(services: RuntimeServices, agent: Agent, mode: ModeInfo | undefined, conversationId?: string): AlwaysSet {
  let skills: SkillInfo[] = [];
  try { skills = mode ? services.skills.alwaysFor?.(agent, mode) ?? [] : []; } catch { skills = []; }
  let notes: KnowledgeItem[] = [];
  try { notes = services.knowledge.pinned(agent.id, conversationId); } catch { notes = []; }
  return { skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)), notes };
}

function skillLine(services: RuntimeServices, agent: Agent, skill: SkillInfo): AlwaysLine {
  let body = '';
  try { body = services.skills.get(skill.name, agent.id)?.body.trim() ?? ''; } catch { body = ''; }
  const pointer = `- ${skill.name} (skill – knowledge.open ${skill.name})`;
  if (body && body.length <= WHOLE_CHARS) return { full: `- ${skill.name} (skill): ${body.replace(/\s*\n\s*/g, ' ')}`, pointer };
  return { full: `- ${skill.name} (skill) – ${excerpt(skill.description, DESCRIPTION_CHARS)} (knowledge.open ${skill.name} before that kind of work)`, pointer };
}

function noteLine(item: KnowledgeItem, now: number, zone: string | undefined): AlwaysLine {
  const saved = `saved ${dayName(item.recordedAt, zone, now)}`; // the day only: an age in days would change the live part daily
  const where = `memory.read ${item.id.replace(/:/g, '/')}`;
  const pointer = `- ${item.title} (${where}; ${saved})`;
  if (item.body.length <= WHOLE_CHARS) return { full: `- ${item.title}: ${item.body.replace(/\s*\n\s*/g, ' ')} (${saved})`, pointer };
  return { full: `- ${item.title} – ${excerpt(item.description || item.body, DESCRIPTION_CHARS)} (${where}; ${saved})`, pointer };
}

/** The set's lines: each whole or described while it fits ALWAYS_CHARS, else its pointer line – none is left out (B-080). */
export function alwaysLines(services: RuntimeServices, agent: Agent, set: AlwaysSet, zone: string | undefined): string[] {
  const now = services.clock.now();
  const lines: string[] = [];
  let used = 0;
  for (const { full, pointer } of [...set.skills.map((skill) => skillLine(services, agent, skill)), ...set.notes.map((item) => noteLine(item, now, zone))]) {
    const line = used + full.length + 1 <= ALWAYS_CHARS ? full : pointer;
    used += line.length + 1;
    lines.push(line);
  }
  return lines;
}
