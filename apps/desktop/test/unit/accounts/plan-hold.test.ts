// B-080 (accounts/plan-hold.ts): what holds an account back, as a fact – "at its limit until …" for a used-up window,
// "cooling until …" for a short pause after a provider error; nothing for an account that runs now or is switched off.
// Since 09.11.2026 every signed-in plan takes turns, so each account names its own hold (candidates.test.ts has the order).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLabel, holdState } from '../../../src/runtime/accounts/plan-hold.ts';
import type { Account, LimitWindow } from '../../../src/shared/model/providers.ts';
import { account } from '../models/harness.ts';

const T0 = Date.UTC(2026, 10, 9, 12, 0);
const T = Date.UTC(2026, 10, 12, 7, 0); // 12 Nov 07:00 UTC
const weekly = (usedPercent: number, resetsAt: number, name = 'weekly'): LimitWindow => ({ name, windowMinutes: 10080, usedPercent, resetsAt });
const limits = (...windows: LimitWindow[]) => ({ windows, readAt: T0 });
const claude = (id: string, label: string, patch: Partial<Account> = {}) => account(id, 'claude', { label, ...patch });

test('a used-up week reads "at its limit until"; a short cooling "cooling until"; a free account nothing', () => {
  assert.equal(holdState(claude('acc_1', 'Claude Code', { limits: limits(weekly(100, T)) }), T0, 'UTC'), 'at its limit until 12 Nov 07:00');
  assert.equal(holdState(claude('acc_2', 'Claude Code 2', { state: 'cooling', coolingUntil: T0 + 5 * 60_000 }), T0, 'UTC'), 'cooling until 12:05');
  assert.equal(holdState(claude('acc_3', 'Claude Code 3', { limits: limits(weekly(79, T)) }), T0, 'UTC'), undefined);
  assert.equal(holdState(claude('acc_4', 'Claude Code 4', { enabled: false, limits: limits(weekly(100, T)) }), T0, 'UTC'), undefined, 'switched off');
  assert.equal(holdState(account('acc_k', 'openrouter', { state: 'cooling', coolingUntil: T0 + 60_000 }), T0, 'UTC'), 'cooling until 12:01', 'keys the same way');
});

test('a model window holds only that model; labels lose their e-mail', () => {
  const opus = claude('acc_1', 'Claude Code', { limits: limits(weekly(100, T, 'weekly-opus'), weekly(30, T)) });
  assert.equal(holdState(opus, T0, 'UTC', 'claude-opus-5-5'), 'at its limit until 12 Nov 07:00');
  assert.equal(holdState(opus, T0, 'UTC', 'claude-sonnet-5'), undefined);
  assert.equal(cleanLabel('Codex · alex@example.com'), 'Codex');
  assert.equal(cleanLabel('Claude Code · ann@example.com', 'ann@example.com'), 'Claude Code');
});
