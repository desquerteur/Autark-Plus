// Use it or lose it inside one provider (accounts/candidates.ts, owner 09.11.2026): every signed-in plan takes turns, the
// plan whose current weekly reading resets first runs first – ahead of the order in Settings –, a 5h limit only pauses it
// and it is first again the moment the 5h window is free, a used-up week sends it behind until the monitor reads its new
// week. Keys, local runtimes and plans without a current reading rank behind, by priority; paying keys stay last.
// Owns: these assertions only. Never: real accounts or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidates, weeklyReset } from '../../../src/runtime/accounts/candidates.ts';
import type { Account, LimitWindow, ProviderId } from '../../../src/shared/model/providers.ts';

const T0 = Date.UTC(2026, 10, 9, 18, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function plan(id: string, provider: ProviderId, patch: Partial<Account> = {}): Account {
  return {
    id, provider, label: id, auth: provider === 'codex' || provider === 'claude' ? 'cli' : 'api_key', state: 'ok',
    priority: 0, enabled: true, detected: false, createdAt: T0, ...patch,
  };
}
const win = (name: string, usedPercent: number, resetsAt?: number): LimitWindow => ({ name, windowMinutes: name.startsWith('5h') ? 300 : 10080, usedPercent, resetsAt });
const limits = (...windows: LimitWindow[]) => ({ windows, readAt: T0 });
const ids = (accounts: Account[]) => accounts.map((account) => account.id);

test('weeklyReset: the reset of a plan\'s current weekly reading; Infinity for keys, API logins and plans without one', () => {
  const week = limits(win('5h', 10, T0 + HOUR), win('weekly', 40, T0 + 2 * DAY));
  assert.equal(weeklyReset(plan('acc_c', 'claude', { limits: week }), T0), T0 + 2 * DAY);
  assert.equal(weeklyReset(plan('acc_none', 'claude'), T0), Infinity, 'never read');
  assert.equal(weeklyReset(plan('acc_old', 'codex', { limits: limits(win('weekly', 10, T0 - 1)) }), T0), Infinity, 'the reading\'s reset has passed');
  assert.equal(weeklyReset(plan('acc_key', 'openai', { limits: week }), T0), Infinity, 'a key that pays per use');
  assert.equal(weeklyReset(plan('acc_api', 'codex', { plan: 'api', limits: week }), T0), Infinity, 'a CLI signed in with an API key pays per use');
});

test('the owner\'s case: the plan whose week resets first runs first, a 5h limit only pauses it', () => {
  // Claude Code is first in Settings with 80 % of its week left (reset in 5 days); Claude Code 2 has 30 % left, reset in 2 days.
  const first = plan('acc_1', 'claude', { label: 'Claude Code', priority: 0, limits: limits(win('5h', 0, T0 + 4 * HOUR), win('weekly', 20, T0 + 5 * DAY)) });
  const second = plan('acc_2', 'claude', { label: 'Claude Code 2', priority: 1, createdAt: T0 + 1, limits: limits(win('5h', 20, T0 + 3 * HOUR), win('weekly', 70, T0 + 2 * DAY)) });
  const third = plan('acc_3', 'claude', { label: 'Claude Code 3', priority: 2, createdAt: T0 + 2 }); // signed in, never read
  assert.deepEqual(ids(selectCandidates([first, second, third], 'claude', T0)), ['acc_2', 'acc_1', 'acc_3']);
  for (let i = 0; i < 3; i++) assert.deepEqual(ids(selectCandidates([third, first, second], 'claude', T0)), ['acc_2', 'acc_1', 'acc_3'], 'same input, same order');

  // Claude Code 2 reaches its 5h limit: Claude Code takes over …
  const paused = { ...second, limits: limits(win('5h', 100, T0 + 3 * HOUR), win('weekly', 85, T0 + 2 * DAY)) };
  assert.deepEqual(ids(selectCandidates([first, paused, third], 'claude', T0 + HOUR)), ['acc_1', 'acc_3']);
  // … and the moment its 5h window is free, Claude Code 2 runs first again.
  assert.deepEqual(ids(selectCandidates([first, paused, third], 'claude', T0 + 3 * HOUR)), ['acc_2', 'acc_1', 'acc_3']);

  // Its week used up: out until its weekly reset.
  const week = { ...second, limits: limits(win('5h', 40, T0 + 8 * HOUR), win('weekly', 100, T0 + 2 * DAY)) };
  assert.deepEqual(ids(selectCandidates([first, week, third], 'claude', T0 + 6 * HOUR)), ['acc_1', 'acc_3']);
  // After that reset its old reading says nothing (behind the plan with a known reset) until the monitor reads the new week,
  // which then resets after Claude Code's.
  assert.deepEqual(ids(selectCandidates([first, week, third], 'claude', T0 + 2 * DAY + 1)), ['acc_1', 'acc_2', 'acc_3']);
  const renewed = { ...second, limits: limits(win('5h', 0, T0 + 2 * DAY + 5 * HOUR), win('weekly', 0, T0 + 9 * DAY)) };
  assert.deepEqual(ids(selectCandidates([first, renewed, third], 'claude', T0 + 2 * DAY + HOUR)), ['acc_1', 'acc_2', 'acc_3']);
});

test('Codex plans the same way; a model window counts only for its model; paying accounts stay last', () => {
  const a = plan('acc_a', 'codex', { priority: 0, limits: limits(win('weekly', 10, T0 + 6 * DAY)) });
  const b = plan('acc_b', 'codex', { priority: 1, createdAt: T0 + 1, limits: limits(win('weekly', 90, T0 + DAY)) });
  assert.deepEqual(ids(selectCandidates([a, b], 'codex', T0)), ['acc_b', 'acc_a'], 'B\'s 10 % are lost in a day');
  const apiLogin = plan('acc_api', 'codex', { plan: 'api', priority: -1, limits: limits(win('weekly', 0, T0 + HOUR)) });
  assert.deepEqual(ids(selectCandidates([apiLogin, a, b], 'codex', T0)), ['acc_b', 'acc_a', 'acc_api'], 'an API login pays per use: behind every plan');

  // Claude Code 2's Opus week is used up: Opus turns go to Claude Code, Sonnet turns still prefer Claude Code 2.
  const c1 = plan('acc_1', 'claude', { limits: limits(win('weekly', 30, T0 + 4 * DAY)) });
  const c2 = plan('acc_2', 'claude', { priority: 1, limits: limits(win('weekly', 60, T0 + DAY), win('weekly-opus', 100, T0 + DAY)) });
  assert.deepEqual(ids(selectCandidates([c1, c2], 'claude', T0, 'claude-opus-5-5')), ['acc_1']);
  assert.deepEqual(ids(selectCandidates([c1, c2], 'claude', T0, 'claude-sonnet-5')), ['acc_2', 'acc_1']);
});
