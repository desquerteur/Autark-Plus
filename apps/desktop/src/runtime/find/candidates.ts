// Candidates of one find call (FIND, wave 3) from the stores that already exist – skills come with the catalog (catalog.ts):
//  * a skill is a main skill when it is the agent's own or its mode or profile names it, else a product skill;
//  * memory notes: the knowledge search (its own rules on who sees which note) – each with the day it was saved and its age;
//  * references: the person's references – knowledge rows of scope 'reference' (references/references.ts), opened as notes.
// The score is the search's own (the word index's bm25 relative to its best hit, knowledge/words.ts; a match by meaning at
// least SEMANTIC_FLOOR), plus an exact-ID bonus and one for a main skill; the `why` names how many of the query's salient
// words a candidate's text carries (subconscious/text.ts lexicalRelevance). Files are searched with files.search.
// Owns: the mapping, the score and its `why`. Never: copies text into the result beyond a short description, or embeds.

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { RuntimeServices } from '../contracts.ts';
import type { FindCandidate, FindKind } from '../../shared/model/find.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { KnowledgeItem, KnowledgeKind, ModeInfo, SkillInfo } from '../../shared/model/knowledge.ts';
import { exactId } from '../knowledge/query-rewrite.ts';
import { savedText } from '../knowledge/age.ts';
import { profileZone } from '../context/time.ts';
import { findReferences } from '../references/references.ts';
import { lexicalRelevance } from '../subconscious/text.ts';

/** Who asks: the agent (absent = the person on this PC), the turn's chat and thread, its mode. */
export interface FindCaller {
  agent?: Agent;
  conversationId?: string;
  thread?: string;
  mode?: string;
  /** Who asks – kept for wording and tests, never a right. */
  via: 'agent' | 'owner';
}

/** A candidate with what only the runtime needs (never shown): the file on disk. */
export interface Found extends FindCandidate {
  abs?: string;
}

export interface Gather {
  query: string;
  /** Salient words of the query (subconscious/text.ts queryTokens). */
  tokens: string[];
  /** Exact IDs in the query (query-rewrite.ts idTokens). */
  ids: string[];
  kinds: ReadonlySet<FindKind>;
  limit: number;
  signal?: AbortSignal;
  /** Memory folders the notes come from (default the whole tree). */
  folders?: string[];
  /** Whose references: 'human' (default) or a person per_…. */
  subject?: string;
}

export const MIN_SCORE = 0.25;
export const SEMANTIC_FLOOR = 0.6;
const EXACT_BONUS = 0.2;
const MAIN_BONUS = 0.05;
export const NOTE_KINDS: KnowledgeKind[] = ['fact', 'preference', 'experience', 'procedure', 'plan', 'note'];

export const shortHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

/** The score of a hit whose search scored it `base` (0..1), with its reason parts. */
export function scoreOf(g: Pick<Gather, 'tokens' | 'ids'>, text: string, base: number, options: { semantic?: boolean } = {}): { score: number; why: string[] } {
  const why: string[] = [];
  const share = lexicalRelevance(g.tokens, text);
  if (share > 0) why.push(`matches ${Math.round(share * Math.min(g.tokens.length, 4))} of ${Math.min(g.tokens.length, 4)} words`);
  let score = base;
  if (options.semantic) { score = Math.max(score, SEMANTIC_FLOOR); why.push('similar meaning'); }
  if (g.ids.length && exactId(g.ids, text)) { score += EXACT_BONUS; why.push('exact ID'); }
  return { score: Math.min(1, Number(score.toFixed(3))), why };
}

/** Is this skill one of the caller's main skills (its own, or named by its profile or mode)? */
function mainSkill(info: SkillInfo, caller: FindCaller, mode: ModeInfo | undefined): boolean {
  const agent = caller.agent;
  if (!agent) return false;
  return (info.source === 'agent' && info.ownerAgentId === agent.id) || agent.skills.includes(info.name) || Boolean(mode?.skills.includes(info.name));
}

const skillOrigin = (info: SkillInfo, main: boolean): string =>
  info.source === 'builtin' ? 'built-in' : info.source === 'agent' ? (main ? 'my own' : 'agent skill') : 'skill library';

/** The candidate of one skill (version: its text's hash); undefined when it cannot be read. */
export function skillFound(services: RuntimeServices, caller: FindCaller, info: SkillInfo, mode: ModeInfo | undefined, score: number, why: string[]): Found | undefined {
  const loaded = services.skills.get(info.name, caller.agent?.id);
  if (!loaded) return undefined;
  const main = mainSkill(info, caller, mode);
  return {
    id: `skill:${info.name}`, kind: main ? 'main-skill' : 'product-skill', authority: 'skill', title: info.name,
    route: `skills/${path.basename(info.path)}/SKILL.md`, abs: path.join(info.path, 'SKILL.md'), version: shortHash(loaded.body), score: Math.min(1, score + (main ? MAIN_BONUS : 0)),
    why: [...why, ...(main ? [info.source === 'agent' ? 'my own skill' : 'named for me'] : [])].join(' · ') || 'skill', origin: skillOrigin(info, main),
    ...(info.description ? { description: info.description } : {}),
  };
}

/** The candidate of one memory note: its place and the day it was saved (in `zone`, the person's) with its age. */
export function noteFound(item: KnowledgeItem, now: number, score: number, why: readonly string[], zone: string | undefined): Found {
  const place = `memory · ${item.scope}${item.pinned ? ' · pinned' : ''}`;
  return {
    id: `note:${item.id}`, kind: 'note', authority: 'hint', title: item.title, route: place,
    version: `r${item.recordedAt.toString(36)}`, score, why: [...why, savedText(item.recordedAt, now, zone)].join(' · '),
    origin: place, ...(item.description ? { description: item.description } : {}),
  };
}

export async function noteCandidates(services: RuntimeServices, caller: FindCaller, g: Gather): Promise<Found[]> {
  if (!g.kinds.has('note')) return [];
  // The whole tree unless the caller named folders: code names no part of memory for it (owner's rule (f)).
  const hits = await services.knowledge.search({ text: g.query, folders: g.folders?.length ? g.folders : [''], conversationId: caller.conversationId, kinds: NOTE_KINDS, limit: g.limit });
  const now = services.clock.now();
  const zone = profileZone(services);
  return hits.flatMap((hit) => {
    const { score, why } = scoreOf(g, `${hit.item.title} ${hit.item.description ?? ''} ${hit.item.body}`, hit.score, { semantic: hit.why.includes('similar meaning') });
    return score < MIN_SCORE ? [] : [noteFound(hit.item, now, score, why, zone)];
  });
}

export async function referenceCandidates(services: RuntimeServices, _caller: FindCaller, g: Gather): Promise<Found[]> {
  if (!g.kinds.has('reference')) return [];
  const hits = await findReferences(services.knowledge, { text: g.query, subject: g.subject, limit: Math.min(5, g.limit) });
  const now = services.clock.now();
  const zone = profileZone(services);
  return hits.flatMap((hit) => {
    const { score, why } = scoreOf(g, `${hit.item.title} ${hit.item.description ?? ''} ${hit.item.body}`, hit.score, { semantic: hit.why.includes('similar meaning') });
    if (score < MIN_SCORE) return [];
    return [{ ...noteFound(hit.item, now, score, why, zone), kind: 'reference' as const, route: 'references', origin: 'reference' }];
  });
}
