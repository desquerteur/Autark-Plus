// AF-023: two Claude plans, the first used up, the second half full – the work goes on on the second one with the same
// model (the bug: a plan outside rotation never stood in, so "every account is limited"), and the chat is told.
// Real router, real account selection, fake catalog/engines (models/harness.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, agent, mode, standardSetup, T0 } from '../models/harness.ts';
import { switchLine } from '../../../src/runtime/routing/account-choice.ts';
import type { Account } from '../../../src/shared/model/providers.ts';
import { fallbackOrder, fallbackProblem, switchedText, untilText } from '../../../src/shared/model/account-fallback.ts';
import { migrateFallback, migrateModelSettings } from '../../../src/runtime/routing/uses-settings.ts';
import { defaultSettings } from '../../../src/runtime/settings/defaults.ts';
import { settingsFrom } from '../../../src/runtime/settings/read.ts';
import { validateSettings } from '../../../src/runtime/settings/validate.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';

const TOM = 'ag_tom00000001';
const OPUS = 'claude:claude-opus-5-5';
const HOUR = 3_600_000;

const usedUp = (resetsAt: number) => ({ windows: [{ name: '5h', usedPercent: 100, windowMinutes: 300, resetsAt }], readAt: T0 }) as Account['limits'];
const halfFull = { windows: [{ name: 'weekly', usedPercent: 52, windowMinutes: 10080, resetsAt: T0 + 50 * HOUR }], readAt: T0 } as Account['limits'];

/** The person's setup: "Claude Code" (primary, rotation off) and "Claude Code 2" (rotation off, as every plan since B-072). */
async function userSetup(options: { codex?: boolean; chat?: Record<string, unknown> } = {}) {
  const h = await standardSetup();
  h.accounts.upsert(account('acc_claude', 'claude', { label: 'fritz1' }), false);
  h.accounts.upsert(account('acc_fritz2', 'claude', { label: 'fritz2', priority: 1, createdAt: T0 + 1, limits: halfFull }), false);
  if (options.codex === false) h.accounts.upsert({ ...h.accounts.get('acc_codex')!, enabled: false }, false);
  await h.catalog.refresh({ force: true });
  h.agents.set(TOM, agent(TOM, { modelPolicy: { pin: OPUS } })); // the start model: a chat's model chip never routes (upstream 0.3.12)
  h.addChat('ch_main', [TOM], { ...(options.chat ?? {}) });
  const route = (exclude?: string[]) => h.router.route({ agent: h.agents.get(TOM)!, conversationId: 'ch_main', mode: mode('chat'), text: 'hello', ...(exclude ? { exclude } : {}) });
  return { h, route };
}

test('bug: the first plan used up, the second half full – the same model runs on the second plan', async () => {
  const { h, route } = await userSetup({ codex: false });
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, limits: usedUp(T0 + 2 * HOUR) }, false);
  const decision = await route();
  assert.equal(decision.modelId, OPUS, 'the same model');
  assert.equal(decision.accountId, 'acc_fritz2', 'on the plan that still has quota');
});

test('bug: the same holds with another provider connected – the pinned model stays and moves account', async () => {
  const { h, route } = await userSetup();
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, state: 'cooling', coolingUntil: T0 + HOUR }, false);
  const decision = await route();
  assert.equal(decision.modelId, OPUS);
  assert.equal(decision.accountId, 'acc_fritz2');
});

test('a failed attempt on the first plan moves on to the second (failover with the first excluded)', async () => {
  const { route } = await userSetup({ codex: false });
  const decision = await route(['acc_claude']);
  assert.equal(decision.accountId, 'acc_fritz2');
  assert.equal(decision.modelId, OPUS);
});

// Upstream 0.3.12 (accounts/candidates.ts): every signed-in plan takes turns, the one whose week resets first goes first –
// no primary that holds the others back. fritz2 has a weekly reading (resets in 50 h), fritz1 none, so fritz2 leads.
test('the plan whose week resets first runs: no switch while it can run', async () => {
  const { route } = await userSetup();
  const decision = await route();
  assert.equal(decision.accountId, 'acc_fritz2');
  assert.equal(decision.accountSwitch, undefined);
});

test('the switch is marked, so the chat says which plan is used up and until when', async () => {
  const { h, route } = await userSetup({ codex: false });
  const reset = T0 + 5 * HOUR;
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, limits: usedUp(reset) }, false);
  const decision = await route();
  assert.deepEqual(decision.accountSwitch, { from: 'acc_claude', problem: 'limit', source: 'auto', until: reset });
  assert.equal(switchLine(h.accounts.list(), decision, 'UTC', T0), 'Switched to fritz2 – fritz1 is used up until 14:00.');
});

// ------------------------------------------------------------------ the fallback order (Settings › Models)

