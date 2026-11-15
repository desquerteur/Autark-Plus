// B-083: chats.update takes the person's temperature suggestion per agent (settings.temperatures, agent id → 0..1),
// the composer's temperature row writes it and routing reads it as the chat's suggestion (routing/policies.ts chatChoice).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { OWNER, PHONE, TestClient, rpcFixture } from './s1-helpers.ts';

function setup() {
  const f = rpcFixture();
  f.org.add(agent('ag_ava', 'Ava'));
  return { ...f, owner: new TestClient(f.server, OWNER), phone: new TestClient(f.server, PHONE) };
}

test('chats.update: settings.temperatures holds agent id → 0..1, null clears, anything else is refused', async (t) => {
  const f = setup();
  t.after(f.cleanup);
  const chat = f.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  const settings = () => f.chats.get(chat.id)!.settings;

  await f.owner.call('chats.update', { id: chat.id, settings: { temperatures: { ag_ava: 0.3 } } });
  assert.deepEqual(settings().temperatures, { ag_ava: 0.3 });
  await f.phone.call('chats.update', { id: chat.id, settings: { temperatures: { ag_ava: 0.7 } } });
  assert.deepEqual(settings().temperatures, { ag_ava: 0.7 }, 'the phone suggests like the PC');

  for (const bad of [{ ag_ava: 1.5 }, { ag_ava: -0.1 }, { ag_ava: '0.5' }, { ag_ava: Number.NaN }, { ['a'.repeat(129)]: 0.2 }]) {
    assert.equal((await f.owner.request('chats.update', { id: chat.id, settings: { temperatures: bad } })).error?.code, 'bad_request', JSON.stringify(bad));
  }
  assert.deepEqual(settings().temperatures, { ag_ava: 0.7 }, 'a refused value changes nothing');

  await f.owner.call('chats.update', { id: chat.id, settings: { temperatures: null } });
  assert.equal(settings().temperatures, undefined, 'null clears the suggestion');
});
