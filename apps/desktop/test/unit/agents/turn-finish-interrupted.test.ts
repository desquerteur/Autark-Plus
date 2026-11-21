// B-080 wave 3 (app-restart-kills-turns #2; live: 6 interruptions without a reason in the run log): an interrupted run
// keeps why it was cut – its abort reason (a shutdown, an important line, model.set now, the person's Stop) – as the run's
// error; a failed run keeps its error text, a done run none (agents/turn-finish.ts). A turn the last-resort release let go
// (agents/dispatch-settle.ts) that ends late finds its row gone and finishes all the same.
// Owns: these assertions only. Never: real engines, accounts, timers or sleeps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishTurn } from '../../../src/runtime/agents/turn-finish.ts';
import { abandonRun } from '../../../src/runtime/agents/dispatch-settle.ts';
import type { RunEntry } from '../../../src/runtime/agents/dispatch-runs.ts';
import { planTurn } from '../../../src/runtime/agents/turn-prepare.ts';
import type { StopKind } from '../../../src/runtime/agents/turn-types.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { setup } from './fixture.ts';

async function finished(result: EngineTurnResult, cut?: { stopKind: StopKind; reason: string }) {
  const h = setup();
  const patches: Array<{ status?: string; error?: string }> = [];
  Object.assign(h.services.runs, { finish: (_id: string, patch: { status?: string; error?: string }) => { patches.push(patch); } });
  h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, body: 'Write the intro' });
  const controller = new AbortController();
  if (cut) controller.abort(new WorkforceError('cancelled', cut.reason, { details: { stopKind: cut.stopKind } }));
  const request = h.request({ signal: controller.signal, control: { lastSeq: 0, steeredSeq: 0, ...(cut ? { stopKind: cut.stopKind } : {}) } });
  const plan = (await planTurn(h.services, request))!;
  const outcome = finishTurn(h.services, plan, h.routed(), request, h.attempt(result), undefined);
  return { outcome, patch: patches[0] };
}

test('an interrupted run names its abort reason: a shutdown, an important line, model.set now, the person\'s Stop', async () => {
  for (const cut of [
    { stopKind: 'shutdown', reason: 'The runtime is shutting down.' },
    { stopKind: 'urgent', reason: 'Interrupted by an important message.' },
    { stopKind: 'urgent', reason: 'Continuing on the requested model.' },
    { stopKind: 'human', reason: 'The turn was stopped.' },
  ] as const) {
    const { outcome, patch } = await finished({ text: '', stop: 'interrupted' }, cut);
    assert.deepEqual([outcome.status, patch.status, patch.error], ['interrupted', 'interrupted', cut.reason], cut.reason);
    assert.equal(outcome.error, undefined, 'the outcome reports no failure');
  }
});

test('B-080 wave 3: a turn released after an urgent hand-over or a shutdown that ends late – its removed row counts as none: nothing throws, a late answer posts at the end, the run closes', async () => {
  for (const [stopKind, result] of [
    ['urgent', { text: 'Half an intro', stop: 'interrupted' }],
    ['shutdown', { text: '', stop: 'interrupted' }],
    ['urgent', { text: 'Here is the intro.', stop: 'done' }],
  ] as const) {
    const h = setup();
    const patches: Array<{ status?: string }> = [];
    Object.assign(h.services.runs, { finish: (_id: string, patch: { status?: string }) => { patches.push(patch); } });
    h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, body: 'Write the intro' });
    const request = h.request({ control: { lastSeq: 0, steeredSeq: 0, stopKind } });
    const plan = (await planTurn(h.services, request))!;
    abandonRun(h.services, { ...request, lane: h.tom.id, wakeIds: [], attempts: 1, controller: new AbortController(), note: '', startedAt: 0, settle: 'release' } as unknown as RunEntry);
    const outcome = finishTurn(h.services, plan, h.routed(), request, h.attempt(result));
    assert.equal(outcome.status, result.stop, `${stopKind} ${result.stop}: the late end closes its run`);
    assert.equal(patches.at(-1)?.status, result.stop);
    const posted = h.chats.messages(h.chat.id, { limit: 50 }).filter((message) => message.runId === request.runId);
    if (result.stop === 'done') {
      assert.deepEqual(posted.map((message) => [message.body, message.state]), [['Here is the intro.', 'final']], 'the late answer posts at the end');
      assert.equal(outcome.messageId, posted[0]?.id);
    } else assert.deepEqual(posted, [], 'nothing is left behind');
  }
});

test('a failed run keeps its error text; a done run has none', async () => {
  const failed = await finished({ text: '', stop: 'error', error: { code: 'internal', message: 'The engine crashed.' } });
  assert.deepEqual([failed.patch.status, failed.patch.error], ['failed', 'The engine crashed.']);
  const done = await finished({ text: 'Here is the intro.', stop: 'done' });
  assert.deepEqual([done.patch.status, done.patch.error], ['done', undefined]);
});
