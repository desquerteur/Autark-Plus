// AF-024: when a used-up quota comes back, read from the provider's own limit text – Gemini's API answers 429
// RESOURCE_EXHAUSTED with a body naming the quota ("GenerateRequestsPerDayPerProjectPerModel-FreeTier") and a
// RetryInfo ("retryDelay": "39s"); Gemini CLI says "You have exhausted your daily quota on this model." or "Please
// retry in 1h2m3s". Google's daily quotas reset at midnight Pacific time (ai.google.dev/gemini-api/docs/rate-limits).
// The hint travels in the limit error (`retryAfterMs`, `details.quota`); accounts/failure.ts turns a daily one into a
// used-up "1d" window (model-scoped "1d-<model>" when the quota is the model's own), so Settings shows the reset and the
// router skips just that model or account until then.
// Owns: reading these texts and the Pacific midnight. Never: guesses a wait the text does not give (no hint: undefined –
// the caller's default cooldown applies).

import { ERR } from './shared.ts';
import type { WorkforceErrorData } from '../../shared/errors.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The longest wait a text may set (a week); anything above is not believed. */
const MAX_WAIT_MS = 7 * DAY_MS;

const DAILY = /per.?day|daily|\bRPD\b/i;
const PER_MODEL = /per.?model|(?:on|for) this model|model.?quota/i;
/** "retryDelay": "39s", "retryDelay":"1.5s" (Google RetryInfo). */
const RETRY_DELAY = /retry.?delay\W{0,4}(\d+(?:\.\d+)?)s\b/i;
/** "retry in 1h2m3s", "try again in 30 seconds", "resets after 2h 30m", "reset in 45m". */
const RETRY_IN = /(?:retry|try again|resets?)\s+(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:ms|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)(?![a-z])[\s,]*(?:and\s+)?)+)/i;
const PART = /(\d+(?:\.\d+)?)\s*(ms|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)(?![a-z])/gi;

export interface QuotaHint {
  /** How long until the quota is back (from the text, else the next Pacific midnight for a daily quota). */
  waitMs?: number;
  /** A daily quota (requests per day). */
  daily: boolean;
  /** The quota belongs to the model, not the whole account. */
  perModel: boolean;
}

/** The quota's own data in a limit error (`details.quota`). */
export interface QuotaDetails { daily: boolean; perModel: boolean; resetsAt?: number }

function duration(text: string): number | undefined {
  let total = 0;
  let found = false;
  for (const [, amount, unit] of text.matchAll(PART)) {
    const value = Number(amount);
    const u = unit.toLowerCase();
    total += u === 'ms' ? value : u.startsWith('h') ? value * 3_600_000 : u.startsWith('m') ? value * 60_000 : value * 1000;
    found = true;
  }
  return found ? Math.round(total) : undefined;
}

/** The next midnight in America/Los_Angeles after `now` (Google's daily quota reset); a day later when the clock cannot tell. */
export function nextPacificMidnight(now: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(now));
    const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
    const elapsed = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + (now % 1000);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < DAY_MS) return now - elapsed + DAY_MS;
  } catch { /* no time zone data */ }
  return now + DAY_MS;
}

/** What a provider's limit text says about its quota; `waitMs` undefined when it gives no time and is not daily. */
export function quotaHint(text: string, now: number): QuotaHint {
  const daily = DAILY.test(text);
  const perModel = PER_MODEL.test(text);
  const delay = RETRY_DELAY.exec(text);
  const said = delay ? Math.round(Number(delay[1]) * 1000) : (() => { const match = RETRY_IN.exec(text); return match ? duration(match[1]) : undefined; })();
  const known = said !== undefined && Number.isFinite(said) && said >= 0 && said <= MAX_WAIT_MS ? said : undefined;
  // Google's RetryInfo also says "retry in 40s" for a used-up daily quota: a daily one trusts only a wait of an hour or more
  const trusted = known !== undefined && (!daily || known >= HOUR_MS) ? known : undefined;
  return { waitMs: trusted ?? (daily ? nextPacificMidnight(now) - now : known), daily, perModel };
}

/** The limit error for a provider's limit text: its wait as retryAfterMs, a daily quota as `details.quota`. */
export function limitFromText(text: string, now = Date.now()): WorkforceErrorData {
  const hint = quotaHint(text, now);
  const details = hint.daily ? { quota: { daily: true, perModel: hint.perModel, ...(hint.waitMs !== undefined ? { resetsAt: now + hint.waitMs } : {}) } satisfies QuotaDetails } : undefined;
  return ERR.limit(hint.waitMs, details);
}

/** `details.quota` of a limit error, when it is well formed. */
export function quotaOf(details: Record<string, unknown> | undefined): QuotaDetails | undefined {
  const raw = details?.quota;
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.daily !== 'boolean' || typeof value.perModel !== 'boolean') return undefined;
  const resetsAt = typeof value.resetsAt === 'number' && Number.isFinite(value.resetsAt) && value.resetsAt > 0 ? value.resetsAt : undefined;
  return { daily: value.daily, perModel: value.perModel, ...(resetsAt !== undefined ? { resetsAt } : {}) };
}
