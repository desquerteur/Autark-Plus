// Package C (KI-Runde 17.11.2026): the Claude Code stream parser counts each main-thread message_start as one model call of
// the turn and carries the count on every 'usage' event; a subagent's message_start is not the turn's. The cost a result
// reports is the session's running total: the latest one stands.
// Owns: these assertions only. Never: a real Claude Code binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeStreamParser } from '../../../src/runtime/engines/claude/stream.ts';
import type { EngineEvent } from '../../../src/runtime/engines/types.ts';

const start = (id: string, parent?: string) => ({
  type: 'stream_event', ...(parent ? { parent_tool_use_id: parent } : {}),
  event: { type: 'message_start', message: { id, usage: { input_tokens: 3, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 } } },
});
const result = (cost: number) => ({
  type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: cost,
  usage: { input_tokens: 6, cache_read_input_tokens: 1_800, cache_creation_input_tokens: 200, output_tokens: 40 },
});

test('claude: every main-thread message_start is one model call, carried on the usage event', () => {
  const events: EngineEvent[] = [];
  const parser = new ClaudeStreamParser((event) => events.push(event), () => 0);
  parser.push(start('msg_1'));
  parser.push(start('msg_sub', 'toolu_1')); // a subagent's call
  parser.push(start('msg_2'));
  parser.push(result(12.5));
  assert.equal(parser.state.modelCalls, 2);
  const usage = events.find((event) => event.type === 'usage');
  assert.ok(usage && usage.type === 'usage');
  assert.equal(usage.modelCalls, 2);
  assert.equal(usage.costUsd, 12.5, 'the session\'s running total, as reported');
  assert.equal(usage.cacheWriteTokens, 200);
});

test('claude: with two results the latest running total stands, also when it is lower', () => {
  const parser = new ClaudeStreamParser(() => {}, () => 0);
  parser.push(result(2));
  parser.push(result(1.5));
  assert.equal(parser.state.usage?.costUsd, 1.5, 'the old code added the two (3.5)');
});
