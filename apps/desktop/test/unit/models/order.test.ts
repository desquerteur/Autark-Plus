// B-083 catalog order (models/order.ts): the newest version of each family on top, weaker current models among the
// current ones, older versions below with `newer`, specialists at the end; family/version parsed from the model id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogOrder, compareVersions, familyOf } from '../../../src/runtime/models/order.ts';
import { Catalog } from '../../../src/runtime/models/catalog.ts';
import type { EngineId, ModelInfo, ProviderId } from '../../../src/shared/model/providers.ts';
import { account, setup, TEST_PRIORS } from './harness.ts';

const ENGINE: Partial<Record<ProviderId, EngineId>> = { claude: 'claude', codex: 'codex', openai: 'openai' };

/** A catalog row as buildModel makes it: "<provider>:<model>", the gateway's "vercel-free:<vendor>/<model>" on 'compatible'. */
function row(id: string, patch: Partial<ModelInfo> = {}): ModelInfo {
  const at = id.indexOf(':');
  const owner = id.slice(0, at);
  const model = id.slice(at + 1);
  const provider = (owner === 'vercel-free' ? 'compatible' : owner) as ProviderId;
  return { id, provider, model, name: model, engine: ENGINE[provider] ?? 'compatible', efforts: [], caps: {}, tier: 'strong', strengths: {}, available: true, accounts: [], ...patch };
}

// What the live catalog holds (names, tiers and smarts as the shipped priors and SMALL_NAME give them).
const LIVE: ModelInfo[] = [
  row('claude:claude-fable-5', { name: 'Claude Fable 5' }),
  row('claude:claude-fable-5-1', { name: 'Claude Fable 5.1', tier: 'frontier', smarts: 92 }),
  row('claude:claude-fable-5-1-1m', { name: 'Claude Fable 5.1 (1M context)', tier: 'frontier', smarts: 92 }),
  row('claude:claude-opus-4-6', { name: 'Claude Opus 4.6' }),
  row('claude:claude-opus-4-7', { name: 'Claude Opus 4.7' }),
  row('claude:claude-opus-4-8', { name: 'Claude Opus 4.8' }),
  row('claude:claude-opus-5', { name: 'Claude Opus 5' }),
  row('claude:claude-opus-5-5', { name: 'Claude Opus 5.5', tier: 'frontier', smarts: 94 }),
  row('claude:claude-sonnet-4-6', { name: 'Claude Sonnet 4.6' }),
  row('claude:claude-sonnet-5', { name: 'Claude Sonnet 5' }),
  row('claude:claude-sonnet-5-5', { name: 'Claude Sonnet 5.5', smarts: 88 }),
  row('claude:claude-haiku-4-5-20251001', { name: 'Haiku 4.5', tier: 'small' }),
  row('claude:claude-haiku-5-5', { name: 'Claude Haiku 5.5', tier: 'small', smarts: 74 }),
  row('codex:gpt-5.6-luna', { name: 'GPT-5.6-Luna', tier: 'small' }),
  row('codex:gpt-5.6-sol', { name: 'GPT-5.6-Sol' }),
  row('codex:gpt-5.6-terra', { name: 'GPT-5.6-Terra' }),
  row('codex:gpt-6-astra', { name: 'GPT-6-Astra', tier: 'frontier', smarts: 92 }),
  row('codex:gpt-6-luna', { name: 'GPT-6-Luna', tier: 'small', smarts: 72 }),
  row('codex:gpt-6-sol', { name: 'GPT-6-Sol', smarts: 88 }),
  row('codex:gpt-6.1-sol', { name: 'GPT-6.1-Sol', tier: 'frontier', smarts: 93 }),
  row('codex:gpt-6.1-terra', { name: 'GPT-6.1 Terra', smarts: 86 }),
  row('vercel-free:anthropic/claude-opus-5.5'), // dotted gateway id: no prior, so no smarts and tier 'strong'
  row('vercel-free:alibaba/qwen3.7-max'),
  row('vercel-free:alibaba/qwen3.8-max'),
  row('vercel-free:alibaba/qwen3.8-max-0902'),
  row('vercel-free:google/gemini-2.5-flash-lite', { tier: 'small' }),
  row('vercel-free:google/gemini-3-flash'),
  row('openai:gpt-4o'),
  row('openai:o3-mini', { tier: 'small' }),
  row('openai:gpt-image-2', { functions: ['image'], strengths: { chat: -1, image: 0.8 } }),
  row('ollama:nimble:9b', { tier: 'local', strengths: { decision: 0.9, chat: -1 } }),
];

const ids = (list: readonly ModelInfo[]): string[] => list.map((model) => model.id);

