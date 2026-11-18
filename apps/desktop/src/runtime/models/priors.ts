// Curated model priors (resources/model-priors.json): OUR judgement per model and task category – the one score source
// of routing. Optional curated list prices (`priceInputPerM`/`priceOutputPerM`, USD per 1M tokens; `priceCachedInputPerM` for
// cached input, `priceCacheWritePerM` for input written into the cache) price paid turns whose provider reported no cost (PR9, models/pricing.ts). B-078 (D16): `smarts` – how capable
// a model is overall, 0..100 (curated from public rankings), and relCost derived from both list prices when the entry sets
// none (relCostOfPrices), so price and relative cost never drift apart. An agent may refresh the file from public benchmarks.
// A model newer than every curated version of its family (claude-fable-5-3 while the file knows claude-fable-5-2) takes
// its newest predecessor's entry without its name and prices (forNewer): a provider's new release is scored, tiered and
// routed like the model it follows from the day it appears; the daily price list prices it.
// 14.11. (global model rating): Priors.shipped is the one priors object of the process – the catalog, routing and turn
// pricing hold it –, and a newer global copy from openautark.com (priors-feed.ts) replaces its entries in place (adopt).
// Owns: loading/validating the file, glob matching of model ids, the category list, the price and smarts
// fields, the predecessor lookup and the once-per-process priors object (Priors.shipped).
// Never: the shipped file carries third-party benchmark data (the global copy carries Artificial Analysis list prices,
// attributed, scripts/model-priors/generate.mts).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Effort, ModelCaps, ModelInfo } from '../../shared/model/providers.ts';
import { normalizeEffort, normalizeEfforts } from './efforts.ts';
import { compareVersions, familyOf } from './family.ts';

export interface PriorEntry {
  match: string;
  name?: string;
  tier?: ModelInfo['tier'];
  relCost?: number; // 0..1 relative marginal price
  caps?: ModelCaps;
  efforts?: Effort[];
  defaultEffort?: Effort;
  strengths: Record<string, number>;
  note?: string;
  /** Addition (PR9): curated list price in USD per 1M input/output tokens (only verified prices). */
  priceInputPerM?: number;
  priceOutputPerM?: number;
  /** The list price per 1M cached input tokens (cache reads), only verified ones: the cached part of an attempt's input counts at it (pricing.ts). */
  priceCachedInputPerM?: number;
  /** Package C (17.11.2026): the list price per 1M input tokens written into the cache (Claude: the 1-hour write), only verified ones (pricing.ts). */
  priceCacheWritePerM?: number;
  /** B-078: overall capability 0..100 (curated; a person's request weighs it against the price, routing/person-turn.ts). */
  smarts?: number;
}

/** relCost 1.0 = this blended list price per 1M tokens (Fable 5.1 and GPT-6 Astra). */
const FULL_PRICE_PER_M = 20;

/** Relative cost 0..1 from list prices: (3 × input + output) / 4 per 1M (a typical agent turn reads far more than it writes), $20 = 1. */
export function relCostOfPrices(inputPerM: number, outputPerM: number): number {
  const blended = (3 * inputPerM + outputPerM) / 4;
  return Math.round(Math.max(0, Math.min(1, blended / FULL_PRICE_PER_M)) * 1000) / 1000;
}

export interface PriorsData {
  version: string;
  categories: Record<string, string>;
  models: PriorEntry[];
}

/** Task categories the router knows (mode files use exactly these strings). */
export const CATEGORIES = [
  'chat', 'manager-planner', 'personal-assistant', 'video-animation', 'frontend-ui', 'computer-use', 'research', 'writing',
  'social-media', 'business-workflows', 'coding', 'cheap-chat', 'decision', 'embeddings',
] as const;

const TIERS: ReadonlySet<string> = new Set(['local', 'small', 'strong', 'frontier']);

/** A plausible list price per 1M tokens (0 = free), else undefined. */
function price(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : undefined;
}

/** Shipped priors per resources folder, read once (PR9: pricing reads them on every turn). */
const shipped = new Map<string, Priors>();

