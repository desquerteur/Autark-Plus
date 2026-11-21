// KI-Runde 17.11.2026 – a native compaction is an event with the engine's own figures, so the executor can journal it
// (agents/turn-attempt.ts: run note {compacted: 'engine', before, after, ms}) and fold the agent's record at that turn's end:
// Claude Code's main-thread system/compact_boundary with its compact_metadata (the stream's spelling and the transcript's; a
// subagent's does not count), Codex's contextCompaction item (the context before it, how long it took) and its deprecated
// thread/compacted notification – once per compaction.
// Owns: these assertions only. Never starts a real binary (scripted app-server over fakes.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexEngine } from '../../../src/runtime/engines/codex/engine.ts';
import { ClaudeStreamParser } from '../../../src/runtime/engines/claude/stream.ts';
import type { EngineEvent } from '../../../src/runtime/engines/types.ts';
import { fakeFinder, fakeSpawn, testSupervisor, turnInput } from './fakes.ts';

test('claude: a main-thread compact_boundary is a compacted event with the CLI\'s own figures; a subagent\'s is none', () => {
  const events: EngineEvent[] = [];
  const parser = new ClaudeStreamParser((event) => events.push(event), () => 0);
  parser.push({ type: 'system', subtype: 'compact_boundary', parent_tool_use_id: 'toolu_1', compact_metadata: { trigger: 'auto', pre_tokens: 90_000 } });
  assert.deepEqual(events, [], 'a subagent compacted its own history, not the session');
  parser.push({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 971_204, post_tokens: 48_310, duration_ms: 84_000 } });
  assert.deepEqual(events, [{ type: 'compacted', before: 971_204, after: 48_310, ms: 84_000 }]);
  assert.equal(parser.state.compacted, true);
  // the spelling Claude Code writes into its transcript (measured 17.11.2026: preTokens 600,033 → postTokens 148,231 in 79,957 ms)
  parser.push({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 600_033, postTokens: 148_231, durationMs: 79_957 } });
  assert.deepEqual(events[1], { type: 'compacted', before: 600_033, after: 148_231, ms: 79_957 });
  parser.push({ type: 'system', subtype: 'compact_boundary' });
  assert.deepEqual(events[2], { type: 'compacted' }, 'no figures reported: none invented');
});

type Compaction = 'item' | 'notification' | 'both' | undefined;

function codexServer(compact: { next: Compaction }) {
  let threads = 0;
  let turns = 0;
  return fakeSpawn(({ child }) => {
    child.onLine = (msg) => {
      if (!msg.method || msg.id === undefined) return;
      switch (msg.method) {
        case 'initialize': child.send({ id: msg.id, result: { userAgent: 'workforce/0.164.0 (Windows)' } }); break;
        case 'thread/start': child.send({ id: msg.id, result: { thread: { id: `thr_${++threads}` } } }); break;
        case 'turn/start': {
          const id = `turn_${++turns}`;
          const threadId = msg.params.threadId;
          child.send({ id: msg.id, result: { turn: { id, status: 'inProgress' } } });
          child.send({ method: 'thread/tokenUsage/updated', params: { threadId, turnId: id, tokenUsage: { last: { inputTokens: 371_000, outputTokens: 10, totalTokens: 371_010 }, modelContextWindow: 475_000 } } });
          if (compact.next === 'item' || compact.next === 'both') {
            child.send({ method: 'item/started', params: { threadId, turnId: id, item: { id: `c${turns}`, type: 'contextCompaction' } } });
            child.send({ method: 'item/completed', params: { threadId, turnId: id, item: { id: `c${turns}`, type: 'contextCompaction' } } });
          }
          if (compact.next === 'notification' || compact.next === 'both') child.send({ method: 'thread/compacted', params: { threadId, turnId: id } });
          child.send({ method: 'item/completed', params: { threadId, turnId: id, item: { id: `m${turns}`, type: 'agentMessage', text: 'ok' } } });
          child.send({ method: 'turn/completed', params: { threadId, turn: { id, status: 'completed' } } });
          break;
        }
        default: child.send({ id: msg.id, error: { code: -32601, message: 'nope' } });
      }
    };
  });
}

test('codex: a compaction is one compacted event with the context before it – as an item, as the deprecated notification, or as both', async () => {
  const compact: { next: Compaction } = { next: undefined };
  const { spawn } = codexServer(compact);
  const e = new CodexEngine({ supervisor: testSupervisor(spawn), finder: fakeFinder({ codex: '/bin/codex' }), cwd: '/engine-cwd', version: '0.2.0', realpath: async (dir) => dir });
  const compactions = async (runId: string, session?: { ref: string; generation: number }) => {
    const turn = turnInput({ runId, ...(session ? { session } : {}) });
    const result = await e.run(turn.input);
    return { result, events: (turn.events as EngineEvent[]).filter((event) => event.type === 'compacted') };
  };
  const plain = await compactions('run_1');
  assert.deepEqual(plain.events, [], 'a plain turn: none');
  const session = { ref: 'thr_1', generation: 1 };
  compact.next = 'item';
  const item = await compactions('run_2', session);
  assert.equal(item.events.length, 1);
  assert.equal((item.events[0] as { before?: number }).before, 371_010, 'the engine\'s own count before it');
  assert.ok(((item.events[0] as { ms?: number }).ms ?? -1) >= 0, 'how long it took');
  assert.equal(item.result.compacted, true);
  compact.next = 'notification';
  const note = await compactions('run_3', session);
  assert.deepEqual(note.events, [{ type: 'compacted', before: 371_010 }]);
  compact.next = 'both';
  assert.equal((await compactions('run_4', session)).events.length, 1, 'both forms of one compaction: one event');
  await e.dispose();
});
