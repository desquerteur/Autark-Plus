// B-080 wave 3 (tool-timeout-decider): shell.exec tells their timeout review what the command printed
// since the last look (newOutputChars); an engine's native call reports no output while it runs, so its review
// (agents/native-timeout.ts) names none and keeps the sentence that no output was reported yet.
// Owns: these assertions only. Never: starts a provider or waits in real time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Engine, EngineTurnInput, EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';
import type { ToolTimeoutInput } from '../../../src/runtime/tools/timeout.ts';
import { runWithNativeTimeouts } from '../../../src/runtime/agents/native-timeout.ts';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('B-080 wave 3: a native call\'s review carries no newOutputChars and says that no output was reported yet', async () => {
  let time = 0;
  const pending = new Set<{ fn: () => void; at: number }>();
  const tick = (ms: number) => {
    const until = time + ms;
    for (;;) {
      const due = [...pending].filter((entry) => entry.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      time = due.at; pending.delete(due); due.fn();
    }
    time = until;
  };
  const stop = new AbortController();
  const input = { runId: 'r1', input: [{ type: 'text', text: 'scan' }], signal: stop.signal, onEvent: () => undefined } as unknown as EngineTurnInput;
  const ctx = { signal: stop.signal, services: { secrets: { redact: (text: string) => text } } } as unknown as ToolContext;
  const reviews: ToolTimeoutInput[] = [];
  let active!: EngineTurnInput;
  let finish!: (result: EngineTurnResult) => void;
  const engine = { run: (turn: EngineTurnInput) => {
    active = turn;
    turn.onEvent({ type: 'tool_start', callId: 'c1', name: 'shell', args: { command: 'Get-ChildItem -Recurse' }, own: true });
    return new Promise<EngineTurnResult>((resolve) => { finish = resolve; });
  } } as unknown as Engine;
  const running = runWithNativeTimeouts(engine, input, ctx, {
    now: () => time, initial: () => 1,
    timers: {
      set: (fn, ms) => { const entry = { fn, at: time + ms }; pending.add(entry); return entry; },
      clear: (handle) => { pending.delete(handle as { fn: () => void; at: number }); },
    },
    review: async (_ctx, timeout) => { reviews.push(timeout); return { action: 'wait', seconds: 2, reason: 'working' }; },
  });
  tick(1000); await flush();
  tick(2000); await flush();
  assert.equal(reviews.length, 2);
  for (const review of reviews) {
    assert.ok(!('newOutputChars' in review), JSON.stringify(review));
    assert.equal(review.output, 'No tool output has been reported yet; this native tool is still running.');
  }
  assert.deepEqual(reviews.map((review) => review.timeoutSeconds), [1, 2], 'the wait that just ended');
  active.onEvent({ type: 'tool_end', callId: 'c1', ok: true, summary: 'listed', output: 'a.txt' });
  finish({ text: 'done', stop: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as EngineTurnResult);
  assert.equal((await running).stop, 'done');
});
