// One find over the catalog (B-078 D12): by its words – the word index (words.ts) over every entry's title, description and
// text – and, where a person chose an embedding model, by meaning: the query embedded once and compared with the catalog's
// virtual entries with two hops (vectors/hops.ts: what lies close to a good hit is found too). Each hit comes back as its entry
// with origin and score; a skill only as the copy the viewer's route reaches.
// Owns: the searches, the mapping of hits to entries and the lines a find shows. Never: treats a found text as an instruction.

import type { RuntimeServices } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import { externalMarker, originLabel } from '../../shared/text/external.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import '../contracts/vectors.ts';
import { catalogEntries, entryText, kickCatalog, type CatalogEntry } from './catalog.ts';
import { WordIndex, type WordDoc } from './words.ts';

export const FIND_HOPS = 2;
const DESCRIPTION_CHARS = 240;

export interface CatalogHit {
  entry: CatalogEntry;
  score: number;
  /** The entry this one was reached through (multi-hop). */
  via?: string;
  /** How it was found. */
  by: 'meaning' | 'words';
}

/** The skills a viewer's route reaches, by name → folder (another copy of the name is not the viewer's). */
function visibleSkills(services: RuntimeServices, viewer: Agent | undefined): Map<string, string> {
  try { return new Map(services.skills.list(viewer?.id).map((info) => [info.name, info.path])); } catch { return new Map(); }
}

function reachable(entry: CatalogEntry, visible: ReadonlyMap<string, string>): boolean {
  return entry.kind !== 'skill' || !entry.skill || visible.get(entry.skill.name) === entry.skill.path;
}

/** The catalog's hits by meaning, best first; undefined when nothing can be searched by meaning (no embedder, nothing embedded yet). */
export async function searchCatalog(services: RuntimeServices, viewer: Agent | undefined, query: string, options: { limit?: number; hops?: number } = {}): Promise<CatalogHit[] | undefined> {
  const vectors = services.vectors;
  if (!vectors?.available() || !vectors.embedTexts) return undefined;
  void kickCatalog(services, viewer);
  const limit = Math.max(1, Math.min(options.limit ?? 8, 30));
  const result = await vectors.search({ query, in: ['catalog'], k: Math.min(limit * 2, 50), hops: options.hops ?? FIND_HOPS });
  if (!result.hits.length && result.searched.embeddedFiles === 0) return undefined;
  const entries = catalogEntries(services, viewer);
  const byKey = new Map(entries.map((entry) => [entry.key.toLowerCase(), entry]));
  const visible = visibleSkills(services, viewer);
  const hits: CatalogHit[] = [];
  for (const hit of result.hits) {
    const entry = byKey.get(hit.path.toLowerCase());
    if (!entry || !reachable(entry, visible) || hits.some((known) => known.entry.key === entry.key)) continue;
    const via = hit.via ? byKey.get(hit.via.toLowerCase())?.title : undefined;
    hits.push({ entry, score: hit.score, by: 'meaning', ...(via ? { via } : {}) });
    if (hits.length >= limit) break;
  }
  return hits;
}

const indexes = new WeakMap<object, WordIndex>();

/** An entry as a text of the word index: its name as words, its description, its text (read only when it changed). */
export function entryDoc(entry: CatalogEntry): WordDoc {
  return {
    id: entry.key, version: `${entry.sha ?? ''}|${entry.description}`,
    text: () => ({ title: entry.title.replace(/[-_/]/g, ' '), description: entry.description, body: entryText(entry) ?? '' }),
  };
}

/** The catalog's hits by words (the word index over every entry the viewer's catalog holds), best first. */
export function wordCatalog(services: RuntimeServices, viewer: Agent | undefined, query: string, limit = 8): CatalogHit[] {
  void kickCatalog(services, viewer); // generated descriptions (and, with an embedder, the vectors) follow the catalog
  const entries = catalogEntries(services, viewer);
  let index = indexes.get(services);
  if (!index) { index = new WordIndex(); indexes.set(services, index); }
  index.sync(entries.map(entryDoc));
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const visible = visibleSkills(services, viewer);
  return index.search(query, limit, (key) => reachable(byKey.get(key)!, visible)).map((hit) => ({ entry: byKey.get(hit.id)!, score: hit.score, by: 'words' as const }));
}

/** By meaning when a person chose an embedding model, else by words. */
export async function findInCatalog(services: RuntimeServices, viewer: Agent | undefined, query: string, limit = 8): Promise<CatalogHit[]> {
  let meaning: CatalogHit[] | undefined;
  try { meaning = await searchCatalog(services, viewer, query, { limit }); } catch { meaning = undefined; }
  return meaning ?? wordCatalog(services, viewer, query, limit);
}

/** How an entry is opened: knowledge.open for a skill, files.read for a project file. */
export function openHint(entry: CatalogEntry): string {
  if (entry.kind === 'skill') return `knowledge.open ${entry.title}`;
  return `files.read ${entry.path}`;
}

/** One hit as a find line: name, where it comes from, when it helps, how to open it. */
export function catalogLine(hit: CatalogHit): string {
  const where = hit.entry.kind === 'project' ? 'home project' : hit.entry.skill?.source === 'builtin' ? 'built in' : 'skill';
  const via = hit.via ? `, close to ${hit.via}` : '';
  return `- ${hit.entry.title} (${where}${via}) – ${excerpt(hit.entry.description, DESCRIPTION_CHARS)} · ${openHint(hit.entry)}`;
}

/** The markers the hits need, once each, above them (texts written outside this app). */
export function markerLines(hits: readonly CatalogHit[]): string[] {
  const lines: string[] = [];
  if (hits.some((hit) => hit.entry.kind === 'project')) lines.push(externalMarker({ kind: 'project', folder: 'my home project' }));
  return lines;
}
