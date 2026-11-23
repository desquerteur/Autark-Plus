// The word search of memory, for when no embedder is chosen (never merged with vector hits): the word index (words.ts) over the
// tree's texts ranks, a file holding an exact ID the query names comes first. Also the short `why` of every hit – it ends with the
// day the note was saved and its age ("saved 2026-10-04, 3 weeks ago", age.ts; the day in the person's `zone`).
// Owns: the mapping of the index's hits to notes and the `why` text. Never: decides which files a turn reads (acl.ts) or calls a model.

import { createHash } from 'node:crypto';
import type { KnowledgeHit, KnowledgeItem, KnowledgeQuery } from '../../shared/model/knowledge.ts';
import { passes } from './acl.ts';
import { savedText } from './age.ts';
import type { MemoryVectors } from './memory-follow.ts';
import { MEMORY_ENTRY, isEntryName, itemOfEntry, type MemoryTree } from './memory-tree.ts';
import { foldText } from './normalize.ts';
import { exactId, expandQuery } from './query-rewrite.ts';
import type { WordDoc, WordIndex } from './words.ts';

/** A note as a text of the word index (its version: a hash of what is indexed). */
export function noteDoc(item: KnowledgeItem): WordDoc {
  const text = { title: item.title, description: item.description ?? '', body: item.body };
  return { id: item.id, version: createHash('sha1').update(`${text.title}\0${text.description}\0${text.body}`).digest('base64'), text: () => text };
}

/** The `items` of `corpus` that hold a word of `text`, best first; `corpus` is what the index holds (the tree's texts). */
export function wordHits(index: WordIndex, corpus: readonly KnowledgeItem[], items: readonly KnowledgeItem[], text: string, limit: number, now: number, zone: string | undefined): KnowledgeHit[] {
  index.sync(corpus.map(noteDoc));
  const byId = new Map(items.map((item) => [item.id, item]));
  const expanded = expandQuery(text);
  const exact = expanded.ids.length ? items.filter((item) => exactId(expanded.ids, `${item.title} ${item.body}`)) : [];
  const ranked = index.search(text, limit, (id) => byId.has(id)).map(({ id, score }) => ({ item: byId.get(id)!, score }));
  const first = new Set(exact.map((item) => item.id));
  return [...exact.map((item) => ({ item, score: 1 })), ...ranked.filter((hit) => !first.has(hit.item.id))].slice(0, limit)
    .map(({ item, score }) => ({ item, score, why: wordWhy(item, expanded.tokens, now, zone) }));
}

function wordWhy(item: KnowledgeItem, tokens: readonly string[], now: number, zone: string | undefined): string {
  const haystack = foldText(`${item.title} ${item.description ?? ''} ${item.body}`);
  const matched = tokens.filter((token) => haystack.includes(token)).slice(0, 4);
  return [...(matched.length ? [`matches '${matched.join(' ')}'`] : []), savedText(item.recordedAt, now, zone)].join(' · ');
}

/** The `why` of a vector hit. */
export function vectorWhy(item: KnowledgeItem, now: number, zone: string | undefined): string {
  return `similar meaning · ${savedText(item.recordedAt, now, zone)}`;
}

/**
 * With an embedding model a person chose: memory's hits by meaning over the query's folders, a file once (its best chunk first),
 * through its filters; undefined when the embedder found nothing with a note or has embedded nothing yet (then the words decide).
 */
export async function vectorHits(vectors: MemoryVectors, tree: MemoryTree, query: KnowledgeQuery, text: string, folders: readonly string[], limit: number, now: number, zone: string | undefined): Promise<KnowledgeHit[] | undefined> {
  const places = folders.filter((folder) => !folder || tree.exists(folder)).map((folder) => (folder ? `${MEMORY_ENTRY}/${folder}` : MEMORY_ENTRY));
  if (!places.length) return [];
  const found = await vectors.search({ query: text, in: places, k: Math.min(limit * 3, 100) });
  if (!found.hits.length && (found.note || found.searched.embeddedFiles === 0)) return undefined; // the embedder is in trouble or has not got there yet
  const hits = new Map<string, KnowledgeHit>();
  for (const hit of found.hits) {
    if (!isEntryName(hit.path)) continue; // a folder description embedded on purpose is no note
    const entry = tree.read(tree.fileRel(hit.path));
    const item = entry && itemOfEntry(entry);
    if (!item || hits.has(item.id) || !passes(item, query, now)) continue;
    hits.set(item.id, { item, score: Number(hit.score.toFixed(5)), why: vectorWhy(item, now, zone) });
  }
  return [...hits.values()].slice(0, limit);
}
