// AF-024 – Google Gemini accounts: the quota hints of Gemini's limit texts (engines/quota-wait.ts) – the API's 429 body
// (RetryInfo, per-day quota) through postJson and Gemini CLI's ACP errors –, a daily quota as a used-up "1d" window
// (accounts/failure.ts; the model's own quota keeps the account for other models), the Gemini CLI install through npm,
// the Gemini models' tiers in the shipped priors with the nearest-model rule across the CLI and the API, and the UI's
// names and labels. Owns: nothing in production. Never starts a CLI, installs anything or uses the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { limitFromText, nextPacificMidnight, quotaHint, quotaOf } from '../../../src/runtime/engines/quota-wait.ts';
import { HttpEngineError, postJson } from '../../../src/runtime/engines/http/common.ts';
import { failure } from '../../../src/runtime/engines/acp/turn.ts';
import { AcpRpcError, isLimitError } from '../../../src/runtime/engines/acp/protocol.ts';
import { dailyWindow, recordAccountFailure } from '../../../src/runtime/accounts/failure.ts';
import { selectCandidates } from '../../../src/runtime/accounts/candidates.ts';
import { GEMINI_NEEDS_NODE, INSTALL_FAILED, installCli } from '../../../src/runtime/accounts/install.ts';
import type { ExecutableFinder } from '../../../src/runtime/accounts/executables.ts';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { closestModel } from '../../../src/runtime/routing/account-fallback.ts';
import type { Account, AccountLimits, ModelInfo } from '../../../src/shared/model/providers.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import { nextGeminiName } from '../../../src/ui/settings/providers.ts';
import { windowLabel } from '../../../src/ui/lib/limits.ts';
import { fakeSpawn, testSupervisor } from '../engines/fakes.ts';

const HOUR = 3_600_000;
/** 19.11.2026 10:00 UTC = 02:00 in Los Angeles (PST, UTC-8): the next Pacific midnight is 20.11. 08:00 UTC. */
const NOW = Date.UTC(2026, 10, 19, 10, 0, 0);
const MIDNIGHT_PT = Date.UTC(2026, 10, 20, 8, 0, 0);

/** The Gemini API's 429 body for a used-up free-tier daily quota (shape of ai.google.dev error responses). */
const DAILY_BODY = JSON.stringify([{ error: {
  code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota. Please retry in 39.2s.',
  details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '39s' },
  ],
} }]);
const MINUTE_BODY = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for quota metric GenerateRequestsPerMinutePerProjectPerModel. Please retry in 12s.', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }] } });

test('quota hints: Google\'s RetryInfo, "retry in 1h2m3s", daily quotas until the next Pacific midnight', () => {
  assert.equal(nextPacificMidnight(NOW), MIDNIGHT_PT);
  assert.equal(nextPacificMidnight(Date.UTC(2026, 6, 1, 6, 59, 59)), Date.UTC(2026, 6, 1, 7, 0, 0), 'summer time (PDT, UTC-7)');
  assert.deepEqual(quotaHint(MINUTE_BODY, NOW), { waitMs: 12_000, daily: false, perModel: true });
  assert.deepEqual(quotaHint(DAILY_BODY, NOW), { waitMs: MIDNIGHT_PT - NOW, daily: true, perModel: true }, 'a short retry hint does not end a daily quota');
  assert.deepEqual(quotaHint('You have exhausted your daily quota on this model. Please retry in 5h30m.', NOW), { waitMs: 5.5 * HOUR, daily: true, perModel: true });
  assert.deepEqual(quotaHint('Usage limit reached. Your quota will reset after 1h2m3s.', NOW), { waitMs: HOUR + 2 * 60_000 + 3000, daily: false, perModel: false });
  assert.deepEqual(quotaHint('Too many requests, try again in 30 seconds', NOW), { waitMs: 30_000, daily: false, perModel: false });
  assert.equal(quotaHint('Please retry in 2 hours and 15 minutes.', NOW).waitMs, 2.25 * HOUR);
  assert.equal(quotaHint('retry in 1.5s', NOW).waitMs, 1500);
  assert.deepEqual(quotaHint('rate limit', NOW), { waitMs: undefined, daily: false, perModel: false }, 'no time given: the caller\'s default');
  assert.equal(quotaHint('retry in 900h', NOW).waitMs, undefined, 'more than a week is not believed');
  const error = limitFromText(DAILY_BODY, NOW);
  assert.equal(error.code, 'rate_limited');
  assert.equal(error.retryAfterMs, MIDNIGHT_PT - NOW);
  assert.deepEqual(quotaOf(error.details), { daily: true, perModel: true, resetsAt: MIDNIGHT_PT });
  assert.equal(limitFromText(MINUTE_BODY, NOW).details, undefined, 'a per-minute limit is only a wait');
  assert.equal(quotaOf({ quota: { daily: 'yes' } }), undefined);
});

