// KI-Runde 17.11.2026 (review 3, finding 1) – one engine attempt (agents/turn-attempt.ts): a call of ours that still holds
// when its attempt ends (a waiting agents.split while the Codex app-server exits and a failover follows) ends 'stopped' with
// that attempt – its parts then wake the origin (splits/service.ts waitFor) instead of counting as read by the next attempt.
// Owns: these assertions only. Never: real engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAttempt } from '../../../src/runtime/agents/turn-attempt.ts';
import { GENERAL_MODE } from '../../../src/runtime/modes/service.ts';
import { SplitWaits, type WaitEnd } from '../../../src/runtime/splits/wait.ts';
import type { TurnPlan } from '../../../src/runtime/agents/turn-types.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';
import { setup } from './fixture.ts';

test('a call still holding when its attempt ends is ended stopped, and later calls of that attempt do not run', async () => {
  const h = setup();
  Object.assign(h.services, { runs: { list: () => [], start: () => {}, finish: () => {}, updateItem: () => {}, item: () => ({ id: 'ri_1' }) } });
  const waits = new SplitWaits(() => ({ status: 'running' } as never));
  let held: Promise<{ ended: WaitEnd }> | undefined;
  Object.assign(h.services.tools, {
    get: () => undefined,
    call: async (_name: string, _args: unknown, ctx: ToolContext) => {
      held = waits.hold('run-1', ['spl-1'], ctx.signal, 60_000);
      await held;
      return { content: [{ type: 'text', text: 'waited' }] };
    },
  });
  let late: ((name: string, args: unknown, callId: string) => Promise<{ isError?: boolean }>) | undefined;
  h.state.script = async (input) => {
    void input.callTool!('agents.split', { wait: true }, 'call-1');
    late = input.callTool as typeof late;
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw new Error('app-server exited'); // the attempt ends; a failover would start the next one
  };
  const plan = { agent: h.tom, mode: GENERAL_MODE, conversationId: h.chat.id, thread: 'main', memberCursor: 0, focus: '' } as unknown as TurnPlan;
  const attempt = await runAttempt(h.services, plan, h.routed(), h.request(), undefined);
  assert.equal(attempt.result.stop, 'error');
  assert.ok(held, 'the call started its hold');
  assert.equal(waits.waiting('spl-1'), false, 'nobody waits for the part any more');
  assert.equal((await held).ended, 'stopped');
  assert.equal((await late!('files.read', {}, 'call-2')).isError, true, 'a call after the attempt ended does not run');
});
