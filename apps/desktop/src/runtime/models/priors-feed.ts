// The global model rating (14.11., Unterbewusstsein v1 point 4): once a day, with the catalog's daily price list
// (catalog.ts), one GET of https://openautark.com/model-priors.json – our judgement per model (tier, strengths, smarts,
// notes) with Artificial Analysis list prices, built by scripts/model-priors/generate.mts – read with the priors parser
// (Priors.parse) and kept in kv ('model-priors', 'feed') as the last good copy, raw, so a newer app parses it anew.
// A copy counts when it has a dated version (YYYY-MM-DD…) and at least one model. It replaces the priors in use in place
// (Priors.adopt) when its version is not older than theirs – the catalog, routing and turn pricing read it at once. The
// shipped resources/model-priors.json stays the fallback: without a copy, and when an app update ships newer priors than
// the stored copy, the shipped ones are in use. A failed or odd answer is logged and skipped; what is stored and in use stays.
// Owns: the fetch, the check, the stored copy and the version rule. Never: sends a key or anything about the person,
// polls on its own (the catalog's daily cycle asks), or takes a copy older than the priors in use.

import type { Db } from '../db/database.ts';
import type { Clock, Logger } from '../contracts.ts';
import { KvRepo } from '../store/kv.ts';
import { Priors } from './priors.ts';

export const PRIORS_FEED_URL = 'https://openautark.com/model-priors.json';
/** One fetch a day at most. */
export const PRIORS_FEED_MS = 24 * 60 * 60_000;
/** After a failure, the next try waits this long. */
const RETRY_MS = 6 * 60 * 60_000;
const TIMEOUT_MS = 20_000;
/** The generated file is ~20 kB; anything this large is not it. */
const MAX_CHARS = 2_000_000;
const KV = { ns: 'model-priors', key: 'feed' } as const;
const DATED = /^\d{4}-\d{2}-\d{2}/;

interface Stored { at: number; tried?: number; copy?: unknown }

/** The parsed copy when it counts (a dated version and at least one model), else undefined. */
export function feedCopy(json: unknown): Priors | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const priors = Priors.parse(json);
  return DATED.test(priors.data.version) && priors.data.models.length ? priors : undefined;
}

/** Takes the copy into the priors in use when it is not older than them (undated priors in use are older); true when they changed. */
export function adoptCopy(priors: Priors, copy: Priors | undefined): boolean {
  if (!copy) return false;
  if (DATED.test(priors.data.version) && copy.data.version < priors.data.version) return false;
  if (JSON.stringify(copy.data) === JSON.stringify(priors.data)) return false;
  priors.adopt(copy);
  return true;
}

function stored(db: Db): Stored | undefined {
  try {
    const value = new KvRepo(db).get<Stored>(KV.ns, KV.key);
    return value && typeof value.at === 'number' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** At start: the last good copy into the priors in use, when it is not older than them; true when it was taken. */
export function useStoredCopy(db: Db, priors: Priors): boolean {
  return adoptCopy(priors, feedCopy(stored(db)?.copy));
}

/** Is a fetch due now (the last good copy is older than a day and the last failure lies 6 h back)? */
export function priorsFeedDue(db: Db, now: number): boolean {
  const value = stored(db);
  if (!value) return true;
  return now - value.at >= PRIORS_FEED_MS && now - (value.tried ?? 0) >= RETRY_MS;
}

export interface PriorsFeedDeps {
  db: Db;
  clock: Pick<Clock, 'now'>;
  log: Pick<Logger, 'warn' | 'info'>;
  /** The priors in use (Priors.shipped), adopted into in place. */
  priors: Priors;
  /** The GET; tests pass their own. */
  fetch?: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

/** Fetches the copy when it is due, stores it when it counts and takes it when it is not older; true when the priors in use changed. Never throws. */
export async function refreshPriorsFeed(deps: PriorsFeedDeps): Promise<boolean> {
  const now = deps.clock.now();
  if (!priorsFeedDue(deps.db, now)) return false;
  const kv = new KvRepo(deps.db);
  const before = stored(deps.db);
  try {
    const get = deps.fetch ?? ((url, init) => fetch(url, init));
    const response = await get(PRIORS_FEED_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_CHARS) throw new Error('answer too large');
    const json: unknown = JSON.parse(text);
    const copy = feedCopy(json);
    if (!copy) throw new Error('no dated model priors in the answer');
    kv.set(KV.ns, KV.key, { at: now, copy: json } satisfies Stored, now);
    const changed = adoptCopy(deps.priors, copy);
    deps.log.info('model priors refreshed', { version: copy.data.version, models: copy.data.models.length, inUse: deps.priors.data.version });
    return changed;
  } catch (error) {
    deps.log.warn('model priors skipped', { error: error instanceof Error ? error.message : String(error) });
    try { kv.set(KV.ns, KV.key, { at: before?.at ?? 0, tried: now, ...(before?.copy !== undefined ? { copy: before.copy } : {}) } satisfies Stored, now); } catch { /* the next refresh tries again */ }
    return false;
  }
}