/** Family key without context-length words ("claude-fable-1m" → "claude-fable"): a 1M variant follows the same predecessor. */
function familyKey(model: string): { key: string; version: number[] } {
  const { family, version } = familyOf(model);
  return { key: family.split('-').filter((word) => !/^\d+[km]$/.test(word)).join('-'), version };
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.toLowerCase().split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

export class Priors {
  data: PriorsData;
  private compiled: Array<{ entry: PriorEntry; pattern: RegExp }>;
  /** Family key → the entry of its newest curated version (patterns "<model id>*" with a version only). */
  private newest: Map<string, { version: number[]; entry: PriorEntry }> | undefined;

  constructor(data: PriorsData) {
    this.data = data;
    this.compiled = data.models.map(entry => ({ entry, pattern: globToRegExp(entry.match) }));
  }

  /**
   * Takes another copy's entries in place, so everyone holding this object reads them from now on (priors-feed.ts). The
   * copy's models are the list; a field it does not carry for one of them stays as it is here (package C, 17.11.2026: the
   * cached-read and cache-write prices of the Claude models survive a copy built before the generator lists them).
   */
  adopt(next: Priors): void {
    const before = new Map(this.data.models.map((entry) => [entry.match, entry]));
    const models = next.data.models.map((entry) => {
      const old = before.get(entry.match);
      if (!old) return entry;
      const merged = { ...entry };
      for (const [field, value] of Object.entries(old)) {
        if (merged[field as keyof PriorEntry] === undefined) (merged as Record<string, unknown>)[field] = value;
      }
      return merged;
    });
    this.data = { ...next.data, models };
    this.compiled = models.map((entry) => ({ entry, pattern: globToRegExp(entry.match) }));
    this.newest = undefined;
  }

  /**
   * The entry of the newest curated version of the model's family when the model is newer than all of them, without the
   * predecessor's name and prices (and the relative cost derived from them); undefined otherwise.
   */
  forNewer(model: string): PriorEntry | undefined {
    if (!this.newest) {
      this.newest = new Map();
      for (const entry of this.data.models) {
        const stem = entry.match.replace(/\*$/, '');
        if (!stem || stem.includes('*') || stem.includes(':')) continue;
        const { key, version } = familyKey(stem);
        const known = this.newest.get(key);
        if (key && version.length && (!known || compareVersions(version, known.version) > 0)) this.newest.set(key, { version, entry });
      }
    }
    const { key, version } = familyKey(model);
    const before = this.newest.get(key);
    if (!before || !version.length || compareVersions(version, before.version) <= 0) return undefined;
    const priced = before.entry.priceInputPerM !== undefined || before.entry.priceOutputPerM !== undefined;
    const inherited: PriorEntry = { ...before.entry, strengths: { ...before.entry.strengths } };
    delete inherited.name;
    delete inherited.priceInputPerM;
    delete inherited.priceOutputPerM;
    delete inherited.priceCachedInputPerM;
    delete inherited.priceCacheWritePerM;
    if (priced) delete inherited.relCost;
    return inherited;
  }

  /** First entry whose pattern matches the provider model id (or `provider:model`). */
  forModel(model: string, id?: string): PriorEntry | undefined {
    const value = model.toLowerCase();
    const full = id?.toLowerCase();
    return this.compiled.find(({ pattern }) => pattern.test(value) || (full !== undefined && pattern.test(full)))?.entry;
  }

  static empty(): Priors {
    return new Priors({ version: 'none', categories: {}, models: [] });
  }

  static parse(json: unknown): Priors {
    const raw = (json ?? {}) as Partial<PriorsData> & { models?: unknown[] };
    const models: PriorEntry[] = [];
    for (const item of Array.isArray(raw.models) ? raw.models : []) {
      const value = item as unknown as Record<string, unknown>;
      if (typeof value.match !== 'string' || !value.match) continue;
      const strengths: Record<string, number> = {};
      for (const [category, strength] of Object.entries((value.strengths ?? {}) as Record<string, unknown>)) {
        if (typeof strength === 'number' && Number.isFinite(strength)) strengths[category] = Math.max(-1, Math.min(1, strength));
      }
      const prices = pricesOf(value);
      const derived = prices.priceInputPerM !== undefined && prices.priceOutputPerM !== undefined ? relCostOfPrices(prices.priceInputPerM, prices.priceOutputPerM) : undefined;
      const smarts = typeof value.smarts === 'number' && Number.isFinite(value.smarts) ? Math.round(Math.max(0, Math.min(100, value.smarts))) : undefined;
      models.push({
        match: value.match,
        name: typeof value.name === 'string' ? value.name : undefined,
        tier: typeof value.tier === 'string' && TIERS.has(value.tier) ? value.tier as ModelInfo['tier'] : undefined,
        relCost: typeof value.relCost === 'number' ? Math.max(0, Math.min(1, value.relCost)) : derived,
        caps: value.caps && typeof value.caps === 'object' ? value.caps as ModelCaps : undefined,
        efforts: Array.isArray(value.efforts) ? normalizeEfforts(value.efforts) : undefined,
        defaultEffort: normalizeEffort(value.defaultEffort),
        strengths,
        note: typeof value.note === 'string' ? value.note : undefined,
        ...prices,
        ...(smarts !== undefined ? { smarts } : {}),
      });
    }
    return new Priors({
      version: typeof raw.version === 'string' ? raw.version : 'unknown',
      categories: raw.categories && typeof raw.categories === 'object' ? raw.categories as Record<string, string> : {},
      models,
    });
  }

  /** `<resources>/model-priors.json`, loaded once per process – the one priors object, a newer global copy adopted into it; no folder (tests) → empty priors. */
  static shipped(resources: string | undefined, onError?: (error: unknown) => void): Priors {
    if (!resources) return Priors.empty();
    let priors = shipped.get(resources);
    if (!priors) shipped.set(resources, (priors = Priors.load(path.join(resources, 'model-priors.json'), onError)));
    return priors;
  }

  /** Loads the file; a missing/broken file yields empty priors (routing still works, without judgement). */
  static load(file: string, onError?: (error: unknown) => void): Priors {
    try {
      return Priors.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
      onError?.(error);
      return Priors.empty();
    }
  }
}

function pricesOf(value: Record<string, unknown>): Pick<PriorEntry, 'priceInputPerM' | 'priceOutputPerM' | 'priceCachedInputPerM' | 'priceCacheWritePerM'> {
  const input = price(value.priceInputPerM);
  const output = price(value.priceOutputPerM);
  const cached = price(value.priceCachedInputPerM);
  const write = price(value.priceCacheWritePerM);
  return {
    ...(input !== undefined ? { priceInputPerM: input } : {}), ...(output !== undefined ? { priceOutputPerM: output } : {}),
    ...(cached !== undefined ? { priceCachedInputPerM: cached } : {}), ...(write !== undefined ? { priceCacheWritePerM: write } : {}),
  };
}
