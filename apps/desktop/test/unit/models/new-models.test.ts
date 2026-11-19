// A provider's new model is there by itself (owner 09.11.2026: "automatisch geladen, automatisch gefunden, automatisch
// verwendet"): a version newer than every curated one takes its predecessor's prior (models/priors.ts forNewer), cooling
// accounts are listed too (catalog-merge.ts isListable), a started catalog lists again on its own (catalog.ts), and
// Claude Code updates itself (engines/claude/cli-update.ts) – live, 2.1.303 knew no Fable 5.2 and 2.1.321 did.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { claudeBusy, keepClaudeCodeCurrent, updateClaudeCode } from '../../../src/runtime/engines/claude/cli-update.ts';
import { account, setup, standardSetup } from './harness.ts';
import { fakeFinder, fakeSpawn, testSupervisor, type SpawnCall } from '../engines/fakes.ts';

const PRIORS = Priors.parse({
  version: 'test', categories: {},
  models: [
    { match: 'claude-fable-5-1*', name: 'Claude Fable 5.1', tier: 'frontier', smarts: 92, priceInputPerM: 10, priceOutputPerM: 50, strengths: { chat: 0.7, coding: 0.9 } },
    { match: 'claude-opus-5-5*', name: 'Claude Opus 5.5', tier: 'frontier', smarts: 94, relCost: 0.6, strengths: { chat: 0.5 } },
    { match: 'gpt-6.1-sol*', name: 'GPT-6.1 Sol', tier: 'frontier', relCost: 0.3, smarts: 93, strengths: { coding: 0.8 } },
    { match: 'gpt-6-sol*', name: 'GPT-6 Sol', tier: 'strong', relCost: 0.25, smarts: 88, strengths: { coding: 0.7 } },
    { match: 'gpt-6-luna*', name: 'GPT-6 Luna', tier: 'small', relCost: 0.03, smarts: 72, strengths: { 'cheap-chat': 0.8 } },
    { match: '*embed*', name: 'Embedding model', tier: 'local', relCost: 0, strengths: { embeddings: 0.8 } },
  ],
});

test('a version newer than every curated one takes its predecessor\'s prior without name and prices', () => {
  const fable = PRIORS.forNewer('claude-fable-5-2')!;
  assert.equal(fable.tier, 'frontier');
  assert.equal(fable.smarts, 92);
  assert.deepEqual(fable.strengths, { chat: 0.7, coding: 0.9 });
  assert.equal(fable.name, undefined, 'its own name comes from the provider');
  assert.equal(fable.priceInputPerM, undefined, 'the daily price list prices it');
  assert.equal(fable.relCost, undefined, 'a relative cost derived from the old prices goes with them');
  assert.equal(PRIORS.forNewer('claude-fable-5-2-1m')?.smarts, 92, 'a 1M variant follows the same predecessor');
  assert.equal(PRIORS.forNewer('anthropic/claude-fable-5.2')?.smarts, 92, 'a gateway id too');
  assert.equal(PRIORS.forNewer('claude-opus-6')?.smarts, 94);
  assert.equal(PRIORS.forNewer('claude-opus-6')?.relCost, 0.6, 'a curated relative cost (no prices) stays');
  assert.equal(PRIORS.forNewer('gpt-6.2-sol')?.smarts, 93, 'the newest curated version, not an older one');
  assert.equal(PRIORS.forNewer('gpt-7-luna')?.tier, 'small');
});

test('known, older or unrelated models take nothing from forNewer', () => {
  for (const model of ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-6.1-sol-fast', 'gpt-7', 'some-embed-2', 'claude-fable']) {
    assert.equal(PRIORS.forNewer(model), undefined, model);
  }
});

