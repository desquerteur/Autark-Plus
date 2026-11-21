// Owner 18.11.2026 ("dass wirklich die Teammitglieder da schön arbeiten können … viele Berechtigungen"): a person
// searches the chats they read and stops the agents' replies there (people/rpc-chats.ts) – never a chat they do not
// read. (Their default spaces: visibility.test.ts.)
// Owns: these assertions. Never: a real runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleRig } from './rig.ts';

test('a person searches only the chats they read and stops replies there', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const anna = await r.join('Anna Berg');
  const shared = r.chats.create({ agentIds: ['ag_research'], people: [anna.person.id], createdBy: 'human', title: 'Logo' });
  const own = r.chats.create({ agentIds: ['ag_secret'], createdBy: 'human', title: 'Private' });
  r.chats.send({ conversationId: shared.id, body: 'the pineapple logo', authorId: 'human', authorKind: 'human' });
  r.chats.send({ conversationId: own.id, body: 'my pineapple secret', authorId: 'human', authorKind: 'human' });
  const found = await anna.client.call<Array<{ conversationTitle: string }>>('chats.search', { text: 'pineapple' });
  assert.deepEqual(found.map((hit) => hit.conversationTitle), ['Logo']);
  await assert.rejects(anna.client.call('chats.search', { text: 'pineapple', conversationId: own.id }), /Chat not found/);
  assert.deepEqual(await anna.client.call('messages.stop', { conversationId: shared.id }), { ok: true });
  await assert.rejects(anna.client.call('messages.stop', { conversationId: own.id }), /Chat not found/);
});
