// Scripted providers: the same invalid-argument boundary on Chat Completions and Messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompatibleEngine } from '../../../src/runtime/engines/http/compatible.ts';
import { AnthropicEngine } from '../../../src/runtime/engines/http/anthropic.ts';
import { account, turnInput } from './fakes.ts';
import { serve, sendSse } from './http-fixture.ts';

function response(kind: string, id?: string, args?: string): unknown[] {
  if (kind === 'compatible') return [{ choices: [{ index: 0, finish_reason: id ? 'tool_calls' : 'stop', delta: id
    ? { tool_calls: [{ index: 0, id, type: 'function', function: { name: 'tasks__create', arguments: args } }] }
    : { content: 'done' } }] }, '[DONE]'];
  return [
    { type: 'message_start', message: { usage: { input_tokens: 1 } } },
    ...(id ? [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'tasks__create', input: {} } },
      // No delta is a legitimate empty input on Messages; a present invalid delta is not.
      ...(args === undefined ? [] : [{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } }]),
      { type: 'content_block_stop', index: 0 },
    ] : []),
    { type: 'message_delta', delta: { stop_reason: id ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
}

for (const kind of ['compatible', 'anthropic']) {
  for (const args of ['{"title":', '', 'null', '[]', '42', 'false', '"text"', ...(kind === 'compatible' ? [undefined] : [])]) {
    test(`${kind}: invalid arguments ${JSON.stringify(args)} are returned as error, then corrected once`, async (t) => {
      const server = await serve((_req, res, index) => sendSse(res, response(kind,
        index === 0 ? 'bad' : index === 1 ? 'corrected' : undefined,
        index === 0 ? args : '{"title":"X"}')));
      t.after(() => server.close());
      const deps = { apiKey: async () => 'dummy-eval-key' };
      const engine = kind === 'compatible' ? new CompatibleEngine(deps) : new AnthropicEngine(deps);
      const { input, toolCalls } = turnInput({ account: account({ provider: kind, auth: 'api', baseUrl: `${server.url}/v1` }) });
      const result = await engine.run(input);
      assert.deepEqual(toolCalls, [{ name: 'tasks.create', args: { title: 'X' }, callId: 'corrected' }]);
      assert.equal(result.stop, 'done');
      assert.equal(server.requests.length, 3);
      const messages = server.requests[1].body.messages;
      if (kind === 'compatible') {
        const error = messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'bad');
        assert.match(error.content, /^ERROR: .*JSON object/);
        assert.equal(messages.find((m: any) => m.tool_calls)?.tool_calls[0].function.arguments, args ?? '', 'history retains the actual argument string');
      } else {
        const error = messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).find((p: any) => p.type === 'tool_result' && p.tool_use_id === 'bad');
        assert.equal(error.is_error, true);
        assert.match(error.content[0].text, /JSON object/);
        const use = messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).find((p: any) => p.type === 'tool_use' && p.id === 'bad');
        assert.deepEqual(use.input, {}, 'Messages history has an object placeholder, not malformed input');
      }
    });
  }
  for (const args of ['{}', undefined]) {
    // Chat Completions requires an arguments string, Messages may send just the initial input {}.
    if (kind === 'compatible' && args === undefined) continue;
    test(`${kind}: genuine empty object (${args ?? 'initial input'}) still executes`, async (t) => {
      const server = await serve((_req, res, index) => sendSse(res, response(kind, index === 0 ? 'empty' : undefined, args)));
      t.after(() => server.close());
      const deps = { apiKey: async () => 'dummy-eval-key' };
      const engine = kind === 'compatible' ? new CompatibleEngine(deps) : new AnthropicEngine(deps);
      const { input, toolCalls } = turnInput({ account: account({ provider: kind, auth: 'api', baseUrl: `${server.url}/v1` }) });
      assert.equal((await engine.run(input)).stop, 'done');
      assert.deepEqual(toolCalls, [{ name: 'tasks.create', args: {}, callId: 'empty' }]);
    });
  }
}