test('the catalog scores and routes a model the priors do not know yet like its predecessor', async () => {
  const h = setup({ priors: PRIORS });
  h.accounts.upsert(account('acc_claude', 'claude'), false);
  h.engine('claude').lists.set('claude', [
    { model: 'claude-fable-5-1', name: 'Claude Fable 5.1', efforts: ['high'] },
    { model: 'claude-fable-5-2', name: 'Claude Fable 5.2', efforts: ['high'] },
  ]);
  await h.catalog.refresh({ force: true });
  const fable = h.catalog.get('claude:claude-fable-5-2')!;
  assert.equal(fable.name, 'Claude Fable 5.2');
  assert.equal(fable.tier, 'frontier');
  assert.equal(fable.smarts, 92);
  assert.equal(fable.strengths.coding, 0.9);
  const list = h.catalog.list().map((model) => model.id);
  assert.ok(list.indexOf('claude:claude-fable-5-2') < list.indexOf('claude:claude-fable-5-1'), 'the new version on top');
  assert.equal(h.catalog.get('claude:claude-fable-5-1')!.newer, 'claude:claude-fable-5-2');
});

test('a cooling account is listed again: listing costs no quota', async () => {
  const h = await standardSetup();
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, state: 'cooling', coolingUntil: Date.now() + 3_600_000 }, false);
  h.engine('claude').lists.set('claude', [{ model: 'claude-fable-5-2', name: 'Claude Fable 5.2', efforts: ['high'] }]);
  await h.catalog.refresh({ force: true });
  assert.ok(h.catalog.get('claude:claude-fable-5-2'), 'the cooling plan\'s new model is in the catalog');
  h.accounts.upsert({ ...h.accounts.get('acc_claude')!, state: 'needs_login' }, false);
  h.engine('claude').lists.set('claude', [{ model: 'claude-fable-6', name: 'Claude Fable 6', efforts: ['high'] }]);
  await h.catalog.refresh({ force: true });
  assert.equal(h.catalog.get('claude:claude-fable-6'), undefined, 'a signed-out account is not asked');
});

