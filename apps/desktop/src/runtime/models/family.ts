// A model id's family and version ("anthropic/claude-opus-5.5" → claude-opus, [5, 5]), from the provider model id alone.
// The catalog order (order.ts) and the priors (priors.ts: a new version inherits its predecessor's entry) read it.
// Owns: the family/version parse and the version comparison. Never: I/O.

/** A model id's family key and version ("anthropic/claude-opus-5.5" → claude-opus, [5, 5]). */
export interface Family {
  family: string;
  version: number[];
}

/** Sizes, active parameters and context lengths (27b, a22b, e4b, 1m, 200k, 8x7b) name a family; they are no version. */
const SIZE = /^[a-z]?\d+(x\d+)?[bkmt]$/;

/**
 * Family and version of a provider model id (the bare part after the last '/', lower case): letter runs and size markers
 * are the family, digit runs of 1–3 digits the version, a run of 4+ digits a date (ignored, with the month and day runs
 * right after it: gpt-4o-2024-08-06 is gpt-4o).
 */
export function familyOf(model: string): Family {
  const words: string[] = [];
  const version: number[] = [];
  let date = false;
  for (const token of model.slice(model.lastIndexOf('/') + 1).toLowerCase().split(/[^a-z0-9]+/)) {
    for (const run of SIZE.test(token) ? [token] : token.match(/[a-z]+|\d+/g) ?? []) {
      if (!/^\d+$/.test(run)) { words.push(run); date = false; } else if (run.length >= 4) date = true; else if (!date) version.push(Number(run));
    }
  }
  return { family: words.join('-'), version };
}

/** Positive when version a is newer: numeric part by part; with an equal start the longer one is newer (5.1 > 5). */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
