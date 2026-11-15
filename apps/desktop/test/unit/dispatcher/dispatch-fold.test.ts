// B-080 (owner 08.11.2026: a new line goes into the running turn "mittendrin", as in Codex and Claude Code): a fold the
// engine refused while its turn could not take it yet is tried again until it lands (dispatch-fold.ts); folds of one chat
// run one after another; a person's line in a group chat reaches every member's running turn wherever it works
// (dispatcher.hear: the group frame, no waiting line, no pick of that chat); an important line from another chat is
// folded into the running turn instead of cutting it.
// Owns: these assertions only. Never: real engines or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { FoldRetries } from '../../../src/runtime/agents/dispatch-fold.ts';
import type { SteerResult } from '../../../src/runtime/agents/dispatch-steer.ts';
import type { Engine } from '../../../src/runtime/engines/types.ts';
import { flush, setup } from './fakes.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a refused fold is tried again while the turn runs, until it lands; a held or finished one is not', async () => {
  const folds = new FoldRetries(5);
  const results: SteerResult[] = ['refused', 'refused', 'all'];
  let tries = 0;
  const first = await folds.fold('tom:a', async () => results[tries++]!, () => true);
  assert.equal(first, 'refused');
  assert.equal(folds.armed('tom:a'), true);
  await wait(40);
  assert.equal(tries, 3, 'tried until the engine took it');
  assert.equal(folds.armed('tom:a'), false);

  let held = 0;
  await folds.fold('tom:b', async () => { held++; return 'held'; }, () => true);
  await wait(20);
  assert.equal(held, 1, 'a held line waits for the next turn: no retry');

  let ended = 0;
  let running = true;
  await folds.fold('tom:c', async () => { ended++; return 'refused'; }, () => running);
  running = false;
  await wait(20);
  assert.equal(ended, 1, 'the turn ended: the queued wake brings the line');
  folds.stop();
});

test('folds of one agent and chat run one after another (two quick lines: no line twice)', async () => {
  const folds = new FoldRetries(5);
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const a = folds.fold('tom:a', async () => { order.push('a start'); await gate; order.push('a end'); return 'all'; }, () => true);
  const b = folds.fold('tom:a', async () => { order.push('b'); return 'all'; }, () => true);
  await wait(5);
  assert.deepEqual(order, ['a start'], 'the second waits for the first');
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ['a start', 'a end', 'b']);
  folds.stop();
});

function team() {
  const h = setup();
  h.org.add(agent('ag_tom', 'Tom'));
  h.org.add(agent('ag_lea', 'Lea'));
  const a = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  const b = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  h.dispatcher.start();
  return { h, a, b };
}

function steerable(call: { request: { control: { engine?: Engine } } }): string[] {
  const texts: string[] = [];
  call.request.control.engine = { steer: async (_runId: string, text: string) => { texts.push(text); return true; } } as unknown as Engine;
  return texts;
}

test('a person\'s line in a group chat reaches a member working elsewhere at its next step – the group frame, no waiting line there', async () => {
  const { h, a } = team();
  h.chats.send({ conversationId: a.id, body: 'build the site', authorId: 'human' });
  await flush();
  const tom = h.executor.last();
  const texts = steerable(tom);
  const group = h.chats.create({ title: 'Kernteam', agentIds: ['ag_lea', 'ag_tom'], createdBy: 'human' });
  h.chats.send({ conversationId: group.id, body: 'Ihr sollt jetzt autonom versenden', authorId: 'human' });
  await flush();
  assert.equal(texts.length, 1, 'Tom hears it now, not at his next turn in the group');
  assert.match(texts[0], /^New lines while I work:\n\[ch_\w+ "Kernteam" · /);
  assert.match(texts[0], /Ihr sollt jetzt autonom versenden$/);
  assert.equal(tom.request.signal.aborted, false, 'his work goes on');
  const waiting = h.chats.messages(group.id, { limit: 50 }).filter((message) => message.kind === 'status' && message.authorId === 'ag_tom');
  assert.equal(waiting.length, 0, 'no "Tom is working on …" line for a line he only hears');
});

test('an important line from another chat goes into the running turn instead of cutting it; that chat runs next', async () => {
  const { h, a, b } = team();
  h.chats.send({ conversationId: b.id, body: 'publish the release notes', authorId: 'human' });
  await flush();
  const running = h.executor.last();
  const texts = steerable(running);
  h.chats.send({ conversationId: a.id, body: 'Call me now', authorId: 'human', priority: 'important' });
  await flush();
  assert.equal(texts.length, 1);
  assert.match(texts[0], /^New lines while I work:[\s\S]*\(important\) Call me now$/);
  assert.doesNotMatch(texts[0], /after this turn/, 'nothing tells it to wait');
  assert.equal(running.request.signal.aborted, false, 'not cut');
  running.finish();
  await flush();
  assert.equal(h.executor.last().request.conversationId, a.id, 'the chat of the important line runs next');
});

test('an important line for a turn not bound to its engine yet is not cut for: it waits for the engine (the fold is tried again)', async () => {
  const { h, a } = team();
  h.chats.send({ conversationId: a.id, body: 'build the site', authorId: 'human' });
  await flush();
  const tom = h.executor.last();
  tom.request.control.engine = undefined; // still before bindTurn: a rebuild or a compaction runs
  h.chats.send({ conversationId: a.id, body: 'Call me now', authorId: 'human', priority: 'important' });
  await flush();
  assert.equal(tom.request.signal.aborted, false, 'the line reaches this turn as soon as its engine runs');
  const texts = steerable(tom); // the engine is bound now
  await wait(2200); // the retry (STEER_RETRY_MS)
  assert.equal(texts.length, 1);
  assert.match(texts[0], /\(important\) Call me now$/);
  tom.finish();
  await flush();
});
