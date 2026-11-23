// The subconscious's choice for a call still running at its review (subconscious/tool-timeout.ts chooseToolTimeout).
// B-080: a picked wait counts at any confidence, only a sure "Abort" aborts, everything else waits the same time again.
// B-080 wave 3 (live 08.–09.11.2026: 7 of 9 sure aborts stopped scans that were still working): the model sees true
// facts – secondsSinceMyLastLook, newOutputChars where known, no status "timeout" – and one principle without examples.
// Owns: these assertions only. Never: contacts a model (a scripted decisions.decide).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseToolTimeout } from '../../../src/runtime/subconscious/tool-timeout.ts';
import { NO_DECISION } from '../../../src/runtime/tools/timeout.ts';
import type { DecisionRequest, DecisionResult, RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';

const AGENT = { name: 'Lena' } as ToolContext['agent'];

/** chooseToolTimeout with decide answering `answer`; the requests it sent. */
async function choose(answer: Partial<DecisionResult>, input: { newOutputChars?: number; timeoutSeconds?: number; secondsSinceLastLook?: number } = {}) {
  const requests: DecisionRequest[] = [];
  const services = { decisions: { decide: async (request: DecisionRequest) => { requests.push(request); return { confidence: 0, by: 'fake', ...answer }; } } } as unknown as RuntimeServices;
  const decision = await chooseToolTimeout(services, {
    tool: 'shell.exec', args: { command: 'Get-ChildItem -Recurse C:\\data' }, elapsedSeconds: 273, timeoutSeconds: input.timeoutSeconds ?? 15,
    output: 'C:\\data\\a.txt', agent: AGENT, signal: new AbortController().signal,
    ...(input.newOutputChars !== undefined ? { newOutputChars: input.newOutputChars } : {}),
    ...(input.secondsSinceLastLook !== undefined ? { secondsSinceLastLook: input.secondsSinceLastLook } : {}),
  });
  return { decision, request: requests[0] };
}

/** The tool output object the request's context carries. */
function observed(request: DecisionRequest): Record<string, unknown> {
  const [head, body] = (request.context ?? '').split('\n');
  assert.equal(head, 'Tool output (the call is still running):');
  return JSON.parse(body) as Record<string, unknown>;
}

test('B-080 wave 3: the request carries true facts – secondsSinceMyLastLook and newOutputChars, no status "timeout"', async () => {
  const { request } = await choose({ choice: 'Wait 60 seconds', confidence: 0.9 }, { newOutputChars: 1234 });
  const output = observed(request);
  assert.equal(output.secondsSinceMyLastLook, 15, 'the wait that just ended, named as what it is');
  assert.equal(output.newOutputChars, 1234);
  assert.equal(output.elapsedSeconds, 273);
  assert.equal(output.stillRunning, true);
  assert.equal(output.output, 'C:\\data\\a.txt');
  assert.ok(!('status' in output) && !('timeoutSeconds' in output), JSON.stringify(output));
  assert.ok(!(request.context ?? '').includes('"timeout"'));
  assert.equal(output.instruction, 'I decide how many more seconds this call runs before I look again, or abort it. Elapsed time is no reason to abort: I abort a call whose output shows that it hangs or keeps failing, and give a call that is still working the time it needs. newOutputChars is what it printed since my last look.');
  assert.ok(request.options?.includes('Abort') && request.options.includes('Wait 1800 seconds'));
  const native = observed((await choose({ choice: 'Wait 60 seconds', confidence: 0.9 })).request);
  assert.ok(!('newOutputChars' in native), 'a native call reports none, and none is named');
  // B-080 wave 3 review: a runner that knows when it last looked (shell.exec: a slow review included) names those seconds.
  const runner = observed((await choose({ choice: 'Wait 60 seconds', confidence: 0.9 }, { newOutputChars: 5, secondsSinceLastLook: 115 })).request);
  assert.equal(runner.secondsSinceMyLastLook, 115);
});

test('B-080 wave 3: the instruction names no kind of command and speaks as me, in facts', async () => {
  const { request } = await choose({ choice: 'Wait 60 seconds', confidence: 0.9 }, { newOutputChars: 0 });
  const text = `${request.question}\n${String(observed(request).instruction)}`;
  assert.doesNotMatch(text, /grep|install|build|search|scan/i, 'no command kinds as examples');
  assert.doesNotMatch(text, /\b(you|must|never|only if|allowed)\b/i, 'first person, facts');
  assert.doesNotMatch(request.question, /timeout/i, 'the call is running, not timed out');
});

test('B-080: "Wait N" waits N at any confidence; a sure Abort aborts; an unsure Abort, "none" or no answer waits the same time again', async () => {
  assert.deepEqual((await choose({ choice: 'Wait 120 seconds', confidence: 0.95, by: 'systemone' })).decision, { action: 'wait', seconds: 120, reason: 'The decision model chose another 120 seconds.', by: 'systemone' });
  assert.deepEqual((await choose({ choice: 'Wait 30 seconds', confidence: 0.2, outcome: 'unsure' })).decision, { action: 'wait', seconds: 30, reason: 'The decision model chose another 30 seconds.', by: 'fake' });
  assert.deepEqual((await choose({ choice: 'Abort', confidence: 0.55 })).decision, { action: 'abort', reason: 'The decision model chose to abort.', by: 'fake' }, 'sure from 0.55 on');
  assert.deepEqual((await choose({ choice: 'Abort', confidence: 0.9, outcome: 'choice' })).decision.action, 'abort');
  const same = { action: 'wait', seconds: 240, reason: NO_DECISION, by: 'fake' };
  assert.deepEqual((await choose({ choice: 'Abort', confidence: 0.54 }, { timeoutSeconds: 240 })).decision, same, 'an unsure abort is no decision');
  assert.deepEqual((await choose({ choice: 'Abort', confidence: 0.4, outcome: 'unsure' }, { timeoutSeconds: 240 })).decision, same);
  assert.deepEqual((await choose({ choice: 'none', confidence: 0.9, outcome: 'none_fit' }, { timeoutSeconds: 240 })).decision, same);
  assert.deepEqual((await choose({ confidence: 0, by: 'none' }, { timeoutSeconds: 240 })).decision, { ...same, by: 'none' }, 'no answer');
});
