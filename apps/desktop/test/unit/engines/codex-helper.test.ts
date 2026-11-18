// Codex helper turns (audit 23.10.): a runtime helper turn – no tools, no MCP hub, no session (decision
// fallback, verifier, compaction, widget fills over decision/engine-runner.ts) – runs on an ephemeral
// thread (`thread/start` ephemeral: true, so nothing lands in the account's Codex history, like Claude
// Code's --no-session-persistence), returns no session and is unloaded after the turn (thread/unsubscribe).
// An agent turn (tools offered) keeps its persistent, resumable thread.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexEngine } from '../../../src/runtime/engines/codex/engine.ts';
import { HELPER_REQUESTS } from '../../../src/runtime/engines/codex/turn.ts';
import { fakeSpawn, fakeFinder, testSupervisor, turnInput, tick } from './fakes.ts';

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i++) await tick();
}

/** A scripted app-server whose turns answer "ok" and complete. */
function appServer() {
  const requests: any[] = [];
  let threads = 0;
  const { spawn } = fakeSpawn(({ child }) => {
    child.onLine = (msg) => {
      if (!msg.method) return;
      requests.push(msg);
      switch (msg.method) {
        case 'initialize': child.send({ id: msg.id, result: { userAgent: 'fake' } }); break;
        case 'thread/start': child.send({ id: msg.id, result: { thread: { id: `thr_${++threads}` } } }); break;
        case 'thread/unsubscribe': child.send({ id: msg.id, result: { status: 'unsubscribed' } }); break;
        case 'turn/start': {
          const threadId = msg.params.threadId;
          child.send({ id: msg.id, result: { turn: { id: 'turn_1', status: 'inProgress' } } });
          child.send({ method: 'item/completed', params: { threadId, turnId: 'turn_1', item: { id: 'm1', type: 'agentMessage', text: '{"ok":true}' } } });
          child.send({ method: 'turn/completed', params: { threadId, turn: { id: 'turn_1', status: 'completed' } } });
          break;
        }
        default: if (msg.id !== undefined) child.send({ id: msg.id, error: { code: -32601, message: 'nope' } });
      }
    };
  });
  return { spawn, requests };
}

test('codex helper turn: ephemeral thread, no session, unloaded afterwards; an agent turn keeps its thread', async () => {
  const fake = appServer();
  const engine = new CodexEngine({ supervisor: testSupervisor(fake.spawn), finder: fakeFinder({ codex: '/bin/codex' }), cwd: '/tmp', version: '0.2.0' });

  const helper = await engine.run(turnInput({ runId: 'run_h', agentId: 'system', tools: [], outputSchema: { type: 'object' } }).input);
  assert.equal(helper.stop, 'done');
  assert.deepEqual(helper.structured, { ok: true });
  assert.equal(helper.session, undefined, 'a helper turn is never resumed');
  const helperStart = fake.requests.find((r) => r.method === 'thread/start');
  assert.equal(helperStart.params.ephemeral, true, 'not written into the Codex history');
  await until(() => fake.requests.some((r) => r.method === 'thread/unsubscribe'));
  assert.deepEqual(fake.requests.find((r) => r.method === 'thread/unsubscribe').params, { threadId: 'thr_1' });

  const agent = await engine.run(turnInput({ runId: 'run_a' }).input);
  assert.deepEqual(agent.session && { ref: agent.session.ref, generation: agent.session.generation }, { ref: 'thr_2', generation: 1 });
  assert.equal(typeof agent.session?.turn, 'string', 'B-049 F7: an agent turn records its native turn id');
  const agentStart = fake.requests.filter((r) => r.method === 'thread/start')[1];
  assert.equal(agentStart.params.ephemeral, undefined, 'an agent thread stays persistent and resumable');
  assert.equal(fake.requests.filter((r) => r.method === 'thread/unsubscribe').length, 1, 'the agent thread stays loaded');
  await engine.dispose();
});

