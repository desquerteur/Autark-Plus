// B-083 (failover-no-credit-unfit-standin #4, agents/turn.ts): a turn fails over again after each account that fails –
// every failed account of the turn stays out of the next route – until one runs, routing has no other, or tools with
// unknown effects ran; each attempt is booked and noted. Uses the real AccountService and a router stub that asks it
// for candidates the way the real router does (turn-limits.test.ts).
// Owns: these assertions only. Never: real engines, accounts, timers or sleeps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnExecutor } from '../../../src/runtime/agents/turn.ts';
import { AccountServiceImpl, type AccountServiceDeps } from '../../../src/runtime/accounts/service.ts';
import { AccountRepo } from '../../../src/runtime/accounts/repo.ts';
import type { RouteRequest } from '../../../src/runtime/contracts.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { account } from '../models/harness.ts';
import { setup, type Script } from './fixture.ts';

const OPUS = 'claude-opus-5-5';
const LIMIT: EngineTurnResult = { text: '', stop: 'limit', error: { code: 'rate_limited', message: 'The usage limit of this account was reached.' } };
const LOST: EngineTurnResult = { text: '', stop: 'error', error: { code: 'unavailable', message: 'The connection to Claude Code was lost.' } };

function chain() {
  const h = setup();
  const unused = () => { throw new Error('not used in this test'); };
  const service = new AccountServiceImpl({
    db: h.db, bus: h.bus, clock: h.clock, paths: { accounts: 'accounts' }, engines: unused,
    finder: {} as AccountServiceDeps['finder'], supervisor: {} as AccountServiceDeps['supervisor'], secrets: {} as AccountServiceDeps['secrets'],
  });
  const now = h.clock.now();
  const repo = new AccountRepo(h.db);
  for (const [index, id] of ['acc_1', 'acc_2', 'acc_3'].entries()) repo.save(account(id, 'claude', { label: `Claude Code ${index + 1}`, priority: index, createdAt: now + index }));
  const calls: string[] = [];
  const excluded: string[][] = [];
  const scripts: Record<string, Script> = {};
  h.state.script = (input) => { calls.push(input.account.id); return (scripts[input.account.id] ?? (async () => ({ text: 'Done.', stop: 'done' })))(input); };
  Object.assign(h.services, {
    accounts: service,
    router: {
      route: async (request: RouteRequest) => {
        excluded.push([...(request.exclude ?? [])]);
        const pick = service.candidates('claude', OPUS).find((item) => !request.exclude?.includes(item.id))?.id;
        if (!pick) throw new WorkforceError('unavailable', 'Every account that can run a suitable model is limited right now.');
        return { ...h.route, modelId: `claude:${OPUS}`, accountId: pick };
      },
    },
  });
  const run = () => new TurnExecutor(() => h.services).execute(h.request({ runId: 'run_1' }));
  const failovers = () => h.items.filter((item) => item.kind === 'note' && (item.data as { failover?: unknown }).failover)
    .map((item) => (item.data as { failover: { fromAccount: string; toAccount: string; reason: string } }).failover);
  return { ...h, service, calls, excluded, scripts, run, failovers };
}

test('two failing accounts, then a third that runs: one turn, every failed account left out of the next route', async () => {
  const h = chain();
  h.scripts.acc_1 = async () => LIMIT;
  h.scripts.acc_2 = async () => LOST;
  const outcome = await h.run();
  assert.equal(outcome.status, 'done');
  assert.deepEqual(h.calls, ['acc_1', 'acc_2', 'acc_3']);
  assert.deepEqual(h.excluded, [[], ['acc_1'], ['acc_1', 'acc_2']], 'the route leaves out every account that failed in this turn');
  assert.deepEqual(h.failovers().map((item) => [item.fromAccount, item.toAccount, item.reason]), [['acc_1', 'acc_2', 'limit'], ['acc_2', 'acc_3', 'unavailable']]);
});

test('all accounts fail: the chain ends when routing has no other – the turn fails with the last error', async () => {
  const h = chain();
  for (const id of ['acc_1', 'acc_2', 'acc_3']) h.scripts[id] = async () => LIMIT;
  const outcome = await h.run();
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(h.calls, ['acc_1', 'acc_2', 'acc_3'], 'each account once');
  assert.deepEqual(h.excluded.at(-1), ['acc_1', 'acc_2', 'acc_3']);
});

test('a tool with unknown effects ends the chain – no further failover', async () => {
  const h = chain();
  h.scripts.acc_1 = async () => LIMIT;
  h.scripts.acc_2 = async (input) => {
    input.onEvent({ type: 'tool_start', callId: 'export', name: 'Bash', args: { command: 'export-report' }, own: true });
    return LOST; // its result never arrived
  };
  const outcome = await h.run();
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(h.calls, ['acc_1', 'acc_2']);
});
