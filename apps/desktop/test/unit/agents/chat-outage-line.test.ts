// B-080 wave 3 (empty-failed-bubbles, T06 for chat turns; live 08.11.: 23 empty red bubbles in chats, each answered by
// its agent minutes later): a chat turn the platform re-delivers by itself (agents/redelivery.ts) leaves no failed bubble –
// one quiet "Paused: … – continues by itself" line by the agent on its first attempt, none for the re-delivered attempt
// that fails the same way; the next done turn posts. Every failure nothing retries by itself (internal, setup, unknown
// tool effects) keeps its bubble, and so does an outage with partial text. B-083 (failover-no-credit-unfit-standin):
// the retry entry keeps at least the agent's read cursor, takes no retry hint from the engine error, and a wake due
// hours later does not stand in for it.
// Owns: these assertions only. Never: real engines, accounts or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnExecutor } from '../../../src/runtime/agents/turn.ts';
import { ChatRedelivery, REDELIVERY_LINE, noteChatOutage } from '../../../src/runtime/agents/redelivery.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import type { Account } from '../../../src/shared/model/providers.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { Journal } from '../../../src/runtime/runs/journal.ts';
import { FakeTimers } from '../chat/harness.ts';
import { setup, type Script } from './fixture.ts';

const LOST: EngineTurnResult = { text: '', stop: 'error', error: { code: 'unavailable', message: 'The connection to Claude Code was lost.' } };
const LIMIT: EngineTurnResult = { text: '', stop: 'limit', error: { code: 'rate_limited', message: 'The usage limit of this account was reached.', retryAfterMs: 4 * 3600_000 } };

function rig() {
  const h = setup();
  const journal = new Journal({ db: h.db, bus: h.bus, clock: h.clock });
  const accounts: Account[] = [{ ...h.account, state: 'ok' }];
  Object.assign(h.services, { runs: journal, router: { route: async () => h.route } });
  Object.assign(h.services.accounts, { list: () => accounts, markLimited: () => {}, markUnavailable: () => false });
  Object.assign(h.services.catalog, { list: () => [] });
  const redelivery = new ChatRedelivery({ services: () => h.services, timers: new FakeTimers() });
  let runs = 0;
  const turn = async (script: EngineTurnResult | Script) => {
    h.state.script = typeof script === 'function' ? script : async () => script;
    h.wakes.done(h.wakes.claim(h.tom.id, Number.MAX_SAFE_INTEGER).map((wake) => wake.id));
    return new TurnExecutor(() => h.services).execute(h.request({ runId: `run_${++runs}` }));
  };
  const own = () => h.chats.messages(h.chat.id, { limit: 200 }).filter((message) => message.authorId === h.tom.id && message.kind === 'text');
  const paused = () => h.chats.messages(h.chat.id, { limit: 200 }).filter((message) => message.kind === 'status' && message.body.startsWith('Paused:'));
  const entry = () => new KvRepo(h.db).get<{ cursor: number; nextAt: number; attempts: number; used?: boolean }>('redelivery', `${h.tom.id}:${h.chat.id}`);
  return { ...h, journal, redelivery, turn, own, paused, entry };
}

for (const [name, failure, reason] of [['an engine outage', LOST, LOST.error!.message], ['a usage limit', LIMIT, 'a usage limit was reached']] as const) {
  test(`${name} in a chat turn: the row goes, one Paused line by the agent; the re-delivered failure adds nothing; the next done turn posts`, async () => {
    const h = rig();
    h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Summarize the report' });
    const first = await h.turn(failure);
    assert.equal(first.status, 'failed');
    assert.equal(first.messageId, undefined);
    assert.deepEqual(h.own(), [], 'no red bubble');
    assert.deepEqual(h.paused().map((line) => [line.body, line.authorId, line.meta.fromRun, line.silent]), [[`Paused: ${reason} – continues by itself`, h.tom.id, first.runId, true]]);
    assert.equal(h.entry()?.attempts, 1, 'the retry is queued');

    h.redelivery.deliver();
    assert.equal(h.chats.messages(h.chat.id, { limit: 200 }).filter((message) => message.body === REDELIVERY_LINE).length, 1);
    const again = await h.turn(failure);
    assert.equal(again.messageId, undefined);
    assert.deepEqual([h.own().length, h.paused().length], [0, 1], 'the re-delivered failure adds neither a bubble nor a line');
    assert.equal(h.entry()?.attempts, 2);

    const done = await h.turn({ text: 'Here is the summary.', stop: 'done' });
    assert.deepEqual(h.own().map((message) => [message.id, message.state, message.body]), [[done.messageId, 'final', 'Here is the summary.']]);
  });
}

