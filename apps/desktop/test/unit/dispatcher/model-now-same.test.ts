// B-080 wave 3 (app-restart-kills-turns #1; live L3: two of Jonas's four model.set cuts changed nothing): model.set now on
// the model and effort the running turn already uses (or without an effort) is true at once – no cut, no model-now wake,
// no engine switch – and the stored next-step request stays; another effort still asks the engine, and a model the engine
// refuses is still cut and continued (b080-engines.test.ts).
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { setNextRoute } from '../../../src/runtime/agents/next-route.ts';
import type { Engine } from '../../../src/runtime/engines/types.ts';
import { flush, openWakes, setup } from './fakes.ts';

const NOTE = 'I switched to GPT-6 Luna · high (model.set now) – I continue my work where I stopped; what I did so far is kept.';
const LUNA = { id: 'codex:gpt-6-luna', model: 'gpt-6-luna', name: 'GPT-6 Luna', engine: 'codex', accounts: ['acc_c'] };

async function working() {
  const h = setup();
  Object.assign(h.services, { catalog: { get: (id: string) => (id === LUNA.id ? LUNA : undefined), list: () => [LUNA] } });
  h.org.add(agent('ag_jonas', 'Jonas'));
  const chat = h.chats.create({ agentIds: ['ag_jonas'], createdBy: 'human' });
  h.dispatcher.start();
  h.chats.send({ conversationId: chat.id, body: 'Check the broker logs, please.', authorId: 'human' });
  await flush();
  const first = h.executor.last();
  const asked: string[] = [];
  first.request.control.engine = { id: 'codex', setModel: async (_runId: string, model: string, effort: string) => { asked.push(`${model}:${effort}`); return false; } } as unknown as Engine;
  first.request.onRoute?.({ model: LUNA.id, modelName: LUNA.name, effort: 'high', engine: 'codex', accountId: 'acc_c' });
  return { h, chat, first, asked };
}

test('model.set now on the model and effort the turn already runs: true, no cut, no wake, no engine switch; the request stays', async () => {
  for (const target of [{ modelId: LUNA.id, effort: 'high' as const }, { modelId: LUNA.id }]) {
    const { h, chat, first, asked } = await working();
    setNextRoute(h.db, 'ag_jonas', { modelId: LUNA.id, effort: 'high', at: 1 }); // model.set's own row
    assert.equal(h.dispatcher.continueNow('ag_jonas', first.request.runId, NOTE, target), true);
    await flush();
    assert.equal(first.request.signal.aborted, false, 'never cut');
    assert.deepEqual(asked, [], 'the engine is not asked');
    assert.equal(h.executor.calls.length, 1, 'no second turn');
    assert.deepEqual(openWakes(h.db).filter((wake) => wake.claimed_at === null), [], 'no model-now wake');
    const row = h.db.get<{ value: string }>("SELECT value FROM kv WHERE ns = 'next_model' AND key = ?", ['ag_jonas']);
    assert.equal(row ? (JSON.parse(row.value) as { modelId?: string }).modelId : undefined, LUNA.id, 'the stored request stays');
    first.finish();
    await flush();
  }
});

test('another effort on the same model still goes to the engine – refused, the turn is cut and continued', async () => {
  const { h, first, asked } = await working();
  assert.equal(h.dispatcher.continueNow('ag_jonas', first.request.runId, NOTE, { modelId: LUNA.id, effort: 'medium' }), true);
  await flush();
  assert.deepEqual(asked, ['gpt-6-luna:medium']);
  assert.equal(first.request.control.stopKind, 'urgent', 'cut the urgent way');
  const next = h.executor.last();
  assert.notEqual(next, first);
  assert.deepEqual(next.request.notes.map((item) => item.text), [NOTE]);
  next.finish();
  await flush();
});
