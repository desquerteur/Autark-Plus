// B-080 (live 07.–09.11.2026: 11 "rejected: blocked by policy" – an agent's own Remove-Item -Force, Stop-Process, Start-Process
// of a URL): an agent turn runs with approvalPolicy 'on-request', so Codex's command guard asks the app instead of refusing,
// and the turn answers at once – accepted for the session in a full-access turn, declined in a read turn. No person is asked.
// Owns: these assertions only. Never: a real Codex (scripted app-server over fakes.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexEngine } from '../../../src/runtime/engines/codex/engine.ts';
import { fakeFinder, fakeSpawn, testSupervisor, turnInput } from './fakes.ts';

/** An app-server whose turn sends Codex's two command approval requests and ends once both are answered. */
function appServer() {
  const requests: any[] = [];
  const replies = new Map<number, any>();
  const { spawn } = fakeSpawn(({ child }) => {
    child.onLine = (msg) => {
      if (msg.id !== undefined && !msg.method) {
        replies.set(msg.id, msg.result);
        if (replies.size === 2) child.send({ method: 'turn/completed', params: { threadId: 'thr_1', turn: { id: 'turn_1', status: 'completed' } } });
        return;
      }
      requests.push(msg);
      if (msg.method === 'initialize') child.send({ id: msg.id, result: { userAgent: 'fake' } });
      else if (msg.method === 'thread/start') child.send({ id: msg.id, result: { thread: { id: 'thr_1' } } });
      else if (msg.method === 'turn/start') {
        child.send({ id: msg.id, result: { turn: { id: 'turn_1', status: 'inProgress' } } });
        const params = { threadId: 'thr_1', turnId: 'turn_1', itemId: 'c1', command: 'Remove-Item -LiteralPath C:\\tmp\\old.zip -Force' };
        child.send({ id: 901, method: 'item/commandExecution/requestApproval', params });
        child.send({ id: 902, method: 'execCommandApproval', params: { conversationId: 'thr_1', callId: 'c1', command: ['powershell', '-Command', params.command], cwd: '/work' } });
      } else if (msg.id !== undefined) child.send({ id: msg.id, error: { code: -32601, message: 'nope' } });
    };
  });
  return { spawn, requests, replies };
}

const engine = (spawn: any) => new CodexEngine({ supervisor: testSupervisor(spawn), finder: fakeFinder({ codex: '/bin/codex' }), cwd: '/tmp', version: '0.2.0', realpath: async (dir) => dir });

test('a full-access agent turn runs on-request and accepts Codex\'s command approvals for the session at once', async () => {
  const fake = appServer();
  const e = engine(fake.spawn);
  const result = await e.run(turnInput().input);
  await e.dispose();
  assert.equal(result.stop, 'done', 'the turn went on without anybody asked');
  assert.equal(fake.requests.find((r) => r.method === 'turn/start').params.approvalPolicy, 'on-request');
  assert.deepEqual(fake.replies.get(901), { decision: 'acceptForSession' });
  assert.deepEqual(fake.replies.get(902), { decision: 'approved_for_session' });
});

test('a read turn (readOnly) runs never and declines the same requests', async () => {
  const fake = appServer();
  const e = engine(fake.spawn);
  const result = await e.run({ ...turnInput().input, readOnly: true });
  await e.dispose();
  assert.equal(result.stop, 'done');
  assert.equal(fake.requests.find((r) => r.method === 'turn/start').params.approvalPolicy, 'never');
  assert.deepEqual(fake.replies.get(901), { decision: 'decline' });
  assert.deepEqual(fake.replies.get(902), { decision: 'denied' });
});