test('family and version come from the model id: dates, vendor prefixes and size markers', () => {
  assert.deepEqual(familyOf('claude-opus-5-5'), { family: 'claude-opus', version: [5, 5] });
  assert.deepEqual(familyOf('anthropic/claude-opus-5.5'), { family: 'claude-opus', version: [5, 5] });
  assert.deepEqual(familyOf('claude-haiku-4-5-20251001'), { family: 'claude-haiku', version: [4, 5] });
  assert.deepEqual(familyOf('claude-fable-5-1-1m'), { family: 'claude-fable-1m', version: [5, 1] });
  assert.deepEqual(familyOf('claude-fable-5-1[1m]'), { family: 'claude-fable-1m', version: [5, 1] });
  assert.deepEqual(familyOf('gpt-6.1-sol'), { family: 'gpt-sol', version: [6, 1] });
  assert.deepEqual(familyOf('qwen3.8-max-0902'), { family: 'qwen-max', version: [3, 8] });
  assert.deepEqual(familyOf('library/qwen3.8:27b'), { family: 'qwen-27b', version: [3, 8] });
  assert.deepEqual(familyOf('gpt-4o-2024-08-06'), { family: 'gpt-o', version: [4] });
  assert.deepEqual(familyOf('o3-mini'), { family: 'o-mini', version: [3] });
  assert.deepEqual(familyOf('gemini-2.5-flash-lite'), { family: 'gemini-flash-lite', version: [2, 5] });
  assert.deepEqual(familyOf('qwen3.5-235b-a22b'), { family: 'qwen-235b-a22b', version: [3, 5] }, 'active-parameter markers are family words');
  assert.deepEqual(familyOf('gemma-4-26b-a4b-it'), { family: 'gemma-26b-a4b-it', version: [4] });
  assert.deepEqual(familyOf('gemma-3n-e4b-it').version, [3]);
  assert.ok(compareVersions([5, 1], [5]) > 0, '5.1 is newer than 5');
  assert.ok(compareVersions([5], [4, 8]) > 0);
  assert.ok(compareVersions([6], [6, 1]) < 0);
  assert.equal(compareVersions([3, 8], [3, 8]), 0);
});

test('the live list: newest of each family on top, current weaker models with them, older versions below with newer', () => {
  const list = catalogOrder(LIVE);
  assert.deepEqual(ids(list), [
    'claude:claude-opus-5-5', 'vercel-free:anthropic/claude-opus-5.5', 'codex:gpt-6.1-sol',
    'claude:claude-fable-5-1', 'claude:claude-fable-5-1-1m', 'codex:gpt-6-astra',
    'claude:claude-sonnet-5-5', 'codex:gpt-6.1-terra', 'claude:claude-haiku-5-5', 'codex:gpt-6-luna',
    'vercel-free:alibaba/qwen3.8-max', 'vercel-free:alibaba/qwen3.8-max-0902', 'vercel-free:google/gemini-3-flash', 'openai:gpt-4o',
    'vercel-free:google/gemini-2.5-flash-lite', 'openai:o3-mini',
    // older versions, under their family's place, newest first
    'claude:claude-opus-5', 'claude:claude-opus-4-8', 'claude:claude-opus-4-7', 'claude:claude-opus-4-6',
    'codex:gpt-6-sol', 'codex:gpt-5.6-sol',
    'claude:claude-fable-5',
    'claude:claude-sonnet-5', 'claude:claude-sonnet-4-6',
    'codex:gpt-5.6-terra',
    'claude:claude-haiku-4-5-20251001',
    'codex:gpt-5.6-luna',
    'vercel-free:alibaba/qwen3.7-max',
    // specialists, provider/name order
    'ollama:nimble:9b', 'openai:gpt-image-2',
  ]);
  const at = (id: string) => ids(list).indexOf(id);
  const by = (id: string) => list[at(id)];
  const firstOlder = list.findIndex((model) => model.newer);

  assert.ok(at('claude:claude-fable-5-1') < at('claude:claude-fable-5'), 'Fable 5.1 above Fable 5');
  for (const old of ['claude:claude-opus-4-6', 'claude:claude-opus-4-7', 'claude:claude-opus-4-8', 'claude:claude-opus-5']) {
    assert.ok(at('claude:claude-opus-5-5') < at(old), `Opus 5.5 above ${old}`);
    assert.equal(by(old).newer, 'claude:claude-opus-5-5');
  }
  assert.ok(at('codex:gpt-6.1-sol') <= 2, 'GPT-6.1 Sol among the first rows');
  assert.equal(at('vercel-free:anthropic/claude-opus-5.5'), at('claude:claude-opus-5-5') + 1, 'the gateway Opus 5.5 borrows its smarts and stands right after the plan one');
  for (const current of ['claude:claude-haiku-5-5', 'codex:gpt-6-luna', 'codex:gpt-6.1-terra', 'claude:claude-fable-5-1-1m']) {
    assert.ok(at(current) < firstOlder, `${current} is in the current block`);
    assert.equal(by(current).newer, undefined);
  }
  assert.ok(list.slice(firstOlder, -2).every((model) => model.newer), 'every row after the current block names its newer version');
  assert.ok(list.slice(0, firstOlder).every((model) => !model.newer));

  assert.equal(by('claude:claude-fable-5').newer, 'claude:claude-fable-5-1');
  assert.equal(by('codex:gpt-6-sol').newer, 'codex:gpt-6.1-sol');
  assert.equal(by('codex:gpt-5.6-luna').newer, 'codex:gpt-6-luna');
  assert.equal(by('claude:claude-haiku-4-5-20251001').newer, 'claude:claude-haiku-5-5');
  assert.equal(by('vercel-free:alibaba/qwen3.7-max').newer, 'vercel-free:alibaba/qwen3.8-max');
  assert.equal(by('vercel-free:alibaba/qwen3.8-max-0902').newer, undefined, 'a dated snapshot of the same version is current too');
  for (const own of ['vercel-free:google/gemini-2.5-flash-lite', 'vercel-free:google/gemini-3-flash', 'openai:gpt-4o', 'openai:o3-mini']) {
    assert.equal(by(own).newer, undefined, `${own} is its own family`);
  }
});

