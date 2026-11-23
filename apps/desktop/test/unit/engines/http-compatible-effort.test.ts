// Owns: Compatible metadata -> catalog -> runtime clamp -> actual HTTP request regression.
// Never: calls an external provider or claims model acceptance from a fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Effort, ProviderId } from '../../../src/shared/model/providers.ts';
import { CompatibleEngine } from '../../../src/runtime/engines/http/compatible.ts';
import { compatibleEffort, compatibleReasoning } from '../../../src/runtime/engines/http/compatible-effort.ts';
import { buildModel } from '../../../src/runtime/models/catalog-merge.ts';
import { clampEffort } from '../../../src/runtime/models/efforts.ts';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { account, turnInput } from './fakes.ts';
import { sendJson, sendSse, serve } from './http-fixture.ts';

for (const provider of ['compatible', 'vllm', 'ollama', 'google', 'xai', 'lmstudio', 'llamacpp', 'groq'] as ProviderId[]) {
  test(`effort: unknown ${provider} does not invent support from foreign metadata`, () => {
    const profile = compatibleEffort(provider, { reasoning: { supported_efforts: null }, effort: { supported_levels: ['high'] } });
    assert.deepEqual(profile, { efforts: ['none'] });
    assert.deepEqual(compatibleReasoning(profile, 'high'), {});
  });
}

for (const reasoning of [undefined, {}, { supported_efforts: [] }, { supported_efforts: 'high' }, { supported_efforts: ['ultra', 'minimal', 'default', 7] }, { supported_efforts: ['none'], mandatory: true }]) {
  test(`effort: missing/malformed/unsupported router metadata ${JSON.stringify(reasoning)}`, () => {
    assert.deepEqual(compatibleEffort('openrouter', { reasoning }), { efforts: ['none'] });
  });
}

test('effort: OpenRouter null means all app levels; mandatory excludes none; defaults stay separate', () => {
  assert.deepEqual(compatibleEffort('openrouter', { reasoning: { supported_efforts: null, default_enabled: false, default_effort: 'high' } }), {
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'none', wire: 'openrouter',
  });
  const mandatory = compatibleEffort('openrouter', { reasoning: { supported_efforts: null, mandatory: true, default_effort: 'none' } });
  assert.deepEqual(mandatory.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(compatibleReasoning(mandatory, 'none'), { reasoning: { effort: 'low' } });
});

for (const [provider, metadata, wanted, expected, wire] of [
  ['openrouter', { reasoning: { supported_efforts: null, default_effort: 'high' } }, 'low', 'low', { reasoning: { effort: 'low' } }],
  ['openrouter', { reasoning: { supported_efforts: null } }, 'xhigh', 'xhigh', { reasoning: { effort: 'xhigh' } }],
  ['openrouter', { reasoning: { supported_efforts: null } }, 'max', 'max', { reasoning: { effort: 'max' } }],
  ['openrouter', { reasoning: { supported_efforts: ['none', 'high'] } }, 'none', 'none', { reasoning: { effort: 'none' } }],
  ['openrouter', { reasoning: { supported_efforts: ['low', 'high'], mandatory: true } }, 'none', 'low', { reasoning: { effort: 'low' } }],
  ['deepseek', { effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } }, 'max', 'max', { reasoning_effort: 'max' }],
  ['deepseek', { effort: { supported_levels: ['low', 'high', 'max'] } }, 'medium', 'high', { reasoning_effort: 'high' }],
  ['deepseek', { effort: { supported_levels: ['low', 'high', 'max'] } }, 'none', 'none', { thinking: { type: 'disabled' } }],
  ['vllm', {}, 'low', 'none', {}],
  ['openrouter', { supported_parameters: ['reasoning'] }, 'low', 'none', {}],
] as const) {
  test(`effort: ${provider} listing -> catalog -> clamp ${wanted}/${expected} -> HTTP wire`, async (t) => {
    const server = await serve((req, res) => {
      if (req.path.endsWith('/models')) sendJson(res, 200, { data: [{ id: provider === 'deepseek' ? 'deepseek-flash' : 'qa-model', ...metadata }] });
      else sendSse(res, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]']);
    });
    t.after(() => server.close());
    const acc = account({ provider, baseUrl: `${server.url}/v1` });
    const engine = new CompatibleEngine({ apiKey: async () => 'fixture-key' });
    const [listed] = await engine.listModels(acc);
    const model = buildModel({ provider, engine: 'compatible', listed, priors: Priors.empty() });
    const effort = clampEffort(wanted as Effort, model.efforts);
    assert.equal(effort, expected);
    const result = await engine.run(turnInput({ account: acc, model: model.model, effort }).input);
    assert.equal(result.stop, 'done', JSON.stringify(result.error));
    const body = server.hits('/v1/chat/completions')[0].body;
    assert.deepEqual(Object.fromEntries(['reasoning', 'reasoning_effort', 'thinking'].filter((key) => key in body).map((key) => [key, body[key]])), wire);
  });
}

test('effort: cache is account/endpoint specific and a new engine reacquires provider metadata', async (t) => {
  let enabled = true;
  const server = await serve((req, res) => {
    if (req.path.endsWith('/models')) sendJson(res, 200, { data: [{ id: 'same', ...(enabled ? { reasoning: { supported_efforts: ['low', 'high'] } } : {}) }] });
    else sendSse(res, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]']);
  });
  t.after(() => server.close());
  const acc = account({ provider: 'openrouter', baseUrl: `${server.url}/a` });
  const engine = new CompatibleEngine({ apiKey: async () => 'fixture-key' });
  assert.deepEqual((await engine.listModels(acc))[0].efforts, ['low', 'high']);
  enabled = false;
  assert.deepEqual((await engine.listModels({ ...acc, baseUrl: `${server.url}/b` }))[0].efforts, ['none']);
  assert.deepEqual((await engine.listModels({ ...acc, id: 'other' }))[0].efforts, ['none']);
  enabled = true;
  const restarted = new CompatibleEngine({ apiKey: async () => 'fixture-key' });
  await restarted.run(turnInput({ account: acc, model: 'same', effort: 'high' }).input);
  assert.deepEqual(server.hits('/a/chat/completions')[0].body.reasoning, { effort: 'high' });
  enabled = false;
  assert.deepEqual((await engine.listModels(acc))[0].efforts, ['none']);
  const stale = await engine.run(turnInput({ account: acc, model: 'same', effort: 'high' }).input);
  assert.equal(stale.stop, 'error');
  assert.match(stale.error?.message ?? '', /capabilities changed/);
  assert.equal(server.hits('/a/chat/completions').length, 1, 'stale catalog effort is not silently omitted');
});

test('effort: DeepSeek disable is limited to documented models, no aliases in capability lists', () => {
  const metadata = { effort: { supported_levels: ['low', 'high', 'max', 'off', 'default', 'minimal'], default_level: 'default' } };
  assert.deepEqual(compatibleEffort('deepseek', { id: 'old-or-unknown', ...metadata }), { efforts: ['low', 'high', 'max'], wire: 'deepseek' });
  assert.deepEqual(compatibleEffort('deepseek', { id: 'deepseek-v4-pro', ...metadata }), { efforts: ['none', 'low', 'high', 'max'], wire: 'deepseek' });
});
