// AF-021: the chosen account of a turn – precedence (chat choice → agent default → automatic), the route on the
// chosen account (real router, real account selection, fake engines), and a chosen account that cannot run
// ('ask' stops with a clear reason, 'switch' runs elsewhere and is marked).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, agent, mode, standardSetup, T0 } from '../models/harness.ts';
import { accountChoiceOf, accountFallbackOf, readStop, stopText } from '../../../src/shared/model/account-choice.ts';
import { switchLine } from '../../../src/runtime/routing/account-choice.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';

const TOM = 'ag_tom00000001';
const OPUS = 'claude:claude-opus-5-5';

test('precedence: the chat choice, else the agent default, else automatic', () => {
  assert.deepEqual(accountChoiceOf('acc_b', 'acc_a'), { accountId: 'acc_b', source: 'chat' });
  assert.deepEqual(accountChoiceOf(undefined, 'acc_a'), { accountId: 'acc_a', source: 'agent' });
  assert.equal(accountChoiceOf('auto', 'acc_a'), undefined, "'Automatic' picked in the chat beats the agent default");
  assert.deepEqual(accountChoiceOf('', 'acc_a'), { accountId: 'acc_a', source: 'agent' }, 'an empty entry is no chat choice');
  assert.equal(accountChoiceOf(undefined, undefined), undefined);
  assert.equal(accountChoiceOf('', 'auto'), undefined);
  assert.equal(accountChoiceOf(42, null), undefined, 'junk is no choice');
  assert.equal(accountFallbackOf(undefined), 'switch', 'AF-023: switching is the default');
  assert.equal(accountFallbackOf('ask'), 'ask');
  assert.equal(accountFallbackOf('nonsense'), 'switch');
});

test('a stop reads back from message meta; junk does not', () => {
  assert.deepEqual(readStop({ accountId: 'a', provider: 'claude', problem: 'limit', source: 'chat', until: 5 }), { accountId: 'a', provider: 'claude', problem: 'limit', source: 'chat', until: 5 });
  assert.equal(readStop({ accountId: 'a', provider: 'claude', problem: 'boom', source: 'chat' }), undefined);
  assert.equal(readStop('x'), undefined);
  assert.match(stopText('fritz2', 'limit', 'chat'), /^fritz2 has used up its limit – the account chosen for this chat\. Choose another account or Automatic\.$/);
});

/**
 * Two Claude plans (fritz1 the primary, fritz2 outside rotation) and the Codex plan; Tom's start model is Opus (since
 * upstream 0.3.12 a chat's model chip is a suggestion for the AI and never routes – router.ts, 13.11.2026).
 */
async function twoClaude(chat: Record<string, unknown> = {}, agentAccount?: string) {
  const h = await standardSetup();
  h.accounts.upsert(account('acc_claude', 'claude', { label: 'fritz1' }), false);
  h.accounts.upsert(account('acc_fritz2', 'claude', { label: 'fritz2', priority: 1, createdAt: T0 + 1 }), false);
  await h.catalog.refresh({ force: true });
  h.agents.set(TOM, agent(TOM, { modelPolicy: { pin: OPUS, ...(agentAccount ? { account: agentAccount } : {}) } }));
  h.addChat('ch_main', [TOM], { ...chat });
  const route = () => h.router.route({ agent: h.agents.get(TOM)!, conversationId: 'ch_main', mode: mode('chat'), text: 'hello' });
  return { h, route };
}

test('automatic: the router picks the primary plan', async () => {
  const { route } = await twoClaude();
  const decision = await route();
  assert.equal(decision.modelId, OPUS);
  assert.equal(decision.accountId, 'acc_claude');
});

test('the chat choice B runs instead of A – also an account outside rotation', async () => {
  const { route } = await twoClaude({ accounts: { [TOM]: 'acc_fritz2' } });
  const decision = await route();
  assert.equal(decision.modelId, OPUS);
  assert.equal(decision.accountId, 'acc_fritz2');
  assert.match(decision.reason, /account chosen in this chat/);
});

