// AF-021: the account choice in the model menu – the provider's accounts with name, share left and reset or the
// reason they cannot run, what is selected (chat → agent default → Automatic), what a pick writes, and the chip's name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountOptions, accountsWith, chipAccount, optionMeta, selectedAccount } from '../../../src/ui/chat/composer/account-menu.ts';
import type { Account, UsageSummary } from '../../../src/shared/model/providers.ts';

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const H = 3_600_000;

function account(id: string, patch: Partial<Account> = {}): Account {
  return { id, provider: 'claude', label: id, auth: 'cli', state: 'ok', priority: 0, enabled: true, detected: true, createdAt: 0, ...patch };
}

const plans = [
  account('acc_b', { priority: 1, limits: { windows: [{ name: '5h', usedPercent: 38, windowMinutes: 300, resetsAt: NOW + 2 * H + 5 * 60_000 }, { name: 'weekly', usedPercent: 10, windowMinutes: 10080, resetsAt: NOW + 50 * H }] } as never }),
  account('acc_a', { limits: { windows: [{ name: '5h', usedPercent: 100, windowMinutes: 300, resetsAt: NOW + 3 * H }] } as never }),
  account('acc_off', { enabled: false }),
  account('acc_codex', { provider: 'codex' }),
  account('acc_c', { priority: 2, state: 'needs_login' }),
];
const usage = [
  { accountId: 'acc_a', provider: 'claude', label: 'acc_a', name: 'fritz1', active: true },
  { accountId: 'acc_b', provider: 'claude', label: 'acc_b', name: 'fritz2', active: false },
] as UsageSummary[];

test('the provider\'s enabled accounts by priority, with the rail\'s name, the tightest window and the trouble', () => {
  const options = accountOptions(plans, usage, 'claude', NOW);
  assert.deepEqual(options.map((option) => option.name), ['fritz1', 'fritz2', 'acc_c']);
  assert.deepEqual(options[0], { id: 'acc_a', provider: 'claude', name: 'fritz1', left: 0, resetsAt: NOW + 3 * H, trouble: 'limit' });
  assert.equal(options[1].left, 62);
  assert.equal(options[1].resetsAt, NOW + 2 * H + 5 * 60_000);
  assert.equal(options[2].trouble, 'signed_out');
  assert.deepEqual(accountOptions(plans, usage, undefined, NOW), []);
});

test('the second line says the share left and when it resets, or why not', () => {
  const [a, b, c] = accountOptions(plans, usage, 'claude', NOW);
  assert.equal(optionMeta(b, NOW), '62% left · resets 2h 5m');
  assert.equal(optionMeta(a, NOW), 'Used up · resets 3h');
  assert.equal(optionMeta(c, NOW), 'Signed out');
  assert.equal(optionMeta({ id: 'x', provider: 'claude', name: 'x' }, NOW), 'Limit unknown');
  const cooling = accountOptions([account('acc_cool', { state: 'cooling', coolingUntil: NOW + 30 * 60_000 })], [], 'claude', NOW)[0];
  assert.equal(cooling.trouble, 'limit');
  assert.equal(optionMeta(cooling, NOW), 'Used up · resets 30m');
});

test('selected: the chat choice, else the agent default, else Automatic – and the chat\'s Automatic beats the default', () => {
  assert.deepEqual(selectedAccount({ ag: 'acc_b' }, 'acc_a', 'ag'), { value: 'acc_b', source: 'chat' });
  assert.deepEqual(selectedAccount({}, 'acc_a', 'ag'), { value: 'acc_a', source: 'agent' });
  assert.deepEqual(selectedAccount({ ag: 'auto' }, 'acc_a', 'ag'), { value: 'auto', source: 'auto' });
  assert.deepEqual(selectedAccount(undefined, undefined, 'ag'), { value: 'auto', source: 'auto' });
});

test('a pick writes the chat\'s map: an account, or Automatic as "auto" only where an agent default would win otherwise', () => {
  assert.deepEqual(accountsWith({ other: 'acc_a' }, 'ag', 'acc_b', undefined), { other: 'acc_a', ag: 'acc_b' });
  assert.deepEqual(accountsWith({ ag: 'acc_b' }, 'ag', 'auto', undefined), {});
  assert.deepEqual(accountsWith({ ag: 'acc_b' }, 'ag', 'auto', 'acc_a'), { ag: 'auto' });
});

test('the chip names the chosen account, else the routed one – only where there is a choice', () => {
  const options = accountOptions(plans, usage, 'claude', NOW);
  assert.equal(chipAccount(options, 'acc_b', 'acc_a')?.name, 'fritz2');
  assert.equal(chipAccount(options, 'auto', 'acc_a')?.name, 'fritz1');
  assert.equal(chipAccount(options, 'auto', undefined), undefined);
  assert.equal(chipAccount(options.slice(0, 1), 'acc_a', 'acc_a'), undefined, 'one account needs no name');
});