test('Gemini API: a 429 body\'s own wait and daily quota reach the limit error; the Retry-After header still wins', async () => {
  const call = (body: string, headers: Record<string, string> = {}) => postJson(async () => new Response(body, { status: 429, headers }), 'https://x/v1', {}, {}, new AbortController().signal);
  await assert.rejects(call(MINUTE_BODY), (error: unknown) => error instanceof HttpEngineError && error.data.code === 'rate_limited' && error.data.retryAfterMs === 12_000);
  await assert.rejects(call(MINUTE_BODY, { 'retry-after': '3' }), (error: unknown) => error instanceof HttpEngineError && error.data.retryAfterMs === 3000);
  await assert.rejects(call(DAILY_BODY), (error: unknown) => error instanceof HttpEngineError && quotaOf(error.data.details)?.daily === true
    && quotaOf(error.data.details)?.perModel === true && (error.data.retryAfterMs ?? 0) > HOUR && !JSON.stringify(error.data).includes('generate_content'));
  await assert.rejects(call('not json at all'), (error: unknown) => error instanceof HttpEngineError && error.data.code === 'rate_limited' && error.data.retryAfterMs === undefined);
});

test('Gemini CLI (ACP): its quota errors are limits with their wait – "exhausted your capacity" too', () => {
  const remote = (message: string) => new AcpRpcError('remote', -32603, message);
  const daily = failure(remote('Internal error: [API Error: You have exhausted your daily quota on this model.]'), 'Gemini CLI');
  assert.equal(daily.stop, 'limit');
  assert.equal(quotaOf(daily.error?.details)?.perModel, true);
  assert.ok((daily.error?.retryAfterMs ?? 0) > 0);
  assert.ok(isLimitError(remote('You have exhausted your capacity on this model. Please retry in 4m.')));
  assert.equal(failure(remote('You have exhausted your capacity on this model. Please retry in 4m.'), 'Gemini CLI').error?.retryAfterMs, 4 * 60_000);
  assert.equal(failure(remote('Something else broke'), 'Gemini CLI').stop, 'error');
});

const gemini = (id: string, extra: Partial<Account> = {}): Account => ({
  id, provider: 'gemini-cli', label: id, auth: 'cli', state: 'ok', priority: 0, enabled: true, detected: false, createdAt: 1, ...extra,
});
const limited = (resetsAt: number, perModel: boolean): EngineTurnResult => ({
  text: '', stop: 'limit', error: { code: 'rate_limited', message: 'The usage limit of this account was reached.', retryAfterMs: resetsAt - NOW, details: { quota: { daily: true, perModel, resetsAt } } },
});

/** An account service that records what failure.ts tells it. */
function recorder(list: Account[], withUpdate = true) {
  const calls: string[] = [];
  const accounts = {
    get: (id: string) => list.find((account) => account.id === id),
    markLimited: (id: string, until: number, limits?: AccountLimits) => {
      calls.push(`limited ${id} ${until}`);
      const at = list.findIndex((account) => account.id === id);
      list[at] = { ...list[at], state: 'cooling', coolingUntil: until, ...(limits ? { limits } : {}) };
    },
    markUnavailable: () => false,
    ...(withUpdate ? { updateLimits: (id: string, limits: AccountLimits) => {
      calls.push(`limits ${id} ${limits.windows.map((w) => w.name).join(',')}`);
      const at = list.findIndex((account) => account.id === id);
      list[at] = { ...list[at], limits };
    } } : {}),
  };
  return { accounts, calls, clock: { now: () => NOW } };
}

