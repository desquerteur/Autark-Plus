// B-083 D5 – one model lookup (routing/pins.ts modelMatches/resolvePin, agents/next-route.ts catalogModel and modelWord):
// "GPT-6 Luna", "GPT-6-Luna" and "gpt-6-luna" name the Codex plan's Luna, never a Vercel gateway entry of the same display
// name (live 09.11.: Nora's delegation landed there); a provider-qualified id stays on its provider; within a step the
// available model comes first; a split's part takes the same lookup (catalogModel); cheap / strong are needs.
// Owns: these assertions only. Never: engines, accounts or the router.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelMatches, resolvePin } from '../../../src/runtime/routing/pins.ts';
import { catalogModel, modelWord } from '../../../src/runtime/agents/next-route.ts';
import type { ModelInfo } from '../../../src/shared/model/providers.ts';

const LUNA = 'codex:gpt-6-luna';
const entry = (id: string, provider: string, model: string, name: string, efforts: string[], available = true) =>
  ({ id, provider, model, name, engine: provider === 'codex' ? 'codex' : 'compatible', efforts, available, accounts: available ? [provider] : [], tier: 'small' }) as unknown as ModelInfo;
const GATEWAY = ['vercel-free', 'vercel-gemini'].flatMap((connection) => ['', '-batch', '-decisions', '-fast']
  .map((suffix) => entry(`${connection}:openai/gpt-6-luna${suffix}`, 'compatible', `openai/gpt-6-luna${suffix}`, 'GPT-6 Luna', ['none'])));
/** The gateway entries are listed first, as in the live catalog where they matched the display name before the plan's Luna. */
const MODELS: ModelInfo[] = [...GATEWAY, entry(LUNA, 'codex', 'gpt-6-luna', 'GPT-6-Luna', ['low', 'medium', 'high', 'xhigh', 'max'])];
const CATALOG = { get: (id: string) => MODELS.find((model) => model.id === id), list: () => MODELS };

test('"GPT-6 Luna", "GPT-6-Luna", "gpt-6-luna" and "codex:gpt-6-luna" name the Codex plan\'s Luna', () => {
  for (const named of ['GPT-6 Luna', 'GPT-6-Luna', 'gpt-6-luna', 'codex:gpt-6-luna', 'gpt_6 luna']) assert.equal(resolvePin(MODELS, named)?.id, LUNA, named);
  const all = modelMatches(MODELS, 'GPT-6 Luna').map((model) => model.id);
  assert.equal(all[0], LUNA, 'the provider\'s model id before the display name');
  assert.equal(all.length, 9, 'the gateway entries follow by their name');
});

test('an exact id stays itself; a provider-qualified id never moves to another provider; unknown is undefined', () => {
  assert.equal(resolvePin(MODELS, 'vercel-free:openai/gpt-6-luna')?.id, 'vercel-free:openai/gpt-6-luna');
  assert.equal(resolvePin(MODELS, 'vercel-gemini:openai/gpt-6-luna-fast')?.id, 'vercel-gemini:openai/gpt-6-luna-fast');
  assert.equal(resolvePin(MODELS, 'codex:gpt-9'), undefined);
  assert.equal(resolvePin(MODELS, 'codex:GPT-6 Luna')?.id, LUNA, 'an id in plain form');
  assert.deepEqual(modelMatches(MODELS, 'claude:gpt-6-luna'), [], 'a "claude:" id never becomes a Codex or gateway model');
  assert.equal(resolvePin(MODELS, 'gpt-9'), undefined);
});

test('two that match in one step: the available one first, the catalog order breaks ties', () => {
  const models = [entry('codex:gpt-6-luna', 'codex', 'gpt-6-luna', 'GPT-6-Luna', ['low'], false), entry('openai:gpt-6-luna', 'openai', 'gpt-6-luna', 'GPT-6 Luna', ['low'])];
  assert.equal(resolvePin(models, 'gpt-6-luna')?.id, 'openai:gpt-6-luna', 'available first');
  assert.equal(resolvePin(models.map((model) => ({ ...model, available: true })), 'gpt-6-luna')?.id, 'codex:gpt-6-luna', 'then the catalog order');
  assert.equal(resolvePin(models, 'codex:gpt-6-luna')?.id, 'codex:gpt-6-luna', 'an exact id even when it cannot run');
});

test('catalogModel takes the one lookup (model.set, agents.delegate, a split\'s part, the subconscious\'s turn) and refuses no effort', () => {
  const found = catalogModel(CATALOG, 'GPT-6 Luna');
  assert.equal(typeof found === 'string' ? found : found.id, LUNA);
  assert.match(String(catalogModel(CATALOG, 'gpt-9')), /^Unknown model "gpt-9"\. Known: /);
  const off = { get: () => undefined, list: () => [entry(LUNA, 'codex', 'gpt-6-luna', 'GPT-6-Luna', ['low'], false)] };
  assert.equal(catalogModel(off, 'GPT-6 Luna'), 'GPT-6-Luna has no usable account right now.');
});

test('modelWord: cheap and strong in any case and spacing are the needs cheaper and stronger; anything else is a name', () => {
  assert.equal(modelWord('cheap'), 'cheaper');
  assert.equal(modelWord(' Strong '), 'stronger');
  assert.equal(modelWord('CHEAP'), 'cheaper');
  for (const named of ['same', 'cheaper', 'GPT-6 Luna', '']) assert.equal(modelWord(named), undefined, named);
});
