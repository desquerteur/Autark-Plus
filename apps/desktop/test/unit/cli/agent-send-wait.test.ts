// B-085 T7 review: `wf send --wait` run by an agent (its messages.send answers with the agent as author) waits for
// someone else's reply – the agent's own later lines in that chat (its turn answering there) are no reply.
// Owns: these assertions only. Never: starts the real runtime or reads the person's app data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { message } from './fixtures.ts';
import { fakeRuntime, launch, manager, wf } from './fake-runtime.ts';

const writer = 'ag_writer0001';

test('send --wait as an agent: its own later line is skipped, the next agent\'s reply is printed', async (t) => {
  const topic = `chat:${launch.id}`;
  const runtime = await fakeRuntime({
    'messages.send': (_params, fake) => {
      setTimeout(() => {
        fake.push('message.created', message({ id: 'msg_own', seq: 6, conversationId: launch.id, authorId: manager.id, authorKind: 'agent', body: 'my own answer' }), topic);
        setTimeout(() => fake.push('message.created', message({ id: 'msg_other', seq: 7, conversationId: launch.id, authorId: writer, authorKind: 'agent', body: 'the reply' }), topic), 30);
      }, 30);
      return message({ id: 'msg_sent', seq: 5, conversationId: launch.id, authorId: manager.id, authorKind: 'agent', body: 'hi' });
    },
  });
  t.after(() => runtime.stop());
  const result = await wf(['send', 'Launch', 'hi', '--wait', '--json'], { runtime });
  assert.equal(result.code, 0, result.err);
  assert.equal(JSON.parse(result.out).reply.id, 'msg_other');
});

test('send --wait as the person: the first agent reply counts, whoever wrote it', async (t) => {
  const topic = `chat:${launch.id}`;
  const runtime = await fakeRuntime({
    'messages.send': (_params, fake) => {
      setTimeout(() => fake.push('message.created', message({ id: 'msg_reply', seq: 6, conversationId: launch.id, authorId: manager.id, authorKind: 'agent', body: 'Echo: hi' }), topic), 30);
      return message({ id: 'msg_sent', seq: 5, conversationId: launch.id, body: 'hi' });
    },
  });
  t.after(() => runtime.stop());
  const result = await wf(['send', 'Launch', 'hi', '--wait', '--json'], { runtime });
  assert.equal(result.code, 0, result.err);
  assert.equal(JSON.parse(result.out).reply.id, 'msg_reply');
});
