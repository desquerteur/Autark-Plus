// F28/F02 (16.11.2026, routing/unfit.ts accountsReason): when every fitting account is out, the turn's reason names the
// accounts – used up or paused until when (soonest first), signed out, failing or switched off – instead of "Every account
// that can run a suitable model is limited right now", which read as wrong while plans with quota left were switched off
// (live in the older company: Codex at 100 % of its week, all three Claude Code plans switched off).
// Owns: these assertions only. Never: real engines, accounts, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T0, account, agent, mode, standardSetup } from '../models/harness.ts';
import { LIMITED_MESSAGE, accountsReason } from '../../../src/runtime/routing/unfit.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import type { Account, ModelInfo } from '../../../src/shared/model/providers.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const week = (resetsAt: number) => ({ windows: [{ name: 'weekly', windowMinutes: 10080, usedPercent: 100, resetsAt }], readAt: T0 });
const services = (accounts: Account[]) => ({ accounts: { list: () => accounts }, settings: { get: () => ({ profile: { timezone: 'UTC' } }) } }) as never;
const model = (provider: Account['provider'], name: string, accounts: string[] = []) => ({ id: `${provider}:${name}`, provider, model: name, accounts }) as unknown as ModelInfo;

test('the live case: Codex at 100 % of its week, the three Claude Code plans switched off – named, with the time Codex is back', async () => {
  const h = await standardSetup();
  h.accounts.upsert(account('acc_codex', 'codex', { label: 'Codex', limits: week(T0 + DAY) }), false);
  h.accounts.upsert(account('acc_claude', 'claude', { label: 'Claude Code', enabled: false, state: 'disabled' }), false);
  h.accounts.upsert(account('acc_claude2', 'claude', { label: 'Claude Code 2', enabled: false, state: 'disabled' }), false);
  h.accounts.upsert(account('acc_claude3', 'claude', { label: 'Claude Code 3', enabled: false, state: 'disabled' }), false);
  await h.catalog.refresh({ force: true });
  await assert.rejects(h.router.route({ agent: agent('ag_konrad'), mode: mode('chat'), text: 'Ist es wirklich final?' }), (error: unknown) => {
    assert.ok(error instanceof WorkforceError && error.code === 'unavailable', String(error));
    assert.equal(error.message, 'Codex used up until 18 Oct 09:00 · Claude Code, Claude Code 2, Claude Code 3 switched off');
    assert.equal(error.retryAfterMs, DAY, 'the retry still waits for the account back first');
    return true;
  });
});

test('a short cooling after a provider error reads "paused until", a long one (402) and a used-up window "used up until" – soonest first', () => {
  const codex = account('acc_codex', 'codex', { label: 'Codex', state: 'cooling', coolingUntil: T0 + 5 * MINUTE });
  const claude = account('acc_claude', 'claude', { label: 'Claude Code', state: 'cooling', coolingUntil: T0 + 6 * HOUR });
  const models = [model('codex', 'gpt-6.1-sol'), model('claude', 'claude-opus-5-5')];
  assert.equal(accountsReason(services([claude, codex]), models, T0), 'Codex paused until 09:05 · Claude Code used up until 15:00');
  const both = [account('acc_c1', 'claude', { label: 'Claude Code', limits: week(T0 + DAY) }), account('acc_c2', 'claude', { label: 'Claude Code 2', limits: week(T0 + DAY) })];
  assert.equal(accountsReason(services(both), models, T0), 'Claude Code, Claude Code 2 used up until 18 Oct 09:00', 'one time, one group');
});

test('signed out, failing and switched off are named for every chat account; media-only accounts and free ones say nothing', () => {
  const accounts = [
    account('acc_codex', 'codex', { label: 'Codex' }), // free for the model: left out in this turn, not limited
    account('acc_claude', 'claude', { label: 'Claude Code', state: 'needs_login' }),
    account('acc_ollama', 'ollama', { label: 'Ollama', state: 'error' }),
    account('acc_key', 'openai', { label: 'OpenAI key', enabled: false, state: 'disabled' }),
    account('acc_voice', 'elevenlabs', { label: 'ElevenLabs', enabled: false, state: 'disabled' }),
  ];
  assert.equal(accountsReason(services(accounts), [model('codex', 'gpt-6.1-sol')], T0), 'Claude Code signed out · Ollama failing · OpenAI key switched off');
  assert.equal(accountsReason(services([accounts[0]!]), [model('codex', 'gpt-6.1-sol')], T0), undefined, 'nothing explains it: the caller keeps its fixed sentence');
});

test('an account free for another fitting model, or listed for none of them, explains nothing; a model window binds only its model', () => {
  const opusWeek = { windows: [{ name: 'weekly-opus', windowMinutes: 10080, usedPercent: 100, resetsAt: T0 + DAY }], readAt: T0 };
  const claude = account('acc_claude', 'claude', { label: 'Claude Code', limits: opusWeek });
  assert.equal(accountsReason(services([claude]), [model('claude', 'claude-opus-5-5')], T0), 'Claude Code used up until 18 Oct 09:00');
  assert.equal(accountsReason(services([claude]), [model('claude', 'claude-opus-5-5'), model('claude', 'claude-haiku-5-5')], T0), undefined, 'Haiku runs on it now');
  assert.equal(accountsReason(services([claude]), [model('claude', 'claude-opus-5-5', ['acc_other'])], T0), undefined, 'the model names other accounts');
});

test('at most three names per group plus "+N", at most four groups plus "+N more"; long labels are cut', () => {
  const off = (n: number) => account(`acc_k${n}`, 'openrouter', { label: `Key ${n}`, enabled: false, state: 'disabled' });
  assert.equal(accountsReason(services([1, 2, 3, 4, 5].map(off)), [], T0), 'Key 1, Key 2, Key 3 +2 switched off');
  const cooling = (n: number) => account(`acc_c${n}`, 'openrouter', { label: `Free ${n}`, state: 'cooling', coolingUntil: T0 + n * MINUTE });
  const many = [1, 2, 3, 4, 5].map(cooling);
  assert.equal(accountsReason(services([...many, off(9)]), [model('openrouter', 'some/model')], T0),
    'Free 1 paused until 09:01 · Free 2 paused until 09:02 · Free 3 paused until 09:03 · Free 4 paused until 09:04 · +2 more');
  const long = account('acc_long', 'codex', { label: 'Codex · the work plan of the whole marketing team', enabled: false, state: 'disabled' });
  assert.equal(accountsReason(services([long]), [], T0), 'Codex · the work plan of the wh… switched off', 'cut at 32 characters');
});

test('accounts that cannot be read: no names, the fixed sentence stays (the router keeps the time)', async () => {
  assert.equal(accountsReason({ accounts: { list: () => { throw new Error('db closed'); } }, settings: { get: () => ({}) } } as never, [], T0), undefined);
  const h = await standardSetup();
  await assert.rejects(h.router.route({ agent: agent('ag_1'), mode: mode('chat'), text: 'hi', exclude: ['acc_codex', 'acc_claude'] }), (error: unknown) => {
    assert.ok(error instanceof WorkforceError);
    assert.equal(error.message, LIMITED_MESSAGE, 'both just failed in this turn and are not limited: nothing to name');
    return true;
  });
});
