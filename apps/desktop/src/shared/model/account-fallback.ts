// AF-023: what runs when an account is used up – the fallback order of a use and the words of a switch.
// settings.json routing.fallbacks holds, per use (Work, Decisions), an ordered list of steps "if the account is used up,
// take …": an account and, optionally, a model ("<connection>:<model>"; none = the same model, or the nearest one that
// account offers). An empty or missing list is "Automatic": the same provider's next account with the same model, else
// the most similar model elsewhere (runtime/routing/account-fallback.ts). The model menu's account choice (AF-021) uses
// the same order when the chosen account cannot run.
// A switch is never silent: the chat says "Switched to fritz2 – fritz1 is used up until 14:00."
// Providers stay open: a step names an account id, whatever its provider (Google Gemini follows in AF-024).
// Owns: the shape, its defensive reading, the check for settings.json and these texts.
// Never: reads accounts or settings itself, or decides a route.

import type { ModelUse } from './models-uses.ts';

/** The uses a fallback order exists for: the ones routed over accounts (agent turns and helper calls). */
export const FALLBACK_USES = ['work', 'decision'] as const satisfies readonly ModelUse[];
export type FallbackUse = (typeof FALLBACK_USES)[number];

/** One step: an account and, optionally, the model to run on it (none = the same or the nearest model). */
export interface FallbackStep {
  account: string;
  model?: string;
}

/** settings.json routing.fallbacks: the order per use; a missing or empty list = Automatic. */
export type FallbackOrders = Partial<Record<FallbackUse, FallbackStep[]>>;

/** Longest order per use (more steps help nobody: every account is tried once per failure chain). */
export const MAX_FALLBACK_STEPS = 12;
const ID = /^[^\s\u0000-\u001f]{1,200}$/;

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Why a value is no valid routing.fallbacks (path and expectation for settings.json's error), or undefined. */
export function fallbackProblem(value: unknown): { path: string; expected: string } | undefined {
  const expected = `{ "work": [{ "account": "<account id>", "model": "<connection>:<model>" (optional) }, …], "decision": […] } with up to ${MAX_FALLBACK_STEPS} steps each`;
  if (value === undefined) return undefined;
  if (!isPlain(value)) return { path: 'routing.fallbacks', expected };
  for (const [use, list] of Object.entries(value)) {
    const path = `routing.fallbacks.${use}`;
    if (!(FALLBACK_USES as readonly string[]).includes(use)) return { path, expected: `one of ${FALLBACK_USES.join(', ')}` };
    if (!Array.isArray(list) || list.length > MAX_FALLBACK_STEPS) return { path, expected: `a list of up to ${MAX_FALLBACK_STEPS} steps` };
    const seen = new Set<string>();
    for (const [index, step] of list.entries()) {
      const at = `${path}[${index}]`;
      if (!isPlain(step) || Object.keys(step).some((key) => key !== 'account' && key !== 'model')) return { path: at, expected: '{ "account": "<account id>", "model": "<connection>:<model>" (optional) }' };
      if (typeof step.account !== 'string' || !ID.test(step.account)) return { path: `${at}.account`, expected: 'an account id' };
      if (step.model !== undefined && (typeof step.model !== 'string' || !ID.test(step.model))) return { path: `${at}.model`, expected: 'a model "<connection>:<model>"' };
      const key = `${step.account}\u0000${step.model ?? ''}`;
      if (seen.has(key)) return { path: at, expected: 'a step that is not in the list yet' };
      seen.add(key);
    }
  }
  return undefined;
}

/** The order of `use`, read defensively (a bad step is dropped, never fatal); [] = Automatic. */
export function fallbackOrder(value: unknown, use: FallbackUse): FallbackStep[] {
  const list = isPlain(value) ? value[use] : undefined;
  if (!Array.isArray(list)) return [];
  const out: FallbackStep[] = [];
  for (const step of list.slice(0, MAX_FALLBACK_STEPS)) {
    if (!isPlain(step) || typeof step.account !== 'string' || !ID.test(step.account)) continue;
    const model = typeof step.model === 'string' && ID.test(step.model) ? step.model : undefined;
    if (out.some((entry) => entry.account === step.account && entry.model === model)) continue;
    out.push(model ? { account: step.account, model } : { account: step.account });
  }
  return out;
}

/** The use whose order a route follows: agent turns Work, the runtime's own helper calls Decisions. */
export function fallbackUseOf(runtime: boolean): FallbackUse {
  return runtime ? 'decision' : 'work';
}

// ------------------------------------------------------------------ words

/** Why an account cannot run (AccountSwitch['problem']). */
export type SwitchProblem = 'limit' | 'signed_out' | 'off' | 'model' | 'failed';

const DAY_MS = 86_400_000;

/** "14:00" today (in `timeZone`), else "Mon 14:00" within a week, else "21 Nov". Never throws on a bad zone. */
export function untilText(until: number, now: number, timeZone?: string): string {
  const zone = (() => { try { return timeZone ? new Intl.DateTimeFormat('en-GB', { timeZone }).resolvedOptions().timeZone : undefined; } catch { return undefined; } })();
  const day = (at: number) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(until));
  if (day(until) === day(now)) return time;
  if (until - now < 7 * DAY_MS) return `${new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short' }).format(new Date(until))} ${time}`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short' }).format(new Date(until));
}

/** "fritz1 is used up until 14:00", "fritz1 is signed out", "fritz1 just failed". */
export function troubleText(name: string, problem: SwitchProblem, until: number | undefined, now: number, timeZone?: string): string {
  switch (problem) {
    case 'limit': return until !== undefined && until > now ? `${name} is used up until ${untilText(until, now, timeZone)}` : `${name} is used up`;
    case 'signed_out': return `${name} is signed out`;
    case 'off': return `${name} is turned off`;
    case 'model': return `${name} cannot run this model`;
    case 'failed': return `${name} just failed`;
  }
}

/** The chat line of a switch: "Switched to fritz2 – fritz1 is used up until 14:00." (with the model when it changed). */
export function switchedText(input: { to: string; model?: string; from: string; problem: SwitchProblem; until?: number; now: number; timeZone?: string }): string {
  const target = input.model ? `${input.model} on ${input.to}` : input.to;
  return `Switched to ${target} – ${troubleText(input.from, input.problem, input.until, input.now, input.timeZone)}.`;
}