test('a started catalog lists every account again on its own', async () => {
  const h = setup();
  h.accounts.upsert(account('acc_codex', 'codex'), false);
  h.engine('codex').lists.set('codex', [{ model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', efforts: ['medium'] }]);
  const { Catalog } = await import('../../../src/runtime/models/catalog.ts');
  const catalog = new Catalog({ services: () => h.services, priors: PRIORS, debounceMs: 0, priceFeed: false, relistMs: 20 });
  await catalog.refresh({ force: true });
  catalog.start();
  try {
    h.engine('codex').lists.set('codex', [
      { model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', efforts: ['medium'] },
      { model: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', efforts: ['medium'] },
    ]);
    h.clock.advance(11 * 60_000); // past the 10-minute throttle of unforced refreshes
    await new Promise((resolve) => setTimeout(resolve, 80));
    await catalog.flush();
    assert.ok(catalog.get('codex:gpt-6.2-sol'), 'the provider\'s new model showed without a restart');
    assert.equal(catalog.get('codex:gpt-6.2-sol')!.smarts, 93);
  } finally {
    catalog.stop();
  }
});

/** updateClaudeCode with a fake `claude update` that prints `out` and exits with `code`. */
function updater(out: string, code = 0, finder: Record<string, string | null> = { claude: '/bin/claude' }, accounts = [{ provider: 'claude', enabled: true }]) {
  const { spawn, calls } = fakeSpawn((call: SpawnCall) => setImmediate(() => { call.child.stdout.write(out); call.child.exit(code); }));
  const supervisor = testSupervisor(spawn);
  const log = { infos: [] as string[], warns: [] as string[], info(msg: string) { this.infos.push(msg); }, warn(msg: string) { this.warns.push(msg); } };
  let updated = 0;
  const deps = { supervisor, finder: fakeFinder(finder), log, onUpdated: () => { updated++; }, env: {}, testProfile: false, accounts: () => accounts as { provider: 'claude' | 'codex'; enabled: boolean; deviceId?: string }[] };
  return { deps, calls, log, supervisor, updated: () => updated };
}

test('Claude Code updates itself with its own updater; a new version lists the Claude accounts again', async () => {
  const r = updater('Current version: 2.1.303\nNew version available: 2.1.321\nSuccessfully updated from 2.1.303 to version 2.1.321\n');
  assert.equal(await updateClaudeCode(r.deps), 'updated');
  assert.deepEqual(r.calls.map((call) => [call.command, ...call.args]), [['/bin/claude', 'update']]);
  assert.equal(r.updated(), 1);
  assert.deepEqual(r.log.infos, ['Claude Code updated']);

  const same = updater('Current version: 2.1.321\nClaude Code is up to date (2.1.321)\n');
  assert.equal(await updateClaudeCode(same.deps), 'current');
  assert.equal(same.updated(), 0);

  const failed = updater('npm ERR! EBUSY', 1);
  assert.equal(await updateClaudeCode(failed.deps), 'failed');
  assert.deepEqual(failed.log.warns, ['Claude Code update failed']);
});

test('no update while a Claude process of the runtime runs, without Claude Code, or in demo mode', async () => {
  const busy = updater('Successfully updated');
  busy.supervisor.spawn({ command: '/bin/claude', args: ['-p'], owner: 'claude:run_1', kind: 'heavy' });
  assert.ok(claudeBusy(busy.supervisor));
  assert.equal(await updateClaudeCode(busy.deps), 'busy');
  assert.equal(busy.calls.length, 1, 'only the turn ran');

  const none = updater('Successfully updated', 0, { claude: null });
  assert.equal(await updateClaudeCode(none.deps), 'missing');
  const demo = updater('Successfully updated');
  assert.equal(await updateClaudeCode({ ...demo.deps, demo: true }), 'missing');
  assert.equal(none.calls.length + demo.calls.length, 0);
});

test('the PC\'s Claude Code is updated only for a profile with a Claude account in use here, never for a test profile (FIXES-4 G3)', async () => {
  const runs = async (accounts: { provider: 'claude' | 'codex'; enabled: boolean; deviceId?: string }[], env: NodeJS.ProcessEnv = {}) => {
    const r = updater('Successfully updated', 0, { claude: '/bin/claude' }, accounts);
    const outcome = await updateClaudeCode({ ...r.deps, env });
    return { outcome, calls: r.calls.length };
  };
  assert.deepEqual(await runs([{ provider: 'claude', enabled: true }]), { outcome: 'updated', calls: 1 });
  assert.deepEqual(await runs([]), { outcome: 'unused', calls: 0 }, 'no Claude account');
  assert.deepEqual(await runs([{ provider: 'claude', enabled: false }, { provider: 'codex', enabled: true }]), { outcome: 'unused', calls: 0 }, 'every Claude account off');
  assert.deepEqual(await runs([{ provider: 'claude', enabled: true, deviceId: 'dev_other' }]), { outcome: 'unused', calls: 0 }, 'a Claude account of another PC');
  const profile = updater('Successfully updated');
  assert.equal(await updateClaudeCode({ ...profile.deps, testProfile: true }), 'unused', 'a test profile');
  assert.equal(profile.calls.length, 0);
});

test('the test profile is read from the runtime\'s own env, not from the env the update process gets (review R2)', async () => {
  const before = process.env.WORKFORCE_TEST_DATA;
  process.env.WORKFORCE_TEST_DATA = 'C:\\profile';
  try {
    const r = updater('Successfully updated');
    const { testProfile: _, ...deps } = r.deps;
    assert.equal(await updateClaudeCode({ ...deps, env: { PATH: '/bin' } }), 'unused');
    assert.equal(r.calls.length, 0);
  } finally {
    if (before === undefined) delete process.env.WORKFORCE_TEST_DATA; else process.env.WORKFORCE_TEST_DATA = before;
  }
});

test('a Claude account that arrives after the first attempt gets the update at the next short retry (review R1)', async () => {
  const accounts: { provider: 'claude' | 'codex'; enabled: boolean }[] = [];
  const r = updater('Successfully updated', 0, { claude: '/bin/claude' }, accounts);
  const stop = keepClaudeCodeCurrent({ ...r.deps, firstAfterMs: 1, retryMs: 30, everyMs: 60 * 60_000 });
  try {
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(r.calls.length, 0, 'no account at the first attempt');
    accounts.push({ provider: 'claude', enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(r.calls.length, 1);
  } finally { stop(); }
});