test('the Work order: "if the account is used up, take Codex GPT-6.1 Sol" beats the automatic second plan', async () => {
  const { h, route } = await userSetup();
  h.settings.update({ routing: { fallbacks: { work: [{ account: 'acc_codex', model: 'codex:gpt-6.1-sol' }] } } } as never);
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, limits: usedUp(T0 + HOUR) }, false);
  const decision = await route();
  assert.equal(decision.accountId, 'acc_codex');
  assert.equal(decision.modelId, 'codex:gpt-6.1-sol');
  assert.equal(decision.engine, 'codex');
  assert.equal(decision.accountSwitch?.byOrder, true);
  assert.match(decision.reason, /fallback order in Settings/);
  // While the plans can run, the order changes nothing: the plan whose week resets first runs, unmarked.
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, limits: undefined }, false);
  const free = await route();
  assert.equal(free.accountId, 'acc_fritz2');
  assert.equal(free.accountSwitch, undefined);
});

test('order steps that cannot run are skipped; a step without a model takes the same model on its account', async () => {
  const { h, route } = await userSetup();
  h.settings.update({ routing: { fallbacks: { work: [
    { account: 'acc_codex', model: 'codex:gpt-6.1-sol' }, // used up as well
    { account: 'acc_gone' }, // a removed account
    { account: 'acc_fritz2' }, // the same model on the second plan
  ] } } } as never);
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, limits: usedUp(T0 + HOUR) }, false);
  h.accounts.upsert({ ...h.accounts.get('acc_codex')!, state: 'cooling', coolingUntil: T0 + HOUR }, false);
  const decision = await route();
  assert.equal(decision.accountId, 'acc_fritz2');
  assert.equal(decision.modelId, OPUS);
  // Every account failed in this chain: nothing is tried twice, the route ends.
  await assert.rejects(route(['acc_claude', 'acc_fritz2']));
});

test("the Decisions order is for the runtime's helper calls, not for agent turns", async () => {
  const { h, route } = await userSetup();
  h.settings.update({ routing: { fallbacks: { decision: [{ account: 'acc_codex', model: 'codex:gpt-6.1-sol' }] } } } as never);
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, limits: usedUp(T0 + HOUR) }, false);
  assert.equal((await route()).accountId, 'acc_fritz2', 'Work has no order: automatic');
});

test('automatic across providers: both plans used up – the pinned model falls back to the nearest model (same tier)', async () => {
  const { h, route } = await userSetup();
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, limits: usedUp(T0 + HOUR) }, false);
  h.accounts.upsert({ ...h.accounts.get('acc_fritz2')!, limits: usedUp(T0 + 2 * HOUR) }, false);
  const decision = await route();
  assert.equal(decision.accountId, 'acc_codex');
  assert.equal(h.catalog.get(decision.modelId)!.tier, 'frontier', 'a frontier model like Opus, not a small one');
  assert.deepEqual(decision.accountSwitch, { from: 'acc_claude', problem: 'limit', source: 'auto', until: T0 + HOUR });
});

test("the chat's chosen account (AF-021 model menu) used up: the same order runs and the chat is told", async () => {
  const { h, route } = await userSetup({ chat: { accounts: { [TOM]: 'acc_fritz2' } } });
  h.settings.update({ routing: { fallbacks: { work: [{ account: 'acc_claude' }] } } } as never);
  h.accounts.upsert({ ...h.accounts.get('acc_fritz2')!, state: 'cooling', coolingUntil: T0 + HOUR }, false);
  const decision = await route();
  assert.equal(decision.accountId, 'acc_claude');
  assert.deepEqual(decision.accountSwitch, { from: 'acc_fritz2', problem: 'limit', source: 'chat', until: T0 + HOUR, byOrder: true });
  assert.equal(switchLine(h.accounts.list(), decision, 'UTC', T0), 'Switched to fritz1 – fritz2 is used up until 10:00.');
});

// ------------------------------------------------------------------ settings.json and texts

