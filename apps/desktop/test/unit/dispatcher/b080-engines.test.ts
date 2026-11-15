// B-080 – the dispatcher's side of the engines package: model.set now switches inside the running turn when the model
// runs on the turn's engine and its own account (TurnRoute.accountId; Engine.setModel: no cut, a {modelSet: 'in-turn'}
// run note, the next-step request ends – 'now' is this turn's; the activity row never shows the account); another
// engine, a model the turn's account does not run, or a refusal cut at the next tool boundary and continue at once as
// before, on that request (B-083: a switch the engine does not apply is logged once); an important line folded from
// another chat writes that chat's one waiting line.
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { setNextRoute } from '../../../src/runtime/agents/next-route.ts';
import type { Engine } from '../../../src/runtime/engines/types.ts';
import type { FakeCall } from './fakes.ts';
import { flush, setup } from './fakes.ts';

const NOTE = 'I switched to Claude Sonnet 5 · high (model.set now) – I continue my work where I stopped; what I did so far is kept.';
const MODELS: Record<string, { id: string; model: string; name: string; engine: string; accounts: string[] }> = {
  'claude:claude-opus-5-5': { id: 'claude:claude-opus-5-5', model: 'claude-opus-5-5', name: 'Claude Opus 5.5', engine: 'claude', accounts: ['acc_a', 'acc_b'] },
  'claude:claude-sonnet-5': { id: 'claude:claude-sonnet-5', model: 'claude-sonnet-5', name: 'Claude Sonnet 5', engine: 'claude', accounts: ['acc_a'] },
  'claude:claude-haiku-5': { id: 'claude:claude-haiku-5', model: 'claude-haiku-5', name: 'Claude Haiku 5', engine: 'claude', accounts: ['acc_b'] },
  'codex:gpt-6.1-sol': { id: 'codex:gpt-6.1-sol', model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', engine: 'codex', accounts: ['acc_c'] },
};

async function working(answer: boolean | 'throw' = true) {
  const h = setup();
  Object.assign(h.services, { catalog: { get: (id: string) => MODELS[id], list: () => Object.values(MODELS) } });
  h.org.add(agent('ag_tom', 'Tom'));
  const chat = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  h.dispatcher.start();
  h.chats.send({ conversationId: chat.id, body: 'Refactor the parser, please.', authorId: 'human' });
  await flush();
  const first = h.executor.last();
  const asked: Array<{ runId: string; model: string; effort: string }> = [];
  first.request.control.engine = {
    id: 'claude',
    setModel: async (runId: string, model: string, effort: string) => { asked.push({ runId, model, effort }); if (answer === 'throw') throw new Error('refused'); return answer; },
  } as unknown as Engine;
  first.request.onRoute?.({ model: 'claude:claude-opus-5-5', modelName: 'Claude Opus 5.5', effort: 'medium', engine: 'claude', accountId: 'acc_a' });
  return { h, chat, first, asked };
}

const nextStep = (h: Awaited<ReturnType<typeof working>>['h'], conversationId: string) => {
  const row = h.db.get<{ value: string }>("SELECT value FROM kv WHERE ns = 'next_route' AND key = ?", ['ag_tom']);
  return row ? JSON.parse(row.value) as { modelId?: string } : undefined;
};

function boundary(h: Awaited<ReturnType<typeof working>>['h'], call: FakeCall) {
  const ctx = { agentId: 'ag_tom', runId: call.request.runId, callId: 'call_model_set' };
  h.dispatcher.setCall(ctx, true); // model.set itself is in flight
  return () => h.dispatcher.setCall(ctx, false);
}

test('model.set now on the turn\'s engine and account: switched inside the turn – no cut, a run note, the turn goes on', async () => {
  const { h, chat, first, asked } = await working(true);
  setNextRoute(h.db, 'ag_tom', { modelId: 'claude:claude-sonnet-5', effort: 'high', at: 1 }); // model.set's own row
  const end = boundary(h, first);
  assert.equal(h.dispatcher.continueNow('ag_tom', first.request.runId, NOTE, { modelId: 'claude:claude-sonnet-5', effort: 'high' }), true);
  await flush();
  end();
  await flush();
  assert.deepEqual(asked, [{ runId: first.request.runId, model: 'claude-sonnet-5', effort: 'high' }]);
  assert.equal(first.request.signal.aborted, false, 'never cut');
  assert.equal(h.executor.calls.length, 1, 'no second turn');
  const note = h.runItems.find((item) => item.kind === 'note' && item.data.modelSet === 'in-turn');
  assert.deepEqual(note?.data, { modelSet: 'in-turn', model: 'claude:claude-sonnet-5', effort: 'high', from: 'claude:claude-opus-5-5' }, 'from: the model the turn ran on before (a part\'s head names its start model)');
  assert.equal(nextStep(h, chat.id), undefined, "'now' is this turn's: the next-step request ended");
  // The engine's 'model' event reaches the activity through the turn's onRoute (turn-attempt.ts):
  first.request.onRoute?.({ model: 'claude:claude-sonnet-5', modelName: 'Claude Sonnet 5', effort: 'high', engine: 'claude', accountId: 'acc_a' });
  assert.equal(h.dispatcher.activity()[0].model, 'claude:claude-sonnet-5');
  assert.equal('accountId' in h.dispatcher.activity()[0], false, 'the row never shows the account');
  first.finish();
  await flush();
});

test("model.set now on another engine, on a model the turn's account does not run, or refused: cut at the boundary and continued at once", async () => {
  for (const [target, answer] of [[{ modelId: 'codex:gpt-6.1-sol' }, true], [{ modelId: 'claude:claude-haiku-5' }, true], [{ modelId: 'claude:claude-sonnet-5' }, false], [{ modelId: 'claude:claude-sonnet-5' }, 'throw']] as const) {
    const { h, chat, first, asked } = await working(answer);
    setNextRoute(h.db, 'ag_tom', { modelId: target.modelId, at: 1 });
    const end = boundary(h, first);
    assert.equal(h.dispatcher.continueNow('ag_tom', first.request.runId, NOTE, target), true);
    await flush();
    assert.equal(first.request.signal.aborted, false, 'never inside the running call');
    end();
    await flush();
    assert.equal(asked.length, target.modelId === 'claude:claude-sonnet-5' ? 1 : 0, `${target.modelId}: the engine is asked only for a model of its own account`);
    assert.equal(first.request.control.stopKind, 'urgent', `${target.modelId}: the urgent cut`);
    const next = h.executor.last();
    assert.notEqual(next, first);
    assert.equal(next.request.conversationId, chat.id);
    assert.deepEqual(next.request.notes.map((item) => item.text), [NOTE]);
    assert.equal(nextStep(h, chat.id)?.modelId, target.modelId, `${target.modelId}: the request stays for the new turn`);
    next.finish();
    await flush();
  }
});

test('B-083: an in-turn switch the engine does not apply is logged once – then cut and continued as before', async () => {
  const { h, chat, first } = await working(false);
  const logged: Array<[string, unknown]> = [];
  Object.assign(h.services.log, { info: (message: string, data?: unknown) => { logged.push([message, data]); } });
  setNextRoute(h.db, 'ag_tom', { modelId: 'claude:claude-sonnet-5', effort: 'high', at: 1 });
  const end = boundary(h, first);
  assert.equal(h.dispatcher.continueNow('ag_tom', first.request.runId, NOTE, { modelId: 'claude:claude-sonnet-5', effort: 'high' }), true);
  await flush();
  end();
  await flush();
  assert.deepEqual(logged.filter(([message]) => message.startsWith('model switch inside the turn')), [
    ['model switch inside the turn not applied', { runId: first.request.runId, engine: 'claude', model: 'claude:claude-sonnet-5', effort: 'high' }],
  ]);
  assert.equal(first.request.control.stopKind, 'urgent', 'the cut-and-continue fallback stays');
  const next = h.executor.last();
  assert.notEqual(next, first);
  next.finish();
  await flush();
});

test('an important line folded from another chat goes into the running turn; no status line in that chat (the live bar shows the work)', async () => {
  const h = setup();
  h.org.add(agent('ag_tom', 'Tom'));
  const a = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  const b = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  h.dispatcher.start();
  h.chats.send({ conversationId: b.id, body: 'publish the release notes', authorId: 'human' });
  await flush();
  const running = h.executor.last();
  running.request.control.engine = { steer: async () => true } as unknown as Engine;
  h.chats.send({ conversationId: a.id, body: 'Call me now', authorId: 'human', priority: 'important' });
  await flush();
  h.chats.send({ conversationId: a.id, body: 'And bring the keys', authorId: 'human', priority: 'important' });
  await flush();
  assert.equal(running.request.signal.aborted, false, 'folded, not cut');
  const waiting = h.chats.messages(a.id, { limit: 50 }).filter((message) => message.kind === 'status' && message.authorId === 'ag_tom');
  assert.equal(waiting.length, 0, '13.11.2026: no waiting line');
  running.finish();
  await flush();
});
