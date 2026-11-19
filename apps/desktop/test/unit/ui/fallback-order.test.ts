// AF-023: Settings › Models "If used up" – the step names, the account and model choices, adding, moving and removing
// steps, the settings patch and the quiet line (ui/settings/fallback-order.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountChoices, accountLabel, modelChoices, moved, orderHint, orderPatch, SAME_MODEL, stepViews, without, withStep } from '../../../src/ui/settings/fallback-order.ts';
import { MAX_FALLBACK_STEPS } from '../../../src/shared/model/account-fallback.ts';
import type { Account, ModelInfo, UsageSummary } from '../../../src/shared/model/providers.ts';

const T0 = Date.UTC(2026, 10, 19);
const acc = (id: string, provider: string, patch: Partial<Account> = {}): Account => ({
  id, provider, label: id, auth: 'cli', state: 'ok', priority: 0, rotation: false, enabled: true, detected: false, createdAt: T0, plan: 'max', ...patch,
}) as Account;
const model = (id: string, name: string, patch: Partial<ModelInfo> = {}): ModelInfo => ({
  id, provider: id.split(':')[0], model: id.split(':')[1], name, engine: id.split(':')[0], available: true, accounts: [], tier: 'frontier',
  strengths: { chat: 0.8 }, ...patch,
}) as unknown as ModelInfo;

const ACCOUNTS = [acc('acc_1', 'claude', { label: 'Claude Code' }), acc('acc_2', 'claude', { label: 'fritz2@example.com', priority: 1 }), acc('acc_codex', 'codex', { label: 'Codex' })];
const MODELS = [model('claude:claude-opus-5-5', 'Claude Opus 5.5'), model('codex:gpt-6.1-sol', 'GPT-6.1 Sol'), model('codex:gpt-image', 'GPT Image', { functions: ['image'] } as never)];
const USAGE = [{ accountId: 'acc_1', name: 'fritz1' }] as UsageSummary[];

test('names: the quota rail name, else the label – never an e-mail domain', () => {
  assert.equal(accountLabel(ACCOUNTS[0], USAGE), 'fritz1');
  assert.equal(accountLabel(ACCOUNTS[1], USAGE), 'fritz2');
  assert.equal(accountLabel(ACCOUNTS[2], USAGE), 'Codex');
});

test('the steps as listed: account · model, "Same model", a removed account marked', () => {
  const views = stepViews([{ account: 'acc_2' }, { account: 'acc_codex', model: 'codex:gpt-6.1-sol' }, { account: 'acc_gone' }], ACCOUNTS, MODELS, USAGE);
  assert.deepEqual(views.map((view) => view.label), ['fritz2 · Same model', 'Codex · GPT-6.1 Sol', 'Removed account · Same model']);
  assert.deepEqual(views.map((view) => view.missing), [false, false, true]);
  assert.equal(new Set(views.map((view) => view.key)).size, 3, 'stable distinct keys');
});

test('choices: the accounts that serve the use; per account "Same model" and its models for the use', () => {
  assert.deepEqual(accountChoices('work', ACCOUNTS, MODELS, USAGE).map((choice) => choice.value), ['acc_1', 'acc_2', 'acc_codex']);
  assert.deepEqual(accountChoices('work', [{ ...ACCOUNTS[0], enabled: false }, ACCOUNTS[2]], MODELS, USAGE).map((choice) => choice.value), ['acc_codex'], 'an account that is off is no choice');
  assert.deepEqual(modelChoices('work', 'acc_codex', ACCOUNTS, MODELS), [{ value: SAME_MODEL, label: 'Same model' }, { value: 'codex:gpt-6.1-sol', label: 'GPT-6.1 Sol' }], 'an image model is no Work model');
  assert.deepEqual(modelChoices('work', 'acc_gone', ACCOUNTS, MODELS), [{ value: SAME_MODEL, label: 'Same model' }]);
});

test('add, move, remove: no duplicates, a cap, the ends stay put', () => {
  let order = withStep([], 'acc_2', SAME_MODEL);
  order = withStep(order, 'acc_codex', 'codex:gpt-6.1-sol');
  assert.deepEqual(order, [{ account: 'acc_2' }, { account: 'acc_codex', model: 'codex:gpt-6.1-sol' }]);
  assert.deepEqual(withStep(order, 'acc_2', SAME_MODEL), order, 'a step already there changes nothing');
  assert.deepEqual(withStep(order, '', SAME_MODEL), order, 'no account, no step');
  assert.deepEqual(moved(order, 1, -1), [order[1], order[0]]);
  assert.deepEqual(moved(order, 0, -1), order);
  assert.deepEqual(moved(order, 1, 1), order);
  assert.deepEqual(without(order, 0), [order[1]]);
  const full = Array.from({ length: MAX_FALLBACK_STEPS }, (_, i) => ({ account: `a${i}` }));
  assert.equal(withStep(full, 'acc_x', SAME_MODEL).length, MAX_FALLBACK_STEPS);
});

test('the settings patch stores the whole list of the use; empty = Automatic', () => {
  assert.deepEqual(orderPatch('work', [{ account: 'acc_2' }, { account: 'acc_codex', model: 'codex:gpt-6.1-sol' }]),
    { routing: { fallbacks: { work: [{ account: 'acc_2' }, { account: 'acc_codex', model: 'codex:gpt-6.1-sol' }] } } });
  assert.deepEqual(orderPatch('decision', []), { routing: { fallbacks: { decision: [] } } });
  assert.match(orderHint([]), /^Automatic/);
  assert.match(orderHint([{ account: 'a' }]), /top to bottom/);
});