test('the order does not depend on the input order and leaves the input untouched', () => {
  const stale = LIVE.map((model) => (model.id === 'claude:claude-opus-5-5' ? { ...model, newer: 'gone' } : model));
  const before = JSON.stringify(stale);
  const forward = catalogOrder(stale);
  assert.deepEqual(catalogOrder([...stale].reverse()), forward);
  assert.equal(JSON.stringify(stale), before, 'no input object changed');
  assert.equal(forward[0].newer, undefined, 'a stale newer on a current model is dropped');
  assert.equal(catalogOrder(forward).map((model) => JSON.stringify(model)).join(), forward.map((model) => JSON.stringify(model)).join(), 'ordering an ordered list changes nothing');
});

test('a release the priors do not rate yet borrows its family\'s best smarts: on top, its predecessor older', () => {
  const list = catalogOrder([...LIVE, row('claude:claude-opus-6', { name: 'Claude Opus 6' }), row('codex:gpt-6.2-sol', { name: 'GPT-6.2-Sol' })]);
  const by = (id: string) => list.find((model) => model.id === id)!;
  assert.deepEqual(ids(list).slice(0, 2), ['claude:claude-opus-6', 'codex:gpt-6.2-sol']);
  assert.equal(by('claude:claude-opus-6').newer, undefined);
  assert.equal(by('claude:claude-opus-5-5').newer, 'claude:claude-opus-6');
  assert.equal(by('vercel-free:anthropic/claude-opus-5.5').newer, 'claude:claude-opus-6');
  assert.equal(by('codex:gpt-6.1-sol').newer, 'codex:gpt-6.2-sol');
  const firstOlder = list.findIndex((model) => model.newer);
  assert.deepEqual(ids(list).slice(firstOlder, firstOlder + 2), ['claude:claude-opus-5-5', 'vercel-free:anthropic/claude-opus-5.5'], 'the predecessor heads the older versions');
});

test('active-parameter sizes stay in the family name: Qwen 3.5 above Qwen 3', () => {
  const list = catalogOrder([row('vercel-free:alibaba/qwen3-235b-a22b'), row('vercel-free:alibaba/qwen3.5-235b-a22b')]);
  assert.deepEqual(ids(list), ['vercel-free:alibaba/qwen3.5-235b-a22b', 'vercel-free:alibaba/qwen3-235b-a22b']);
  assert.equal(list[1].newer, 'vercel-free:alibaba/qwen3.5-235b-a22b');
});

test('newer names an available newest version when the first one is unavailable', () => {
  const list = catalogOrder([
    row('claude:claude-opus-5-5', { tier: 'frontier', smarts: 94, available: false }),
    row('vercel-free:anthropic/claude-opus-5.5'),
    row('claude:claude-opus-4-8'),
  ]);
  assert.deepEqual(ids(list), ['claude:claude-opus-5-5', 'vercel-free:anthropic/claude-opus-5.5', 'claude:claude-opus-4-8']);
  assert.equal(list[2].newer, 'vercel-free:anthropic/claude-opus-5.5');
});

test('the catalog lists in this order, sets newer from rows too and a rebuild without changes writes nothing', async () => {
  const h = setup();
  h.accounts.upsert(account('acc_claude', 'claude'), false);
  h.engine('claude').lists.set('claude', [
    { model: 'claude-opus-4-6', name: 'Claude Opus 4.6', efforts: ['low', 'medium', 'high'] },
    { model: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', efforts: ['low', 'medium', 'high'] },
    { model: 'claude-opus-5-5', name: 'Claude Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  ]);
  await h.catalog.refresh({ force: true });
  assert.deepEqual(ids(h.catalog.list()), ['claude:claude-opus-5-5', 'claude:claude-haiku-5-5', 'claude:claude-opus-4-6']);
  assert.equal(h.catalog.get('claude:claude-opus-4-6')!.newer, 'claude:claude-opus-5-5');
  assert.equal(h.of('models.updated').length, 1);
  h.catalog.rebuild();
  assert.equal(h.of('models.updated').length, 1, 'same models → no write, no event');

  const fresh = new Catalog({ services: () => h.services, priors: TEST_PRIORS, priceFeed: false });
  assert.deepEqual(fresh.list(), h.catalog.list(), 'read from the table: same order, same newer');
  fresh.rebuild();
  assert.equal(h.of('models.updated').length, 1, 'a fresh catalog finds nothing to change either');
});
