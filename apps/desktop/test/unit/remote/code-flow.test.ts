// B-084 person code in the connect flow (remote/service.ts, requests.ts, join.ts, find.ts with remote/code.ts): a PC
// accepted as my own gets my signature; a request by my person code reaches my other PC while the first one is gone, its
// chain proves the code and the link is made (and signed again); a device whose chain ends elsewhere is never asked.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '../../../src/runtime/db/database.ts';
import { belongs, openCode, type PersonCode } from '../../../src/runtime/remote/code.ts';
import { remoteIdOf } from '../../../src/runtime/remote/id.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { Lan, linkedIds, settle, type Pc } from './rig.ts';

const codeOf = (pc: Pc): PersonCode => openCode((pc.repo as unknown as { db: Db }).db, pc.identity, () => pc.clock.now());

async function accept(target: Pc, from: Pc, id: string): Promise<void> {
  await from.remote.connect({ target: id });
  const [incoming] = target.remote.state().incoming;
  target.remote.decide(incoming.id, true);
  await settle();
}

test('a request by my person code reaches my other PC while the first one is gone, and the chain proves it', async () => {
  const lan = new Lan();
  const laptop = await lan.add('Laptop', 'http://10.0.0.1:47812');
  const tower = await lan.add('Tower', 'http://10.0.0.2:47812');
  const laptopCode = codeOf(laptop);
  const towerCode = codeOf(tower);
  const code = laptop.remote.remoteId();
  assert.equal(code, remoteIdOf(laptop.identity.fingerprint), 'the first PC keeps its own ID');

  await accept(laptop, tower, code);
  assert.deepEqual(linkedIds(laptop), [tower.identity.deviceId]);
  assert.ok(laptopCode.tree().links.some((entry) => entry.by === laptop.identity.fingerprint), 'Laptop signed Tower');
  towerCode.take(laptopCode.tree(), laptop.mesh.selfInfo().pub); // the roster brings it (sync-roster-code.test.ts)
  assert.equal(tower.remote.remoteId(), code, 'Tower shows the same code');
  assert.ok(tower.states.some((state) => state.self.remoteId === code), 'and tells Settings at once');

  laptop.findable = false; // the laptop is away
  laptop.remote.refresh();
  laptop.hello = undefined;
  const desk = await lan.add('Desk', 'http://10.0.0.3:47812');
  const out = await desk.remote.connect({ target: code });
  assert.equal(out.deviceId, tower.identity.deviceId, 'Tower answered for the code');
  assert.equal(out.remoteId, code);
  const [incoming] = tower.remote.state().incoming;
  tower.remote.decide(incoming.id, true);
  await settle();
  assert.deepEqual(linkedIds(desk), [tower.identity.deviceId]);
  const deskCode = codeOf(desk);
  deskCode.take(towerCode.tree(), tower.mesh.selfInfo().pub);
  assert.equal(desk.remote.remoteId(), code, 'Desk joined the same code through Tower');
  assert.equal(belongs(code, desk.identity.fingerprint, deskCode.chain()), true);
});

test('a device that carries someone else\'s chain is never asked for the code', async () => {
  const lan = new Lan();
  const laptop = await lan.add('Laptop', 'http://10.0.0.1:47812');
  const tower = await lan.add('Tower', 'http://10.0.0.2:47812');
  const laptopCode = codeOf(laptop);
  const towerCode = codeOf(tower);
  const code = laptop.remote.remoteId();
  await accept(laptop, tower, code);
  towerCode.take(laptopCode.tree(), laptop.mesh.selfInfo().pub);
  laptop.findable = false;
  laptop.remote.refresh();
  laptop.hello = undefined;
  tower.findable = false;
  tower.remote.refresh();
  tower.hello = undefined;

  const rogue = await lan.add('Rogue', 'http://10.0.0.9:47812');
  const own = rogue.hello!;
  rogue.hello = () => ({ ...own()!, chain: towerCode.chain() }); // Tower's chain, the rogue's own key
  const desk = await lan.add('Desk', 'http://10.0.0.3:47812');
  await assert.rejects(desk.remote.connect({ target: code }), (error: unknown) => error instanceof WorkforceError && error.code === 'not_found');
  assert.equal(rogue.remote.state().incoming.length, 0, 'nothing reached the rogue');
});