test('a daily quota becomes a used-up window: the model\'s own keeps the account for other models, an account-wide one cools it until the reset', () => {
  assert.deepEqual(dailyWindow(limited(MIDNIGHT_PT, true), 'gemini-2.5-pro', NOW)?.windows, [{ name: '1d-gemini-2-5-pro', windowMinutes: 1440, usedPercent: 100, resetsAt: MIDNIGHT_PT }]);
  assert.equal(dailyWindow(limited(MIDNIGHT_PT, false), 'gemini-2.5-pro', NOW)?.windows[0].name, '1d');
  assert.equal(dailyWindow(limited(NOW - 1, false), 'x', NOW), undefined, 'a reset in the past is no reading');

  const list = [gemini('acc_g1'), gemini('acc_g2', { priority: 1 })];
  const own = recorder(list);
  assert.equal(recordAccountFailure({ accounts: own.accounts, clock: own.clock }, list[0], 'gemini-2.5-pro', limited(MIDNIGHT_PT, true)), 'limit');
  assert.deepEqual(own.calls, ['limits acc_g1 1d-gemini-2-5-pro'], 'no cooling: only that model waits');
  assert.deepEqual(selectCandidates(list, 'acp', NOW, 'gemini-2.5-pro').map((a) => a.id), ['acc_g2'], 'Gemini 1 is used up for Pro: Gemini 2 stands in');
  assert.deepEqual(selectCandidates(list, 'acp', NOW, 'gemini-2.5-flash').map((a) => a.id), ['acc_g1', 'acc_g2'], 'Flash still runs on Gemini 1 first (every signed-in plan takes turns, upstream 09.11.2026)');
  assert.equal(windowLabel(list[0].limits!.windows[0].name), 'Daily · gemini-2-5-pro');

  const whole = recorder([gemini('acc_g3')]);
  recordAccountFailure({ accounts: whole.accounts, clock: whole.clock }, gemini('acc_g3'), 'auto-gemini-3', limited(MIDNIGHT_PT, false));
  assert.deepEqual(whole.calls, [`limited acc_g3 ${MIDNIGHT_PT}`]);
  assert.equal(whole.accounts.get('acc_g3')?.limits?.windows[0].name, '1d', 'Settings shows the used-up day and its reset');
  assert.equal(windowLabel('1d'), 'Daily');

  const plain = recorder([gemini('acc_g4')], false);
  recordAccountFailure({ accounts: plain.accounts, clock: plain.clock }, gemini('acc_g4'), 'gemini-2.5-pro', limited(MIDNIGHT_PT, true));
  assert.deepEqual(plain.calls.map((call) => call.split(' ')[0]), ['limited'], 'without updateLimits the account cools (as before)');
});

/** A finder over a map the scripted installer changes. */
function scripted(initial: Record<string, string | null>) {
  const map: Record<string, string | null> = { ...initial };
  const finder = {
    find: async (id: string) => (map[id] ? { command: map[id]!, prefixArgs: [], path: map[id]! } : null),
    clear: () => {},
  } as unknown as ExecutableFinder;
  return { finder, map };
}

