// AF-023: the settings.json key routing.fallbacks – per use, what runs when its account is used up
// (shared/model/account-fallback.ts). settings/schema.ts lists it in the routing section.
// Owns: this key's definition. Never: reads settings or decides a fallback (routing/router.ts).

import { FALLBACK_USES, MAX_FALLBACK_STEPS } from '../../shared/model/account-fallback.ts';
import type { KeyDef } from './schema.ts';

const FALLBACK_STEP_SCHEMA = { type: 'object', properties: { account: { type: 'string', minLength: 1, maxLength: 200 }, model: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['account'], additionalProperties: false };

export const FALLBACKS_KEY: KeyDef = {
  key: 'fallbacks', type: 'object', default: {},
  about: 'If an account is used up, take … – per use (work, decision) an ordered list of an account and optionally a model; an empty list = automatic (the same model on the provider\'s next account, else the most similar model elsewhere)',
  allowed: `{ "work": [{ "account": "<account id>", "model": "<connection>:<model>" (optional: else the same or the nearest model) }], "decision": [ … ] }, up to ${MAX_FALLBACK_STEPS} steps each`,
  schema: { properties: Object.fromEntries(FALLBACK_USES.map((use) => [use, { type: 'array', maxItems: MAX_FALLBACK_STEPS, items: FALLBACK_STEP_SCHEMA }])), additionalProperties: false },
};