test('failures nothing retries by itself keep their bubble with its error and Retry: internal, setup, unknown tool effects', async () => {
  const cases: Array<[string, EngineTurnResult | Script]> = [
    ['internal', { text: '', stop: 'error', error: { code: 'internal', message: 'Engine exited.' } }],
    ['setup', { text: '', stop: 'error', error: { code: 'unavailable', message: 'Setup must change.', details: { setup: true } } }],
    ['unknown effects', async (input) => {
      input.onEvent({ type: 'tool_start', callId: 'export', name: 'Bash', args: { command: 'export-report' }, own: true });
      return LOST; // the tool result never arrived
    }],
  ];
  for (const [name, failure] of cases) {
    const h = rig();
    h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Export the report' });
    const failed = await h.turn(failure);
    assert.ok(failed.messageId, name);
    const bubble = h.chats.message(failed.messageId!)!;
    assert.equal(bubble.state, 'failed', name);
    assert.ok(bubble.meta.error, `${name}: the reason is shown`);
    assert.deepEqual(h.paused(), [], name);
  }
});

test('a chat outage with partial text keeps its bubble – the text stays readable', async () => {
  const h = rig();
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Summarize the report' });
  const failed = await h.turn(async (input) => {
    input.onEvent({ type: 'text', delta: 'The report covers three' });
    return LOST;
  });
  const bubble = h.chats.message(failed.messageId!)!;
  assert.deepEqual([bubble.state, bubble.body], ['failed', 'The report covers three']);
  assert.equal(h.entry()?.attempts, 1, 'still re-delivered');
});

test('B-083: the retry takes no hint from the engine error, keeps at least the read cursor, and a wake due hours later does not stand in for it', async () => {
  const h = rig();
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Draft the offer' });
  await h.turn(LIMIT);
  assert.equal(h.entry()!.nextAt - h.clock.now(), 60_000, 'its 4 h hint is the account\'s cooling (accounts/failure.ts), not the retry\'s');

  const seq = h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'And the price list' }).seq;
  h.chats.markRead(h.chat.id, h.tom.id, seq); // the cursor moved on meanwhile (a fold the run answered)
  h.wakes.done(h.wakes.claim(h.tom.id, Number.MAX_SAFE_INTEGER).map((wake) => wake.id)); // that line's own wake was taken by that run
  assert.equal(noteChatOutage(h.services, { agentId: h.tom.id, conversationId: h.chat.id, runId: 'run_late', cursor: 0, error: LIMIT.error, toolCalls: 0 }), 1);
  assert.equal(h.entry()!.cursor, seq, 'the entry keeps the read cursor – the retry is not dropped as passed');

  h.wakes.wake({ agentId: h.tom.id, reason: 'schedule', conversationId: h.chat.id, note: 'Weekly check', dueAt: h.clock.now() + 3 * 3600_000 });
  h.clock.advance(60_000);
  assert.equal(h.redelivery.deliver(), 1, 'a wake due in hours does not replace the retry');
  assert.equal(h.entry()!.used, true);

  const next = rig();
  next.chats.send({ conversationId: next.chat.id, authorId: 'human', body: 'Draft the offer' });
  await next.turn(LOST);
  next.wakes.wake({ agentId: next.tom.id, reason: 'message', conversationId: next.chat.id });
  assert.equal(next.redelivery.deliver(), 0, 'a wake due now is the turn there');
  assert.equal(next.entry() ?? undefined, undefined);
});