test('routing.fallbacks: valid orders pass, bad ones name the path', () => {
  assert.equal(fallbackProblem(undefined), undefined);
  assert.equal(fallbackProblem({}), undefined);
  assert.equal(fallbackProblem({ work: [{ account: 'acc_2' }, { account: 'acc_codex', model: 'codex:gpt-6.1-sol' }], decision: [] }), undefined);
  assert.equal(fallbackProblem([])?.path, 'routing.fallbacks');
  assert.equal(fallbackProblem({ voice: [] })?.path, 'routing.fallbacks.voice');
  assert.equal(fallbackProblem({ work: 'acc_2' })?.path, 'routing.fallbacks.work');
  assert.equal(fallbackProblem({ work: [{ account: '' }] })?.path, 'routing.fallbacks.work[0].account');
  assert.equal(fallbackProblem({ work: [{ account: 'a b' }] })?.path, 'routing.fallbacks.work[0].account');
  assert.equal(fallbackProblem({ work: [{ account: 'a', model: 5 }] })?.path, 'routing.fallbacks.work[0].model');
  assert.equal(fallbackProblem({ work: [{ account: 'a', extra: 1 }] })?.path, 'routing.fallbacks.work[0]');
  assert.equal(fallbackProblem({ work: [{ account: 'a' }, { account: 'a' }] })?.path, 'routing.fallbacks.work[1]', 'no step twice');
  assert.equal(fallbackProblem({ work: Array.from({ length: 13 }, (_, i) => ({ account: `a${i}` })) })?.path, 'routing.fallbacks.work');

  const defaults = defaultSettings({ locale: 'en-US', timezone: 'Europe/Berlin' });
  assert.deepEqual(defaults.routing.fallbacks, {}, 'default: automatic');
  assert.equal(defaults.routing.accountFallback, 'switch');
  validateSettings({ ...defaults, routing: { ...defaults.routing, fallbacks: { work: [{ account: 'acc_2' }] } } });
  assert.throws(() => validateSettings({ ...defaults, routing: { ...defaults.routing, fallbacks: { work: [{ account: 7 }] } } } as never),
    (error: unknown) => error instanceof WorkforceError && /routing\.fallbacks\.work\[0\]\.account/.test(error.message));
});

test('reading an order is defensive: bad steps drop, duplicates go, nothing throws', () => {
  assert.deepEqual(fallbackOrder(undefined, 'work'), []);
  assert.deepEqual(fallbackOrder({ work: [{ account: 'a' }, null, { account: 'a' }, { account: 'b', model: 'x:y' }, { model: 'x:y' }] }, 'work'), [{ account: 'a' }, { account: 'b', model: 'x:y' }]);
  assert.deepEqual(fallbackOrder({ work: [{ account: 'a' }] }, 'decision'), []);
});

test('an older settings.json: AF-021\'s written default "ask" becomes the new default "switch" once; a later "ask" stays', () => {
  const old = { routing: { work: 'claude', accountFallback: 'ask' } };
  assert.deepEqual(migrateFallback(old), { routing: { work: 'claude' } });
  assert.equal((migrateModelSettings(old).routing as Record<string, unknown>).accountFallback, undefined);
  const current = { routing: { work: 'claude', accountFallback: 'ask', fallbacks: {} } };
  assert.equal(migrateFallback(current), current, 'a file of this version keeps its choice');
  const plain = { routing: { work: 'claude' } };
  assert.equal(migrateFallback(plain), plain);
  const defaults = defaultSettings({ locale: 'en-US', timezone: 'Europe/Berlin' });
  const read = settingsFrom({ routing: { work: 'claude', accountFallback: 'ask' } }, defaults, defaults).settings.routing;
  assert.equal(read.accountFallback, 'switch');
  assert.deepEqual(read.fallbacks, {});
  const kept = settingsFrom({ routing: { accountFallback: 'ask', fallbacks: { work: [{ account: 'acc_2' }] } } }, defaults, defaults).settings.routing;
  assert.equal(kept.accountFallback, 'ask');
  assert.deepEqual(kept.fallbacks, { work: [{ account: 'acc_2' }] });
});

test('the switch line: until today, another day, unknown; the model named when it changed', () => {
  const now = Date.UTC(2026, 10, 19, 10, 0);
  assert.equal(untilText(Date.UTC(2026, 10, 19, 14, 0), now, 'UTC'), '14:00');
  assert.equal(untilText(Date.UTC(2026, 10, 19, 14, 0), now, 'Europe/Berlin'), '15:00');
  assert.equal(untilText(Date.UTC(2026, 10, 21, 8, 30), now, 'UTC'), 'Sat 08:30');
  assert.equal(untilText(Date.UTC(2026, 11, 2, 8, 30), now, 'UTC'), '2 Dec');
  assert.equal(untilText(Date.UTC(2026, 10, 19, 14, 0), now, 'Not/AZone'), untilText(Date.UTC(2026, 10, 19, 14, 0), now), 'a bad zone falls back');
  assert.equal(switchedText({ to: 'Claude 2', from: 'Claude 1', problem: 'limit', until: Date.UTC(2026, 10, 19, 14, 0), now, timeZone: 'UTC' }), 'Switched to Claude 2 – Claude 1 is used up until 14:00.');
  assert.equal(switchedText({ to: 'Codex', model: 'GPT-6.1 Sol', from: 'Claude 1', problem: 'signed_out', now }), 'Switched to GPT-6.1 Sol on Codex – Claude 1 is signed out.');
  assert.equal(switchedText({ to: 'Claude 2', from: 'Claude 1', problem: 'limit', until: now - 1, now }), 'Switched to Claude 2 – Claude 1 is used up.');
});
