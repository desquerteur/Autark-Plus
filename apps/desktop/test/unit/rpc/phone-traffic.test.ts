// Phone traffic (18.11.2026): one phone took ~1 GB a day through the meeting server, ~870 KB per agent turn – nearly all
// of it agent.upserted with the agent's whole SYSTEM.md (~27 KB) at every step note of every turn. A device now hears an
// agent whose only news is status, step note or time without its instructions once its connection got them
// (scopes.ts deviceAgent); the owner's window, a new connection, any other change and an archived agent get it whole.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import { deviceAgent } from '../../../src/runtime/rpc/scopes.ts';
import { OWNER, PHONE, TestClient, rpcFixture, settle } from './s1-helpers.ts';

const SYSTEM_MD = `# Ava\n${'Works carefully and says what she found. '.repeat(700)}`; // ~28 KB like a real SYSTEM.md

function ava(patch: Partial<Agent> = {}): Agent {
  return { ...agent('ag_ava', 'Ava'), instructions: SYSTEM_MD, ...patch };
}

test('deviceAgent: whole the first time, without instructions for a status-only change, whole again after any other change', () => {
  const sent = new Map<string, string>();
  assert.equal((deviceAgent(sent, ava()) as Agent).instructions, SYSTEM_MD, 'first time on a connection: whole');
  const step = deviceAgent(sent, ava({ status: 'working', statusNote: 'running npm test', updatedAt: 99 }));
  assert.equal('instructions' in step, false, 'status and note only: no SYSTEM.md again');
  assert.equal(step.status, 'working');
  assert.equal(step.statusNote, 'running npm test');
  assert.equal((deviceAgent(sent, ava({ role: 'Lead', status: 'working' })) as Agent).instructions, SYSTEM_MD, 'another field changed: whole');
  assert.equal((deviceAgent(sent, ava({ role: 'Lead', status: 'working', instructions: `${SYSTEM_MD}!` })) as Agent).instructions, `${SYSTEM_MD}!`, 'new instructions: whole');
  assert.equal('instructions' in deviceAgent(sent, ava({ role: 'Lead', status: 'idle', instructions: `${SYSTEM_MD}!` })), false);
  assert.ok('instructions' in deviceAgent(sent, ava({ role: 'Lead', instructions: `${SYSTEM_MD}!`, archivedAt: 5 })), 'archived: whole');
  assert.ok('instructions' in deviceAgent(sent, ava({ role: 'Lead', instructions: `${SYSTEM_MD}!`, archivedAt: 5, status: 'idle' })), 'archived stays whole');
});

test('a phone gets an agent\'s status changes without its SYSTEM.md; the owner and a second phone connection get it whole', async (t) => {
  const f = rpcFixture();
  t.after(f.cleanup);
  const owner = new TestClient(f.server, OWNER);
  const phone = new TestClient(f.server, PHONE);
  for (const client of [owner, phone]) await client.call('events.subscribe', { topics: ['org'] });
  const bytes = (client: TestClient) => client.events('agent.upserted').reduce((sum, frame) => sum + JSON.stringify(frame).length, 0);

  f.bus.emit('agent.upserted', ava());
  for (const note of ['reading', 'editing', 'testing']) f.bus.emit('agent.upserted', ava({ status: 'working', statusNote: note, updatedAt: Date.now() }));
  f.bus.emit('agent.upserted', ava({ status: 'idle', updatedAt: Date.now() }));
  await settle();

  const got = phone.events('agent.upserted').map((frame) => frame.data as Partial<Agent>);
  assert.equal(got.length, 5, 'the phone hears every change');
  assert.equal(got[0].instructions, SYSTEM_MD);
  assert.deepEqual(got.slice(1).map((entry) => [entry.status, entry.statusNote, 'instructions' in entry]),
    [['working', 'reading', false], ['working', 'editing', false], ['working', 'testing', false], ['idle', undefined, false]]);
  assert.ok(owner.events('agent.upserted').every((frame) => (frame.data as Agent).instructions === SYSTEM_MD), 'the owner\'s window: whole');
  assert.ok(bytes(phone) < bytes(owner) / 4, `phone ${bytes(phone)} B vs owner ${bytes(owner)} B`);

  const again = new TestClient(f.server, PHONE); // a reconnect is a new connection: whole once
  await again.call('events.subscribe', { topics: ['org'] });
  f.bus.emit('agent.upserted', ava({ status: 'working', statusNote: 'back', updatedAt: Date.now() }));
  await settle();
  assert.equal((again.events('agent.upserted')[0].data as Agent).instructions, SYSTEM_MD);
});
