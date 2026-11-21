// Owns: Responses roundtrip of an explicit tool error and model-directed correction.
// Never: modifies production, calls a real model/tool or reaches beyond loopback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiEngine } from '../../../src/runtime/engines/http/openai.ts';
import type { ToolOutput } from '../../../src/runtime/tools/types.ts';
import { account, turnInput } from './fakes.ts';
import { serve, sendSse } from './http-fixture.ts';

const call = (id: string, title: string) => ({
  type: 'function_call', id: `fc_${id}`, call_id: id,
  name: 'tasks__create', arguments: JSON.stringify({ title }),
});
const completed = (output: unknown[]) => ({ type: 'response.completed', response: {
  id: 'resp', status: 'completed', output, usage: { input_tokens: 2, output_tokens: 1 },
} });
const outputs = (input: any[]) => input.filter((item) => item.type === 'function_call_output')
  .map(({ call_id, output }) => ({ call_id, output }));

for (const errorFirst of [true, false]) {
  test(`openai: explicit tool error is corrected once, with sibling ${errorFirst ? 'after' : 'before'} it`, { timeout: 10_000 }, async (t) => {
    const errorText = 'Title must not be blank. Supply a non-empty title.';
    const initial = [call('rejected', ''), call('sibling', 'independent')];
    if (!errorFirst) initial.reverse();
    const server = await serve((req, res, index) => {
      if (index === 0) return sendSse(res, [completed(initial)]);
      if (index === 1) {
        // The scripted model only corrects the call if it actually sees the error,
        // correlated to the rejected call rather than its successful sibling.
        const results = outputs(req.body.input);
        const canCorrect = results.some((item) => item.call_id === 'rejected' && item.output === `ERROR: ${errorText}`)
          && results.some((item) => item.call_id === 'sibling' && item.output === 'created independent');
        return sendSse(res, [completed(canCorrect ? [call('corrected', 'fixed')] : [])]);
      }
      sendSse(res, [completed([])]);
    });
    t.after(() => server.close());
    const attempts: Array<{ name: string; args: unknown; callId: string }> = [];
    const { input, events } = turnInput({
      account: account({ provider: 'openai', auth: 'api', baseUrl: `${server.url}/v1` }),
      callTool: async (name: string, args: { title: string }, callId: string): Promise<ToolOutput> => {
        attempts.push({ name, args, callId });
        // A returned domain error, not a thrown exception or malformed argument JSON.
        return args.title === ''
          ? { isError: true, content: [{ type: 'text', text: errorText }] }
          : { content: [{ type: 'text', text: `created ${args.title}` }] };
      },
    });
    const engine = new OpenAiEngine({ apiKey: async () => 'dummy-eval-key' });
    const result = await engine.run(input);
    const firstIds = errorFirst ? ['rejected', 'sibling'] : ['sibling', 'rejected'];
    const expectedAttempts = [
      { name: 'tasks.create', args: { title: '' }, callId: 'rejected' },
      { name: 'tasks.create', args: { title: 'independent' }, callId: 'sibling' },
    ];
    if (!errorFirst) expectedAttempts.reverse();
    expectedAttempts.push({ name: 'tasks.create', args: { title: 'fixed' }, callId: 'corrected' });
    assert.deepEqual(attempts, expectedAttempts, 'no implicit retries, replayed siblings or duplicate correction');
    assert.equal(result.stop, 'done');
    assert.equal(server.requests.length, 3);
    const expectedOutputs = firstIds.map((id) => ({ call_id: id, output: id === 'rejected' ? `ERROR: ${errorText}` : 'created independent' }));
    assert.deepEqual(outputs(server.requests[1].body.input), expectedOutputs);
    assert.deepEqual(outputs(server.requests[2].body.input), [
      ...expectedOutputs, { call_id: 'corrected', output: 'created fixed' },
    ], 'each tool result survives exactly once with its own call_id');
    assert.deepEqual(events.filter((e: any) => e.type === 'tool_start').map((e: any) => e.callId), [...firstIds, 'corrected']);
    assert.deepEqual(events.filter((e: any) => e.type === 'tool_end').map((e: any) => ({ callId: e.callId, ok: e.ok })),
      [...firstIds.map((id) => ({ callId: id, ok: id !== 'rejected' })), { callId: 'corrected', ok: true }]);
    assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 3 });
  });
}
