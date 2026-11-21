// B-084: the iPhone web app checks a person code chain byte for byte like the PC (hosted/crypto.ts belongs on
// WebCrypto) – the W4-format test vector.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belongs } from '../../../src/ui/hosted/crypto.ts';

const CODE = '133687038';
const A = '6a3803d5f059902a1c6dafbc9ba4729212f7caac08634cc3ae76b27529f03827';
const B = 'b62e867fa2f33afe62d5d6b1642e1621d543307846b2a57b897e710919b76709';
const CHAIN = {
  root: 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w',
  links: [
    { pub: 'gTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q', sig: 'O576_zzndF29qmqcm5jrRZgKhpXtem-hmw7IQPyEEaL4-DG0nR0wIotGJY_rAKg7c6dxYryLPqFfi8gDud6-Bw' },
    { pub: '7UkoxijRwsbq6QM4kFmVYSlZJzpcY_k2NsFGFKyHN9E', sig: 'i5ka_Tv1qlsFzO1H8awBRr1o0e7BNN-UaRNst_2pmNZOuHmiSDfsbecjHzrRgYExfT9WNGrEyEbsL5aIwYLdBw' },
  ],
};
const FORGED = 'fvGsSmZZ0n86BCd12uJDXZkxa6DI2ka986_T9W1vONh5nsWS8zF24AX1SpS2C_cBk1RRCv0eYgZzQGFz78MmDw';

test('the iPhone accepts exactly the members the chain proves', async () => {
  assert.equal(await belongs(CODE, B, CHAIN), true);
  assert.equal(await belongs(CODE, A, CHAIN), false, 'the chain ends at B');
  assert.equal(await belongs(CODE, A, { root: CHAIN.root, links: CHAIN.links.slice(0, 1) }), true);
  assert.equal(await belongs('830526398', B, undefined), true, 'own ID');
  assert.equal(await belongs(CODE, B, undefined), false);
  assert.equal(await belongs(CODE, B, { root: CHAIN.root, links: [{ pub: CHAIN.links[1].pub, sig: FORGED }] }), false, 'signed by a stranger');
  assert.equal(await belongs(CODE, B, { root: CHAIN.root, links: Array(9).fill(CHAIN.links[0]) }), false, 'at most 8 links');
  assert.equal(await belongs('133687039', B, CHAIN), false);
});
