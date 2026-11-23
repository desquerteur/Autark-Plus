// Secrets as one more kind of the single find (F19, owner 15.11.2026: "die Secrets auch … wie als Memories, dass da auch
// Wortsuche gemacht wird … und das Bewusstsein sagt, das brauchen wir. Dann wird das der KI gleich gegeben"): the catalog's
// entries a find's text names – by id, or a word of their name, id or tags (secrets/metadata.ts secretFinds, by its word index,
// at most SECRET_FINDS, so the notes keep their room; a purpose alone is what secrets.list searches) – as 'secret' candidates
// with their handles, and opening one: its catalog line – the handle or each field's – and where a
// handle becomes its value. knowledge.find lists them with the others; the look before a turn (subconscious/look.ts) offers
// them like notes, and one it opens reaches the turn as the main AI's own knowledge.open. A mail turn runs no look.
// Owns: that mapping and that page. Never: decrypts, returns or logs a value, or counts a use (only a filled handle does).

import type { RuntimeServices } from '../contracts.ts';
import { catalogEntries, catalogLine, handleText, SECRET_WHERE, secretFinds, secretVersion, type CatalogEntry } from '../secrets/metadata.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { GONE, type OpenInput, type Opened } from './open.ts';
import { scoreOf, MIN_SCORE, type FindCaller, type Found, type Gather } from './candidates.ts';

const redact = (services: RuntimeServices, text: string): string => {
  try { return services.secrets.redact(text); } catch { return text; }
};

function secretFound(services: RuntimeServices, entry: CatalogEntry, score: number, why: string[]): Found {
  const description = entry.description ? redact(services, entry.description) : undefined;
  return {
    id: `secret:${entry.id}`, kind: 'secret', authority: 'document', title: redact(services, entry.label), route: `secrets/${entry.route}.md`,
    version: secretVersion(entry), score, why: [...why, entry.uses ? `used ${entry.uses} times` : ''].filter(Boolean).join(' · ') || 'secret',
    origin: 'secrets catalog', handles: handleText(entry), ...(description ? { description } : {}),
  };
}

export function secretCandidates(services: RuntimeServices, _caller: FindCaller, g: Gather): Found[] {
  if (!g.kinds.has('secret')) return [];
  return secretFinds(services, g.query).flatMap((hit) => {
    const text = `${hit.entry.label} ${hit.entry.description ?? ''} ${(hit.entry.tags ?? []).join(' ')}`;
    const { score, why } = scoreOf(g, text, hit.exact ? 1 : hit.score);
    if (score < MIN_SCORE) return [];
    return [secretFound(services, hit.entry, score, hit.exact ? [...why, 'its id'] : why)];
  });
}

/** knowledge.open secret:<id>: the entry's catalog line with its handles and where a handle becomes the value – never a value. */
export function openSecret(services: RuntimeServices, id: string, input: OpenInput): Opened {
  const entry = catalogEntries(services).find((item) => item.id === id);
  if (!entry) throw new WorkforceError('not_found', GONE);
  const candidate = secretFound(services, entry, 1, ['opened']);
  const changed = input.version && input.version !== candidate.version ? `changed since I found it (version ${input.version} → ${candidate.version})` : undefined;
  const text = `${redact(services, catalogLine(entry, entry.handles, 4000))}\n\n${SECRET_WHERE}`;
  return { candidate: { ...candidate, why: 'opened' }, text, page: 1, pages: 1, ...(changed ? { changed } : {}) };
}