test('codex kept helper thread (a call voice, KI-Runde 17.11.2026): the lean ephemeral thread stays loaded for the next line, which runs on it without a resume, and unload lets it go', async () => {
  const fake = appServer();
  const engine = new CodexEngine({ supervisor: testSupervisor(fake.spawn), finder: fakeFinder({ codex: '/bin/codex' }), cwd: '/tmp', version: '0.2.0' });
  const line = (patch: Record<string, unknown> = {}) => turnInput({ agentId: 'system', tools: [], keep: true, ...patch }).input;
  const first = await engine.run(line({ runId: 'run_1' }));
  assert.equal(first.stop, 'done');
  assert.equal(first.session?.ref, 'thr_1', 'the kept thread is the session of the call');
  assert.equal(fake.requests.find((r) => r.method === 'thread/start').params.ephemeral, true, 'still nothing in the Codex history');
  const second = await engine.run(line({ runId: 'run_2', session: { ref: 'thr_1', generation: 1 } }));
  assert.equal(second.stop, 'done');
  assert.deepEqual(fake.requests.filter((r) => r.method === 'turn/start').map((r) => r.params.threadId), ['thr_1', 'thr_1'], 'both lines on the one thread');
  assert.equal(fake.requests.filter((r) => r.method === 'thread/start' || r.method === 'thread/resume').length, 1, 'no second thread, no resume');
  assert.equal(fake.requests.filter((r) => r.method === 'thread/unsubscribe').length, 0, 'it stays loaded while the call runs');
  await engine.unload!(turnInput().input.account, 'thr_1');
  await until(() => fake.requests.some((r) => r.method === 'thread/unsubscribe'));
  assert.deepEqual(fake.requests.find((r) => r.method === 'thread/unsubscribe').params, { threadId: 'thr_1' }, 'the call ended: the thread is let go');
  await engine.dispose();
});

test('codex kept helper thread opened at the call\'s start (real run 18.11.): keepOpen starts the lean thread with the voice\'s stable part and no turn, and the first line runs on it', async () => {
  const fake = appServer();
  const engine = new CodexEngine({ supervisor: testSupervisor(fake.spawn), finder: fakeFinder({ codex: '/bin/codex' }), cwd: '/tmp', version: '0.2.0' });
  const base = turnInput({ agentId: 'system', tools: [], keep: true }).input;
  const opened = await engine.keepOpen!({ account: base.account, model: base.model, effort: 'low', system: { stable: 'I am the live voice.', volatile: '' }, cwd: base.cwd });
  assert.deepEqual(opened, { ref: 'thr_1', generation: 1 });
  const start = fake.requests.find((r) => r.method === 'thread/start');
  assert.equal(start.params.ephemeral, true, 'nothing in the Codex history');
  assert.equal(start.params.baseInstructions, 'I am the live voice.', 'the stable part is the thread\'s instructions');
  assert.deepEqual(start.params.environments, [], 'a helper thread has no environment');
  assert.equal(fake.requests.filter((r) => r.method === 'turn/start').length, 0, 'no model call before the first line');
  const first = await engine.run({ ...base, runId: 'run_1', session: opened });
  assert.equal(first.stop, 'done');
  assert.equal(first.session?.ref, 'thr_1');
  assert.deepEqual(fake.requests.filter((r) => r.method === 'turn/start').map((r) => r.params.threadId), ['thr_1'], 'the first line runs on the opened thread');
  assert.equal(fake.requests.filter((r) => r.method === 'thread/start' || r.method === 'thread/resume').length, 1, 'no second thread, no resume');
  await engine.unload!(base.account, 'thr_1');
  await until(() => fake.requests.some((r) => r.method === 'thread/unsubscribe'));
  await engine.dispose();
});

