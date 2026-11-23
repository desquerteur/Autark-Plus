// Decision 10 (FIXES-2 A3): while the agent's main turn waits in agents.split {wait: true}, a person's line, an important
// line and a call voice's 'now' hand-over end that run's wait (dispatch-incoming.ts endWait → splits.endWait), so the call answers
// with what is there and the turn reads the line at its next step; a 'next' hand-over and a colleague's line leave it.
// Owns: these assertions only. Never: real engines or the real split service (splits/wait.test.ts covers its side).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import type { Engine } from '../../../src/runtime/engines/types.ts';
import type { SplitService } from '../../../src/runtime/contracts.ts';
import { flush, setup } from './fakes.ts';

function team() {
  const h = setup();
  h.org.add(agent('ag_tom', 'Tom'));
  h.org.add(agent('ag_lea', 'Lea'));
  const ended: string[] = [];
  h.services.splits = {
    endWait: (runId: string) => { ended.push(runId); },
    afterParentTurn: () => {}, turnFor: () => undefined, inputFor: () => [], get: () => undefined, onSplitRunEnd: () => {}, stop: () => 0,
    pendingResults: () => undefined, activeOn: () => [], pump: () => {},
  } as unknown as SplitService;
  const a = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  const b = h.chats.create({ agentIds: ['ag_tom', 'ag_lea'], createdBy: 'human' });
  h.dispatcher.start();
  return { h, a, b, ended };
}

function steerable(call: { request: { control: { engine?: Engine } } }): string[] {
  const texts: string[] = [];
  call.request.control.engine = { id: 'claude', steer: async (_runId: string, text: string) => { texts.push(text); return true; } } as unknown as Engine;
  return texts;
}

test('a person\'s line, an important line and a \'now\' hand-over end the waiting call of the running turn', async () => {
  const { h, a, b, ended } = team();
  h.chats.send({ conversationId: a.id, body: 'find the material', authorId: 'human' });
  await flush();
  const running = h.executor.last();
  const runId = running.request.runId;
  steerable(running);

  assert.equal(await h.dispatcher.relay('ag_tom', a.id, 'later', 'next'), true);
  assert.deepEqual(ended, [], 'a \'next\' hand-over waits for the call');

  h.chats.send({ conversationId: b.id, body: 'Lea here, a note', authorId: 'ag_lea' });
  await flush();
  assert.deepEqual(ended, [], 'a colleague\'s line waits for the call');

  h.chats.send({ conversationId: a.id, body: 'also check E:', authorId: 'human' });
  await flush();
  assert.equal(ended.at(-1), runId, 'a person\'s line');

  const before = ended.length;
  h.chats.send({ conversationId: b.id, body: 'Stop, wrong drive', authorId: 'human', priority: 'important' });
  await flush();
  assert.ok(ended.length > before && ended.at(-1) === runId, 'an important line');

  const now = ended.length;
  assert.equal(await h.dispatcher.relay('ag_tom', a.id, '[Live call] Stop the deploy.', 'now'), true);
  assert.equal(ended.length, now + 1, 'a call voice\'s \'now\'');
  assert.equal(running.request.signal.aborted, false, 'nothing is cut');
  running.finish();
  await flush();
});

test('a colleague\'s line in the group chat whose person\'s line started the turn leaves the wait (review 3)', async () => {
  const { h, b, ended } = team();
  h.chats.send({ conversationId: b.id, body: '@Tom find the material', authorId: 'human', mentions: ['ag_tom'] } as never);
  await flush();
  const running = h.executor.last();
  assert.equal(running.request.conversationId, b.id);
  running.request.control.lastSeq = h.chats.messages(b.id).at(-1)!.seq; // the turn's input took the line (turn.ts bindTurn)
  steerable(running);
  h.chats.send({ conversationId: b.id, body: '@Tom I put the old files in /tmp/x', authorId: 'ag_lea', mentions: ['ag_tom'] } as never);
  await flush();
  assert.deepEqual(ended, [], 'the person\'s line the turn already took is no new line');
  h.chats.send({ conversationId: b.id, body: '@Tom also check E:', authorId: 'human', mentions: ['ag_tom'] } as never);
  await flush();
  assert.equal(ended.at(-1), running.request.runId, 'a new line of the person still ends it');
  running.finish();
  await flush();
});
