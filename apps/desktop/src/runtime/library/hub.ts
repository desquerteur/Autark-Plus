// The public library over HTTPS (services/library): find by words, open, share, rate – no account. This installation
// is one random id (kv library/voter, made at the first share or rating): the server keeps only its hash, which owns what
// I shared and counts one rating per entry.
// Owns: the four calls, their timeout and the installation id. Never: sends anything but the entry, the id and a rating,
// or retries a share or a rating (they change the library).

import { randomBytes } from 'node:crypto';
import type { LibraryHit, LibraryItem, LibraryKind } from '../../shared/model/library.ts';
import { LIBRARY_URL } from '../../shared/model/library.ts';
import type { Db } from '../db/database.ts';
import { KvRepo } from '../store/kv.ts';

const CALL_MS = 20_000;

export const libraryUrl = (): string => (process.env.AUTARK_LIBRARY_URL?.trim() || LIBRARY_URL).replace(/\/+$/, '');

/** This installation's id for the library (made once). */
export function voterId(db: Db, now: number): string {
  const kv = new KvRepo(db);
  const known = kv.get<string>('library', 'voter');
  if (typeof known === 'string' && known.length >= 16) return known;
  const id = randomBytes(24).toString('hex');
  kv.set('library', 'voter', id, now);
  return id;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${libraryUrl()}${path}`, { ...init, signal: AbortSignal.timeout(CALL_MS), headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  } catch (error) {
    throw new Error(`The public library did not answer (${(error as Error).message}).`);
  }
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `The public library answered ${response.status}.`);
  return body;
}

export function findEntries(input: { words?: string; kind?: LibraryKind; limit?: number }): Promise<LibraryHit[]> {
  const query = new URLSearchParams({ q: input.words ?? '', ...(input.kind ? { kind: input.kind } : {}), limit: String(input.limit ?? 10) });
  return call<{ entries: LibraryHit[] }>(`/find?${query}`).then((answer) => answer.entries ?? []);
}

export const openEntry = (id: string): Promise<LibraryItem> => call<LibraryItem>(`/get/${encodeURIComponent(id)}`);

export function shareEntry(entry: { kind: LibraryKind; name: string; description: string; body: string; files?: Record<string, string>; voter: string }): Promise<{ id: string; rev: string }> {
  return call('/share', { method: 'POST', body: JSON.stringify(entry) });
}

export function rateEntry(input: { id: string; stars: number; note?: string; voter: string }): Promise<{ id: string; rating: number; votes: number }> {
  return call('/rate', { method: 'POST', body: JSON.stringify(input) });
}