test('Gemini CLI installs through npm (@google/gemini-cli); without Node.js the error says what to install', async () => {
  const s = scripted({ gemini: null, npm: 'C:\\nodejs\\npm.cmd' });
  const { spawn, calls } = fakeSpawn((call) => { s.map.gemini = 'C:\\Users\\p\\AppData\\Roaming\\npm\\gemini.cmd'; setImmediate(() => call.child.exit(0)); });
  assert.equal(await installCli('gemini-cli', { supervisor: testSupervisor(spawn), finder: s.finder, platform: 'win32', env: { PATH: 'C:\\nodejs' } }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'cmd.exe');
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', 'npm', 'install', '-g', '@google/gemini-cli']);

  const there = scripted({ gemini: '/usr/bin/gemini' });
  assert.equal(await installCli('gemini-cli', { supervisor: testSupervisor(fakeSpawn(() => { throw new Error('no install'); }).spawn), finder: there.finder, platform: 'linux' }), false, 'already installed');

  const noNode = scripted({ gemini: null, npm: null });
  await assert.rejects(installCli('gemini-cli', { supervisor: testSupervisor(fakeSpawn(() => {}).spawn), finder: noNode.finder, platform: 'win32' }), (error: Error) => error.message === GEMINI_NEEDS_NODE);

  const failing = scripted({ gemini: null, npm: '/usr/bin/npm' });
  const exit1 = fakeSpawn((call) => setImmediate(() => call.child.exit(1)));
  await assert.rejects(installCli('gemini-cli', { supervisor: testSupervisor(exit1.spawn), finder: failing.finder, platform: 'linux' }), (error: Error) => error.message === INSTALL_FAILED['gemini-cli']);
  assert.deepEqual(exit1.calls[0].args, ['install', '-g', '@google/gemini-cli']);
});

test('the shipped priors give every Gemini id a tier; the nearest model across Gemini CLI and the API is the same model', () => {
  const priors = Priors.parse(JSON.parse(readFileSync(new URL('../../../resources/model-priors.json', import.meta.url), 'utf8')));
  const tier = (id: string, full?: string) => priors.forModel(id, full)?.tier;
  assert.deepEqual(
    ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'auto-gemini-3', 'gemini-4-argon'].map((id) => tier(id)),
    ['strong', 'small', 'small', 'frontier', 'strong', 'small', 'strong', 'frontier'],
  );
  assert.equal(tier('default', 'gemini-cli:default'), 'strong', 'the CLI\'s own pick keeps its entry');
  assert.notEqual(priors.forModel('gemini-embedding-001')?.match, 'gemini-*-pro*', 'an embedding model is not a chat family');
  const model = (id: string, provider: ModelInfo['provider'], tierOf: ModelInfo['tier']) => ({ id: `${provider}:${id}`, model: id, provider, tier: tierOf }) as ModelInfo;
  const wanted = model('gemini-2.5-pro', 'gemini-cli', 'strong');
  const offered = [model('models/gemini-2.5-flash', 'google', 'small'), model('models/gemini-3-flash-preview', 'google', 'strong'), model('models/gemini-2.5-pro', 'google', 'strong')];
  assert.equal(closestModel(wanted, offered, (m) => m)?.model, 'models/gemini-2.5-pro', 'the API\'s "models/…" id is the same model');
  assert.equal(closestModel(wanted, offered.slice(0, 2), (m) => m)?.model, 'models/gemini-3-flash-preview', 'else the same tier');
});

test('the Google Gemini panel names new accounts Gemini, Gemini 2, …', () => {
  const account = (provider: Account['provider'], label: string) => ({ provider, label });
  assert.equal(nextGeminiName([]), 'Gemini');
  assert.equal(nextGeminiName([account('claude', 'Claude Code')]), 'Gemini');
  assert.equal(nextGeminiName([account('gemini-cli', 'Gemini CLI')]), 'Gemini 2');
  assert.equal(nextGeminiName([account('gemini-cli', 'Gemini'), account('google', 'Gemini 3')]), 'Gemini 4', 'the API keys count; a used name is skipped');
  const setup = readFileSync(new URL('../../../src/ui/settings/ModelSetup.tsx', import.meta.url), 'utf8');
  assert.ok(setup.includes('>Google Gemini<') && setup.includes('<GeminiAdd '), 'Settings › Models has the Google Gemini button and panel');
  const panel = readFileSync(new URL('../../../src/ui/settings/gemini-add.tsx', import.meta.url), 'utf8');
  assert.ok(panel.includes('>Sign in with Google<') && panel.includes('>API key<') && panel.includes('service="google"'), 'both ways');
});
