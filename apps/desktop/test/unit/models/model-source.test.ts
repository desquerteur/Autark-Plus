// F05 (12.11.2026): every catalog model says where it runs (ModelInfo.source, runtime/models/catalog-merge.ts
// sourceLabel) – a plan's or API's name for an account found or added by provider, a connection of settings.json by its
// known service's name, else by its own id – and buildModel and fromRow agree, so a rebuild still compares equal.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { buildModel, fromRow, sourceLabel, toRowParams, type ModelRow } from '../../../src/runtime/models/catalog-merge.ts';
import type { ModelInfo } from '../../../src/shared/model/providers.ts';

const priors = Priors.empty();

function roundTrip(info: ModelInfo): ModelInfo {
  const [id, provider, model, name, engine, efforts, default_effort, caps, scores, tier, strengths, accounts, available, updated_at] = toRowParams(info, 1);
  const row = { id, provider, model, name, engine, efforts, default_effort, caps, scores, tier, strengths, accounts, available, updated_at } as ModelRow;
  return fromRow(row, priors);
}

test('the source: a plan or API by its name, a named connection by its service or its id', () => {
  assert.equal(sourceLabel('codex', 'codex'), 'Codex');
  assert.equal(sourceLabel('claude', 'claude'), 'Claude Code');
  assert.equal(sourceLabel('openrouter', 'openrouter'), 'OpenRouter');
  assert.equal(sourceLabel('compatible', 'deepinfra'), 'DeepInfra', 'a known service named in settings.json');
  assert.equal(sourceLabel('compatible', 'vercel-free'), 'vercel-free', 'a connection of its own: its id');
  assert.equal(sourceLabel('compatible', 'compatible'), 'Custom server');
});

test('buildModel sets it from the id\'s owner, fromRow reads the same back (a rebuild stays equal)', () => {
  const codex = buildModel({ provider: 'codex', engine: 'codex', listed: { model: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', efforts: [] }, priors });
  assert.equal(codex.id, 'codex:gpt-6.1-terra');
  assert.equal(codex.source, 'Codex');
  const named = buildModel({ provider: 'compatible', engine: 'compatible', owner: 'commandcode', listed: { model: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', efforts: [] }, priors });
  assert.equal(named.id, 'commandcode:gpt-6.1-terra');
  assert.equal(named.source, 'commandcode', 'the same name from another source reads apart');
  const local = buildModel({ provider: 'ollama', engine: 'compatible', listed: { model: 'qwen3:8b', name: 'qwen3:8b', efforts: [] }, priors });
  for (const info of [codex, named, local]) {
    const back = roundTrip({ ...info, accounts: ['acc_1'], available: true });
    assert.equal(JSON.stringify(back), JSON.stringify({ ...info, accounts: ['acc_1'], available: true }), info.id);
  }
  assert.equal(roundTrip(local).source, 'Ollama', 'a model name with ":" keeps its owner');
});