test("the agent's default applies when the chat chooses nothing, and the chat choice beats it", async () => {
  const byAgent = await twoClaude({}, 'acc_fritz2');
  assert.equal((await byAgent.route()).accountId, 'acc_fritz2');
  const both = await twoClaude({ accounts: { [TOM]: 'acc_claude' } }, 'acc_fritz2');
  assert.equal((await both.route()).accountId, 'acc_claude');
  const autoInChat = await twoClaude({ accounts: { [TOM]: 'auto' } }, 'acc_fritz2');
  assert.equal((await autoInChat.route()).accountId, 'acc_claude', "'Automatic' in the chat beats the agent default");
});

test("another provider's account never changes the route", async () => {
  const { route } = await twoClaude({ accounts: { [TOM]: 'acc_codex' } });
  const decision = await route();
  assert.equal(decision.modelId, OPUS);
  assert.equal(decision.accountId, 'acc_claude');
});

test("a used-up chosen account: 'ask' stops with the reason and the choices", async () => {
  const { h, route } = await twoClaude({ accounts: { [TOM]: 'acc_fritz2' } });
  h.settings.update({ routing: { accountFallback: 'ask' } } as never);
  const reset = T0 + 3 * 3_600_000;
  h.accounts.upsert({ ...h.accounts.get('acc_fritz2')!, limits: { windows: [{ name: '5h', usedPercent: 100, windowMinutes: 300, resetsAt: reset }] } as never }, false);
  await assert.rejects(route(), (error: unknown) => {
    assert.ok(error instanceof WorkforceError);
    assert.equal(error.code, 'unavailable');
    assert.match(error.message, /fritz2 has used up its limit/);
    assert.deepEqual(error.details?.accountChoice, { accountId: 'acc_fritz2', provider: 'claude', problem: 'limit', source: 'chat', until: reset });
    assert.equal(error.details?.setup, true, 'no quiet re-delivery: the person decides');
    return true;
  });
});

test("a used-up chosen account: 'switch' runs on another account and marks it, so the chat says so", async () => {
  const { h, route } = await twoClaude({ accounts: { [TOM]: 'acc_fritz2' } });
  h.settings.update({ routing: { accountFallback: 'switch' } } as never);
  h.accounts.upsert({ ...h.accounts.get('acc_fritz2')!, state: 'cooling', coolingUntil: T0 + 60_000 }, false);
  const decision = await route();
  assert.equal(decision.accountId, 'acc_claude');
  assert.deepEqual(decision.accountSwitch, { from: 'acc_fritz2', problem: 'limit', source: 'chat', until: T0 + 60_000 });
  assert.equal(switchLine(h.accounts.list(), decision, 'UTC', T0), 'Switched to fritz1 – fritz2 is used up until 09:01.');
});

test('a signed-out or just-failed chosen account is named as such', async () => {
  const { h, route } = await twoClaude({}, 'acc_fritz2');
  h.settings.update({ routing: { accountFallback: 'ask' } } as never);
  h.accounts.upsert({ ...h.accounts.get('acc_fritz2')!, state: 'needs_login' }, false);
  await assert.rejects(route(), (error: unknown) => (error as WorkforceError).details?.accountChoice !== undefined
    && (error as WorkforceError & { details: { accountChoice: { problem: string; source: string } } }).details.accountChoice.problem === 'signed_out'
    && (error as WorkforceError & { details: { accountChoice: { source: string } } }).details.accountChoice.source === 'agent');
  h.accounts.upsert({ ...h.accounts.get('acc_fritz2')!, state: 'ok' }, false);
  // failover after the chosen account failed: excluded → no quiet move to another account in 'ask'
  await assert.rejects(h.router.route({ agent: h.agents.get(TOM)!, conversationId: 'ch_main', mode: mode('chat'), text: 'hello', exclude: ['acc_fritz2'] }),
    (error: unknown) => (error as WorkforceError & { details: { accountChoice: { problem: string } } }).details.accountChoice.problem === 'failed');
});
