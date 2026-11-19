// AF-021: a whole turn (TurnExecutor, fake engine, run journal) on the account chosen in the chat: the engine gets
// account B and the run row names it; a chosen account that is used up ends the turn in a failed message that
// carries the choice (meta.accountChoice → the chat's "another account" / "Automatic"), the engine never runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Journal } from '../../../src/runtime/runs/journal.ts';
import { TurnExecutor } from '../../../src/runtime/agents/turn.ts';
import { chosenAccount } from '../../../src/runtime/routing/account-choice.ts';
import { settleAccount } from '../../../src/runtime/routing/account-fallback.ts';
import { account, T0 } from '../models/harness.ts';
import type { Account, ModelInfo } from '../../../src/shared/model/providers.ts';
import { setup } from './fixture.ts';

const OPUS = { id: 'claude:claude-opus-5-5', provider: 'claude', model: 'claude-opus-5-5', accounts: [] } as unknown as ModelInfo;

function withTwoPlans(fallback: 'ask' | 'switch' = 'ask', fritz2: Partial<Account> = {}) {
  const h = setup();
  const fritz1 = { ...h.account, label: 'fritz1' };
  const second = account('acc_fritz2', 'claude', { label: 'fritz2', priority: 1, ...fritz2 });
  const all = [fritz1, second];
  h.services.runs = new Journal({ db: h.db, bus: h.bus, clock: h.clock });
  h.services.accounts = { ...h.services.accounts, get: (id: string) => all.find((entry) => entry.id === id), list: () => all } as typeof h.services.accounts;
  // the router's last step as RouterImpl.route runs it: the automatic pick is fritz1 (h.route)
  h.services.router = { route: async (request) => settleAccount({
    decision: h.route, choice: chosenAccount(h.services, request.agent, request.conversationId), models: [OPUS],
    accounts: all, now: h.clock.now(), exclude: new Set(request.exclude ?? []), fallback, order: [], runnable: () => true,
  }) } as typeof h.services.router;
  const used: string[] = [];
  h.state.script = async (input) => { used.push(input.account.id); return { text: 'Hi', stop: 'done' }; };
  return { h, used };
}

test('the chat chooses account B: the next run starts on B', async () => {
  const { h, used } = withTwoPlans();
  h.chats.update(h.chat.id, { settings: { accounts: { [h.tom.id]: 'acc_fritz2' } } }, 'human');
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Hello' });
  await new TurnExecutor(() => h.services).execute(h.request());
  assert.deepEqual(used, ['acc_fritz2']);
  assert.equal(h.services.runs.get('run_1')?.accountId, 'acc_fritz2');
});

test("the agent's default runs when the chat chooses nothing", async () => {
  const { h, used } = withTwoPlans();
  h.org.add({ ...h.tom, modelPolicy: { account: 'acc_fritz2' } });
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Hello' });
  await new TurnExecutor(() => h.services).execute(h.request());
  assert.deepEqual(used, ['acc_fritz2']);
});

test('nothing chosen: automatic (A)', async () => {
  const { h, used } = withTwoPlans();
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Hello' });
  await new TurnExecutor(() => h.services).execute(h.request());
  assert.deepEqual(used, ['acc_claude']);
});

test('a used-up chosen account stops the turn with a failed message that carries the choice', async () => {
  const { h, used } = withTwoPlans('ask', { state: 'cooling', coolingUntil: T0 + 3_600_000 });
  h.chats.update(h.chat.id, { settings: { accounts: { [h.tom.id]: 'acc_fritz2' } } }, 'human');
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Hello' });
  const outcome = await new TurnExecutor(() => h.services).execute(h.request());
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(used, [], 'never silently on another account');
  const failed = h.chats.messages(h.chat.id, { limit: 10 }).find((message) => message.state === 'failed');
  assert.match(String(failed?.meta.error), /fritz2 has used up its limit/);
  assert.deepEqual(failed?.meta.accountChoice, { accountId: 'acc_fritz2', provider: 'claude', problem: 'limit', source: 'chat', until: T0 + 3_600_000 });
});

test("'switch': the turn runs on A and the chat says why", async () => {
  const { h, used } = withTwoPlans('switch', { state: 'needs_login' });
  h.chats.update(h.chat.id, { settings: { accounts: { [h.tom.id]: 'acc_fritz2' } } }, 'human');
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Hello' });
  await new TurnExecutor(() => h.services).execute(h.request());
  assert.deepEqual(used, ['acc_claude']);
  const line = h.chats.messages(h.chat.id, { limit: 20 }).find((message) => message.meta.status?.text?.includes('fritz2'));
  assert.equal(line?.meta.status?.text, 'Switched to fritz1 – fritz2 is signed out.');
});
