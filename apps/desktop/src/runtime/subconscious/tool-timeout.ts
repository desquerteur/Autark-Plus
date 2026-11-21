// The subconscious's timeout choice, also usable by choice-only System One decision models. B-080 (live 05.–08.11.2026:
// 71 of 80 aborts were no decision – a failed backend, an unsure or "none" answer): a picked wait counts at any
// confidence, an abort is only a sure "Abort", and everything else lets the call run for the same time again.
// B-080 wave 3 (live 08.–09.11.2026: 7 of 9 sure aborts stopped long scans that were still working – the observation
// said status "timeout", showed the last short wait as timeoutSeconds and an install-vs-grep example): the model sees
// true facts – the seconds since its last look, what the call printed since then where known – and one principle.
// Review: a runner that knows when it last looked names those seconds (secondsSinceLastLook), else the wait that ended.
// Owns: the timeout tool output and seconds suggestions. Never: cancels a process or reruns a command.

import type { RuntimeServices } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { ToolTimeoutDecision, ToolTimeoutInput } from '../tools/timeout.ts';
import { outcomeOf } from '../decision/service.ts';
import { sameWait, TIMEOUT_REVIEW_MS } from '../tools/timeout.ts';

export async function chooseToolTimeout(services: RuntimeServices, input: ToolTimeoutInput & { agent: Agent; signal: AbortSignal }): Promise<ToolTimeoutDecision> {
  const suggestions = [15, 30, 60, 120, 300, 600, 1800];
  const options = [...suggestions.map((seconds) => `Wait ${seconds} seconds`), 'Abort'];
  const output = {
    stillRunning: true, tool: input.tool, args: JSON.stringify(input.args ?? {}).slice(0, 4000),
    elapsedSeconds: input.elapsedSeconds, secondsSinceMyLastLook: input.secondsSinceLastLook ?? input.timeoutSeconds,
    ...(input.newOutputChars !== undefined ? { newOutputChars: input.newOutputChars } : {}), output: input.output,
    instruction: 'I decide how many more seconds this call runs before I look again, or abort it. Elapsed time is no reason to abort: I abort a call whose output shows that it hangs or keeps failing, and give a call that is still working the time it needs. newOutputChars is what it printed since my last look.',
  };
  const result = await services.decisions.decide({
    type: 'choice', purpose: 'other',
    question: `As the subconscious of ${input.agent.name}: this tool call is still running – how many more seconds before I look again, or Abort?`,
    options, context: `Tool output (the call is still running):\n${JSON.stringify(output)}`, timeoutMs: TIMEOUT_REVIEW_MS, signal: input.signal,
  });
  const index = options.indexOf(result.choice ?? '');
  if (index >= 0 && index < suggestions.length) {
    return { action: 'wait', seconds: suggestions[index], reason: `The decision model chose another ${suggestions[index]} seconds.`, by: result.by };
  }
  if (result.choice === 'Abort' && outcomeOf(result) === 'choice') return { action: 'abort', reason: 'The decision model chose to abort.', by: result.by };
  return sameWait(input.timeoutSeconds, result.by);
}