test('codex helper turn whose model wrote its whole answer as a commentary message (real run 18.11., a call voice): that message is its answer; an agent turn still leaves commentary out', async () => {
  const requests: any[] = [];
  const { spawn } = fakeSpawn(({ child }) => {
    child.onLine = (msg) => {
      if (!msg.method) return;
      requests.push(msg);
      switch (msg.method) {
        case 'initialize': child.send({ id: msg.id, result: { userAgent: 'fake' } }); break;
        case 'thread/start': child.send({ id: msg.id, result: { thread: { id: `thr_${requests.filter((r) => r.method === 'thread/start').length}` } } }); break;
        case 'thread/unsubscribe': child.send({ id: msg.id, result: { status: 'unsubscribed' } }); break;
        case 'turn/start': {
          const threadId = msg.params.threadId;
          const item = { id: 'm1', type: 'agentMessage', phase: 'commentary', text: 'Ich schau nach. <main now>Webers letzte Mail lesen</main>' };
          child.send({ id: msg.id, result: { turn: { id: 'turn_1', status: 'inProgress' } } });
          child.send({ method: 'item/started', params: { threadId, turnId: 'turn_1', item: { ...item, text: '' } } });
          child.send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn_1', itemId: 'm1', delta: item.text } });
          child.send({ method: 'item/completed', params: { threadId, turnId: 'turn_1', item } });
          child.send({ method: 'turn/completed', params: { threadId, turn: { id: 'turn_1', status: 'completed' } } });
          break;
        }
        default: if (msg.id !== undefined) child.send({ id: msg.id, error: { code: -32601, message: 'nope' } });
      }
    };
  });
  const engine = new CodexEngine({ supervisor: testSupervisor(spawn), finder: fakeFinder({ codex: '/bin/codex' }), cwd: '/tmp', version: '0.2.0' });
  const voice = await engine.run(turnInput({ runId: 'run_v', agentId: 'system', tools: [], keep: true }).input);
  assert.equal(voice.stop, 'done');
  assert.equal(voice.text, 'Ich schau nach. <main now>Webers letzte Mail lesen</main>', 'a helper turn has no tools: its commentary is what it answers');
  const agent = await engine.run(turnInput({ runId: 'run_a' }).input);
  assert.equal(agent.text, '', 'an agent turn\'s commentary stays a commentary');
  await engine.dispose();
});

test('codex helper turn: a model that goes on request after request is cut, an agent turn is not', async () => {
  const requests: any[] = [];
  const { spawn } = fakeSpawn(({ child }) => {
    child.onLine = (msg) => {
      if (!msg.method) return;
      requests.push(msg);
      switch (msg.method) {
        case 'initialize': child.send({ id: msg.id, result: { userAgent: 'fake' } }); break;
        case 'thread/start': child.send({ id: msg.id, result: { thread: { id: 'thr_1' } } }); break;
        case 'thread/unsubscribe': child.send({ id: msg.id, result: { status: 'unsubscribed' } }); break;
        case 'turn/start': {
          const threadId = msg.params.threadId;
          child.send({ id: msg.id, result: { turn: { id: 'turn_1', status: 'inProgress' } } });
          for (let n = 0; n < HELPER_REQUESTS + 2; n++) child.send({ method: 'thread/tokenUsage/updated', params: { threadId, turnId: 'turn_1', tokenUsage: { last: { inputTokens: 7000, outputTokens: 14, totalTokens: 7014 } } } });
          if (!msg.params.outputSchema) child.send({ method: 'turn/completed', params: { threadId, turn: { id: 'turn_1', status: 'completed' } } });
          break;
        }
        case 'turn/interrupt':
          child.send({ id: msg.id, result: {} });
          child.send({ method: 'turn/completed', params: { threadId: msg.params.threadId, turn: { id: 'turn_1', status: 'interrupted' } } });
          break;
        default: if (msg.id !== undefined) child.send({ id: msg.id, error: { code: -32601, message: 'nope' } });
      }
    };
  });
  const engine = new CodexEngine({ supervisor: testSupervisor(spawn), finder: fakeFinder({ codex: '/bin/codex' }), cwd: '/tmp', version: '0.2.0' });
  const helper = await engine.run(turnInput({ runId: 'run_h', agentId: 'system', tools: [], outputSchema: { type: 'object' } }).input);
  assert.equal(helper.stop, 'interrupted');
  assert.equal(requests.filter((r) => r.method === 'turn/interrupt').length, 1);
  const agent = await engine.run(turnInput({ runId: 'run_a' }).input);
  assert.equal(agent.stop, 'done');
  assert.equal(requests.filter((r) => r.method === 'turn/interrupt').length, 1, 'an agent turn makes as many requests as its work needs');
  await engine.dispose();
});
