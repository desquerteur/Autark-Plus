// Deterministic Responses harness evaluation: invalid JSON must not become a default-argument
// action. A scripted provider corrects the call after reading its error. No real model or tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiEngine } from '../../../src/runtime/engines/http/openai.ts';
import { account, turnInput } from './fakes.ts';
import { serve, sendSse } from './http-fixture.ts';

const completed = (output: unknown[]) => ({ type: 'response.completed', response: {
  id: 'resp', status: 'completed', output, usage: { input_tokens: 2, output_tokens: 1 },
} });
const call = (id: string, args: unknown) => ({
  type: 'function_call', id: `fc_${id}`, call_id: id, name: 'tasks__create', arguments: args,
});

for (const args of ['{"title":', '', 'null', '[]', '"text"', '42', 'false', undefined, null, {}]) {
  test(`openai: rejects non-object arguments ${JSON.stringify(args)} and accepts a corrected call`, async (t) => {
    let recoveredError: any;
    const server = await serve((req, res, index) => {
      if (index === 0) return sendSse(res, [completed([call('bad', args)])]);
      if (index === 1) {
        recoveredError = req.body.input.find((item: any) => item.type === 'function_call_output' && item.call_id === 'bad');
        return sendSse(res, [completed([call('corrected', '{"title":"X"}')])]);
      }
      sendSse(res, [completed([])]);
    });
    t.after(() => server.close());
    const engine = new OpenAiEngine({ apiKey: async () => 'dummy-eval-key' });
    const { input, events, toolCalls } = turnInput({
      account: account({ provider: 'openai', auth: 'api', baseUrl: `${server.url}/v1` }),
    });
    const result = await engine.run(input);
    assert.deepEqual(toolCalls, [{ name: 'tasks.create', args: { title: 'X' }, callId: 'corrected' }],
      'invalid arguments never reach callTool; the corrected action runs exactly once');
    assert.equal(result.stop, 'done');
    assert.equal(server.requests.length, 3, 'one failed call, one correction, one final response');
    assert.match(recoveredError.output, /^ERROR: .*JSON object/);
    assert.deepEqual(events.filter((e: any) => e.type === 'tool_start').map((e: any) => e.callId), ['corrected']);
    const finalInput = server.requests[2].body.input;
    assert.equal(finalInput.filter((item: any) => item.type === 'function_call_output' && item.call_id === 'bad').length, 1);
    assert.equal(finalInput.find((item: any) => item.type === 'function_call_output' && item.call_id === 'corrected').output, 'created {"title":"X"}');
    assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 3 }, 'recovery requests count toward usage');
  });
}

test('openai: a genuine empty object remains a valid no-argument call', async (t) => {
  const server = await serve((_req, res, index) => sendSse(res, [completed(index === 0 ? [call('empty', '{}')] : [])]));
  t.after(() => server.close());
  const engine = new OpenAiEngine({ apiKey: async () => 'dummy-eval-key' });
  const { input, toolCalls } = turnInput({ account: account({ provider: 'openai', auth: 'api', baseUrl: `${server.url}/v1` }) });
  assert.equal((await engine.run(input)).stop, 'done');
  assert.deepEqual(toolCalls, [{ name: 'tasks.create', args: {}, callId: 'empty' }]);
});

test('openai: a malformed call does not suppress a valid sibling or invent execution events', async (t) => {
  const server = await serve((_req, res, index) => sendSse(res, [completed(index === 0
    ? [call('bad', '{'), call('sibling', '{"title":"Y"}')]
    : [])]));
  t.after(() => server.close());
  const engine = new OpenAiEngine({ apiKey: async () => 'dummy-eval-key' });
  const { input, toolCalls, events } = turnInput({ account: account({ provider: 'openai', auth: 'api', baseUrl: `${server.url}/v1` }) });
  assert.equal((await engine.run(input)).stop, 'done');
  assert.deepEqual(toolCalls, [{ name: 'tasks.create', args: { title: 'Y' }, callId: 'sibling' }]);
  assert.deepEqual(events.filter((e: any) => e.type === 'tool_end').map((e: any) => [e.callId, e.ok]), [['sibling', true]]);
  const results = server.requests[1].body.input.filter((item: any) => item.type === 'function_call_output');
  assert.deepEqual(results.map((item: any) => item.call_id), ['bad', 'sibling']);
  assert.match(results[0].output, /^ERROR: .*JSON object/);
  assert.equal(results[1].output, 'created {"title":"Y"}');
});
