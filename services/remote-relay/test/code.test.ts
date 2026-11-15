// B-084 person code at the meeting server (protocol.ts chainCode, relay.ts index/find): a device whose chain proves the
// code is found under it as well as under its own Remote ID (hello or a later update), the found entry carries the
// chain, a chain signed by a stranger or ending at another key is ignored (its own ID still works), an update without
// the chain takes it out of the code again. The format is the one of .local/b084/notes/W4-format.md.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainCode } from '../src/protocol.ts';
import { createRelay, remoteIdOf } from '../src/relay.ts';
import { connect, device } from './clients.ts';

type Device = ReturnType<typeof device>;
const link = (by: Device, member: Device) => ({ pub: member.pub, sig: by.sign(`wf-code-v1|${member.fp}`) });
const pubs = (frame: Record<string, any>) => (frame.entries as Array<{ pub: string }>).map((entry) => entry.pub).sort();

test('the W4-format vector: the server proves the same code as the desktop app and Android', () => {
  const chain = {
    root: 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w',
    links: [
      { pub: 'gTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q', sig: 'O576_zzndF29qmqcm5jrRZgKhpXtem-hmw7IQPyEEaL4-DG0nR0wIotGJY_rAKg7c6dxYryLPqFfi8gDud6-Bw' },
      { pub: '7UkoxijRwsbq6QM4kFmVYSlZJzpcY_k2NsFGFKyHN9E', sig: 'i5ka_Tv1qlsFzO1H8awBRr1o0e7BNN-UaRNst_2pmNZOuHmiSDfsbecjHzrRgYExfT9WNGrEyEbsL5aIwYLdBw' },
    ],
  };
  assert.equal(chainCode(chain, 'b62e867fa2f33afe62d5d6b1642e1621d543307846b2a57b897e710919b76709')?.code, '133687038');
  assert.equal(chainCode(chain, '6a3803d5f059902a1c6dafbc9ba4729212f7caac08634cc3ae76b27529f03827'), undefined, 'the chain ends at another key');
  assert.equal(chainCode({ ...chain, links: Array(9).fill(chain.links[0]) }, 'b62e867fa2f33afe62d5d6b1642e1621d543307846b2a57b897e710919b76709'), undefined, 'at most 8 links');
});

test('a member is found under the code with its chain; a forged chain is ignored; an update moves it in and out', async (t) => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  t.after(() => relay.close());
  const root = device();
  const member = device();
  const stranger = device();
  const code = remoteIdOf(root.fp);
  const chain = { root: root.pub, links: [link(root, member)] };

  const cr = await connect(relay.port, { me: root, findable: true });
  await cr.next('ready');
  const cm = await connect(relay.port, { me: member, findable: true });
  await cm.next('ready');
  const asker = await connect(relay.port);
  await asker.next('ready');

  asker.send({ t: 'find', ref: 1, id: code });
  assert.deepEqual(pubs(await asker.next('found')), [root.pub], 'without its chain the member is not under the code');

  cm.send({ t: 'update', peers: [], findable: true, chain });
  await new Promise((resolve) => setTimeout(resolve, 60));
  asker.send({ t: 'find', ref: 2, id: code });
  const found = await asker.next('found');
  assert.deepEqual(pubs(found), [root.pub, member.pub].sort());
  assert.deepEqual(found.entries.find((entry: { pub: string }) => entry.pub === member.pub).chain, chain, 'the finder checks the chain itself');
  assert.equal(found.entries.find((entry: { pub: string }) => entry.pub === root.pub).chain, undefined, 'the root answers with its own ID');
  asker.send({ t: 'find', ref: 3, id: remoteIdOf(member.fp) });
  assert.deepEqual(pubs(await asker.next('found')), [member.pub], 'and under its own ID as before');

  cm.send({ t: 'update', peers: [], findable: true, chain: { root: root.pub, links: [link(stranger, member)] } });
  await new Promise((resolve) => setTimeout(resolve, 60));
  asker.send({ t: 'find', ref: 4, id: code });
  assert.deepEqual(pubs(await asker.next('found')), [root.pub], 'a link signed by a stranger is ignored');

  cm.send({ t: 'update', peers: [], findable: true, chain });
  cm.send({ t: 'update', peers: [], findable: false, chain });
  await new Promise((resolve) => setTimeout(resolve, 60));
  asker.send({ t: 'find', ref: 5, id: code });
  assert.deepEqual(pubs(await asker.next('found')), [root.pub], 'not findable: under no ID');
  cm.ws.close();
  cr.ws.close();
  asker.ws.close();
});
