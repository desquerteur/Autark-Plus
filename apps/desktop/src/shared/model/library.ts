// The public library's shapes (owner 14.11.2026: skills and notes anyone shares, found by their words, rated by those who
// used them, no sign-in): one server for every Autark, services/library (https://library.openautark.com).
// Owns: the shapes and the address. Never: logic (runtime/library/).

export type LibraryKind = 'skill' | 'note';

/** One entry as a find lists it. */
export interface LibraryHit {
  id: string;
  kind: LibraryKind;
  name: string;
  description: string;
  /** CC0-1.0 for what people share; a seeded entry keeps its own open license. */
  license: string;
  /** Where a seeded entry came from (its repository folder); '' for a shared one. */
  source: string;
  author: string;
  rev: string;
  /** The average of its ratings (null: none yet). */
  rating: number | null;
  votes: number;
  uses: number;
  /** YYYY-MM-DD. */
  updated: string;
}

/** One entry opened: its text, the files beside its SKILL.md and the newest notes of its ratings. */
export interface LibraryItem extends LibraryHit {
  body: string;
  files: Record<string, string>;
  notes: Array<{ stars: number; note: string; day: string }>;
}

export interface PublishInput {
  kind: LibraryKind;
  name: string;
  /** The whole Markdown text (front matter included for a skill). */
  text: string;
}

export type PublishResult =
  | { ok: true; id: string; rev: string; url: string }
  | { ok: false; reason: 'off' | 'secret' | 'internal' | 'no-check' | 'failed'; text: string };

/** The library server; AUTARK_LIBRARY_URL points a test or a local copy elsewhere. */
export const LIBRARY_URL = 'https://library.openautark.com';
