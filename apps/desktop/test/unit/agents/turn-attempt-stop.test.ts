// B-085 – one engine attempt (agents/turn-attempt.ts): the person's Stop wins over an engine that did not hear it – a
// turn stopped with stopKind 'human' whose engine still returns 'done' ends 'interrupted'; any other stop kind, or no
// abort at all, keeps the engine's 'done'.
// Owns: these assertions only. Never: real engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAttempt } from '../../../src/runtime/agents/turn-attempt.ts';
import { GENERAL_MODE } from '../../../src/runtime/modes/service.ts';
import type { TurnPlan } from '../../../src/runtime/agents/turn-types.ts';
import type { StopKind } from '../../../src/runtime/agents/turn-types.ts';
import { setup } from './fixture.ts';

function quietJournal(h: ReturnType<typeof setup>): void {
  Object.assign(h.services, { runs: { list: () => [], start: () => {}, finish: () => {}, updateItem: () => {}, item: () => ({ id: 'ri_1' }) } });
}

const planOf = (h: ReturnType<typeof setup>) =>
  ({ agent: h.tom, mode: GENERAL_MODE, conversationId: h.chat.id, thread: 'main', memberCursor: 0, focus: '' }) as unknown as TurnPlan;

/** An engine that ignores the abort: the turn is stopped while it runs, and it still answers 'done'. */
async function stoppedAttempt(kind: StopKind | undefined, abort: boolean) {
  const h = setup();
  quietJournal(h);
  const controller = new AbortController();
  const control = { lastSeq: 0, steeredSeq: 0 } as ReturnType<typeof h.request>['control'];
  h.state.script = async () => {
    if (abort) { if (kind) control.stopKind = kind; controller.abort(); }
    return { text: 'Finished anyway.', stop: 'done' };
  };
  return runAttempt(h.services, planOf(h), h.routed(), h.request({ signal: controller.signal, control }), undefined);
}

test("the person's Stop wins: an engine that still says 'done' ends 'interrupted', its text kept", async () => {
  const attempt = await stoppedAttempt('human', true);
  assert.equal(attempt.result.stop, 'interrupted');
  assert.equal(attempt.result.text, 'Finished anyway.');
});

test("another stop kind or no abort keeps the engine's 'done'", async () => {
  assert.equal((await stoppedAttempt('urgent', true)).result.stop, 'done', 'an urgent cut that the engine finished anyway');
  assert.equal((await stoppedAttempt(undefined, false)).result.stop, 'done', 'a plain turn');
});
