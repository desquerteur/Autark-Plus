// F14 (owner 15.11.2026: "wenn, dann sollte der nur hinzugefügt werden, wenn er wirklich sich inviten lässt"): a person who
// never joined can be removed for good – owner only; first offboarded like a revocation (reports move up, chats left),
// then their row, audit lines, invite ticket and code go – and the removal reaches my other PCs as a removal (sync).
// Someone who joined keeps their row (their access ends with revoke).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleRig, settle } from './rig.ts';
import { DEVICE_SCOPE_PHONE } from './scopes.ts';
import { TestClient } from '../rpc/s1-helpers.ts';
import { FakeTimers } from '../chat/harness.ts';
import { link, makePc, Net, settle as settleSync, type Pc } from '../devices/sync-net.ts'; // the sync's batches go on a timer
import { PeopleService } from '../../../src/runtime/people/service.ts';
import type { Person } from '../../../src/shared/model/people.ts';
import type { RuntimeServices, SettingsService } from '../../../src/runtime/contracts.ts';
import '../../../src/runtime/contracts/people.ts';

const tokensOf = (r: ReturnType<typeof peopleRig>, id: string) =>
  r.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tokens WHERE json_extract(scope, '$.personId') = ?`, [id])?.n ?? 0;

test('F14: a person who never joined is removed – reports move up, chats left, invite and code dead, row and audit gone', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const huhu = await r.owner.call<Person>('people.save', { name: 'huhu', managerId: 'human' });
  const ben = await r.owner.call<Person>('people.save', { name: 'Ben', managerId: huhu.id });
  r.org.update('ag_research', { managerId: huhu.id });
  const chat = r.services.chats.create({ agentIds: [], people: [huhu.id], createdBy: 'human', title: 'Plan' });
  assert.ok(r.db.get('SELECT 1 FROM members WHERE conversation_id = ? AND member_id = ? AND left_at IS NULL', [chat.id, huhu.id]), 'in a chat before');
  const invite = await r.owner.call<{ url: string; code: string }>('people.invite', { id: huhu.id });
  assert.ok(tokensOf(r, huhu.id) > 0, 'the open invite ticket');
  const removed: unknown[] = [];
  r.bus.on('person.removed', (event) => removed.push(event));

  assert.deepEqual(await r.owner.call('people.remove', { id: huhu.id }), { ok: true });
  assert.deepEqual(removed, [{ id: huhu.id }], 'one event: windows, phones and my other PCs drop the row');
  assert.equal(r.service.get(huhu.id), undefined);
  assert.equal((await r.owner.call<Person[]>('people.list')).some((person) => person.id === huhu.id), false);
  assert.equal(r.service.require(ben.id).managerId, 'human', 'their report moved up to their manager');
  assert.equal(r.org.get('ag_research')?.managerId, 'human', 'an agent under them too');
  assert.ok(r.db.get('SELECT 1 FROM members WHERE conversation_id = ? AND member_id = ? AND left_at IS NOT NULL', [chat.id, huhu.id]), 'they left the chat');
  assert.equal(tokensOf(r, huhu.id), 0, 'no ticket row left');
  assert.equal(r.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM people_audit WHERE person_id = ?', [huhu.id])?.n, 0);
  const byTicket = await r.server.handleHttp({ id: 1, method: 'people.join', params: { ticket: invite.url.split('#join=')[1] } }, { remote: '10.0.0.3' });
  assert.equal(byTicket.error?.code, 'forbidden', 'the link is dead');
  const byCode = await r.server.handleHttp({ id: 2, method: 'people.join', params: { code: invite.code } }, { remote: '10.0.0.3' });
  assert.equal(byCode.error?.code, 'forbidden', 'the code is dead');
  await assert.rejects(r.owner.call('people.remove', { id: huhu.id }), /not found/i);
});

test('F14: only the owner removes, only someone who never joined, never the owner; a revoked invite who never joined goes too', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const anna = await r.join('Anna Berg');
  await assert.rejects(r.owner.call('people.remove', { id: anna.person.id }), /has joined already: remove their access instead/);
  await r.owner.call('people.revoke', { id: anna.person.id });
  await assert.rejects(r.owner.call('people.remove', { id: anna.person.id }), /has joined already/, 'revoked, but she was in: her row stays');
  await assert.rejects(r.owner.call('people.remove', { id: 'human' }), /owner cannot be removed/);
  const eve = await r.owner.call<Person>('people.save', { name: 'Eve' });
  const phone = new TestClient(r.server, DEVICE_SCOPE_PHONE);
  await assert.rejects(phone.call('people.remove', { id: eve.id }), /not allowed/, 'my phone does not remove people');
  const other = await r.join('Ben Vogt');
  await assert.rejects(other.client.call('people.remove', { id: eve.id }), /not allowed/, 'nor does a person');
  await r.owner.call('people.revoke', { id: eve.id });
  await r.owner.call('people.remove', { id: eve.id });
  assert.equal(r.service.get(eve.id), undefined, 'access removed before she ever joined: she can go for good');
  await settle();
});

/** A PC of the sync net with a real PeopleService on its harness. */
function withPeople(pc: Pc): PeopleService {
  const services = pc.h.services as RuntimeServices;
  const people = new PeopleService({
    db: pc.h.db, clock: pc.h.clock, bus: pc.h.bus, log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: { get: () => ({ profile: { name: 'Mara' } }) } as unknown as SettingsService,
    services: () => services, timers: new FakeTimers(),
    address: () => ({ url: 'https://pc.tailnet.ts.net', reachable: true }), qr: async () => 'data:image/png;base64,AA',
  });
  people.ensureOwner();
  services.people = people;
  return people;
}

test('F14: the removal reaches my other PC as a removal – the row goes there with its event, and nothing echoes back', async () => {
  const net = new Net();
  const a = makePc(net, 'dev_a');
  const b = makePc(net, 'dev_b');
  link(a, b);
  const onA = withPeople(a);
  const onB = withPeople(b);
  const huhu = onA.save({ name: 'huhu', managerId: 'human' });
  await settleSync();
  assert.equal(onB.get(huhu.id)?.name, 'huhu', 'B has the invited person');
  const gone: unknown[] = [];
  b.h.bus.on('person.removed', (event) => gone.push(event));
  const calls = net.calls.length;
  onA.remove(huhu.id);
  await settleSync();
  assert.deepEqual(net.calls.slice(calls).map((call) => [call.from, call.to, call.params]), [['dev_a', 'dev_b', { items: [{ t: 'people', id: huhu.id, at: b.stamps.get(`people/${huhu.id}`)?.at, gone: true }] }]], 'one removal item, no row content');
  assert.equal(onB.get(huhu.id), undefined, 'the row went on B too');
  assert.deepEqual(gone, [{ id: huhu.id }], 'B\'s windows hear it');
  const back = net.calls.slice(calls).filter((call) => call.from === 'dev_b' && JSON.stringify(call.params).includes(huhu.id));
  assert.deepEqual(back, [], 'no echo to A');
  onA.save({ name: 'Other' });
  await settleSync();
  assert.equal(onA.get(huhu.id), undefined, 'nothing brings the row back');
});
