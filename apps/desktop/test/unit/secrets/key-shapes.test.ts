// 18.11.2026 (a live Stripe key printed by an error text, the third case in two days): what a tool prints is masked by the shape of a
// key too, not only by the values in the vault.
//  - every named format (Stripe live/test/restricted/webhook, GitHub, Slack, AWS, Google, OpenAI, Anthropic, a JWT, a Bearer credential,
//    a PEM private key) becomes "‹secret:<kind>›" in a tool output, in the journal's preview and in the stored copy of a long output;
//  - the mark names the kind and never the value; masking twice changes nothing;
//  - the same key inside a Python traceback and inside JSON is found;
//  - ordinary words, short prefixes, ids without digits and a key-less text are left alone;
//  - a known vault value still becomes its handle first, and a chat message or an app page is not touched (secrets.redact stays as it was).
// The sample keys are built from pieces so that no secret scanner mistakes this file for a leak.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskKeyShapes, keyMark, Redactor } from '../../../src/runtime/secrets/redact.ts';
import { finalizeOutput, preview, MAX_TEXT_CHARS } from '../../../src/runtime/tools/outputs.ts';
import type { FileStore, SecretService } from '../../../src/runtime/contracts.ts';

const rest = (n: number, seed = 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY') => seed.repeat(Math.ceil(n / seed.length)).slice(0, n);
const KEYS: Array<[string, string, string]> = [
  ['Stripe live', ['sk', 'live', rest(34)].join('_'), 'stripe-live'],
  ['Stripe restricted live', ['rk', 'live', rest(34)].join('_'), 'stripe-live'],
  ['Stripe test', ['sk', 'test', rest(34)].join('_'), 'stripe-test'],
  ['Stripe webhook', ['whsec', rest(32)].join('_'), 'stripe-webhook'],
  ['GitHub', ['ghp', rest(36)].join('_'), 'github-token'],
  ['GitHub fine-grained', ['github', 'pat', rest(40)].join('_'), 'github-token'],
  ['Slack', ['xoxb', '1234567890', '0987654321', rest(24)].join('-'), 'slack-token'],
  ['AWS', ['AKIA', 'IOSFODNN7EXAMPLE'].join(''), 'aws-key'],
  ['Google', ['AIza', 'SyA-', rest(31)].join(''), 'google-api-key'],
  ['OpenAI project', ['sk', 'proj', rest(48)].join('-'), 'openai-key'],
  ['Anthropic', ['sk', 'ant', 'api03', rest(48)].join('-'), 'anthropic-key'],
  ['JWT', ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', rest(20)].join('.'), 'jwt'],
];

for (const [name, key, slug] of KEYS) {
  test(`${name} key is masked by its shape: "‹secret:${slug}›", never its value`, () => {
    const text = `request failed: key ${key} was refused (HTTP 401)`;
    const out = maskKeyShapes(text);
    assert.ok(!out.includes(key.slice(8)), 'no part of the value stays');
    assert.equal(out, `request failed: key \u2039secret:${slug}\u203a was refused (HTTP 401)`);
    assert.equal(maskKeyShapes(out), out, 'idempotent');
  });
}

test('a Bearer credential and a PEM private key are masked', () => {
  const bearer = `Authorization: Bearer ${rest(40)}`;
  assert.equal(maskKeyShapes(bearer), 'Authorization: Bearer \u2039secret:bearer-token\u203a');
  const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ') + `\n${rest(64)}\n${rest(64)}\n` + ['-----END', 'RSA PRIVATE KEY-----'].join(' ');
  assert.equal(maskKeyShapes(`before\n${pem}\nafter`), 'before\n\u2039secret:private-key\u203a\nafter');
});

test('a key inside a Python traceback, a JSON body and a shell line is found', () => {
  const key = ['sk', 'live', rest(34)].join('_');
  const traceback = [
    'Traceback (most recent call last):',
    '  File "check.py", line 12, in <module>',
    `    client = stripe.StripeClient("${key}")`,
    `stripe.error.AuthenticationError: Invalid API Key provided: ${key.slice(0, 12)}****${key.slice(-4)}`,
    `curl: (22) The requested URL returned error: 401 -u ${key}:`,
    `{"api_key":"${key}","ok":false}`,
  ].join('\n');
  const out = maskKeyShapes(traceback);
  assert.ok(!out.includes(key), 'the whole key is gone');
  assert.equal(out.match(/\u2039secret:stripe-live\u203a/g)?.length, 3, 'three full keys, the already-masked form stays as the tool printed it');
  assert.ok(out.includes('Traceback (most recent call last):') && out.includes('File "check.py", line 12'), 'the rest of the error stays readable');
});

test('ordinary text is left alone: short prefixes, names with a dash, words, ids without digits, a text without keys', () => {
  const calm = [
    'task-management and risk-based tests ran; disk-usage and sk-learn are named',
    'ghp_ alone, xoxb- alone and AKIA alone are only prefixes',
    'sk-short and sk_live_ without a body',
    'branch feature/very-long-name-without-any-digits-in-it-at-all and the id ' + 'a'.repeat(40),
    'AIzaNoDigitsHereJustLettersAndMoreLettersAndMoreLetters',
    'Bearer token',
    'Basic example.com/ and the base64 word ' + 'QUJD'.repeat(2),
  ].join('\n');
  assert.equal(maskKeyShapes(calm), calm);
  assert.equal(maskKeyShapes(''), '');
  assert.equal(maskKeyShapes('short'), 'short');
});

test('the mark names a kind and never contains the value or a handle', () => {
  assert.equal(keyMark({ name: 'Stripe key', value: ['sk', 'live', 'x'].join('_') }), '\u2039secret:stripe-live\u203a');
  assert.ok(!keyMark({ name: 'Unknown', value: 'whatever' }).includes('whatever'));
  assert.ok(!keyMark({ name: 'API key', value: 'sk-abc' }).includes('secret://'), 'no secret:// handle that something could try to resolve');
});

test('a tool output, a journal preview and the stored copy of a long output carry the mark, not the key', async () => {
  const key = ['sk', 'live', rest(34)].join('_');
  const vault = new Redactor();
  vault.set('sec_known', 'a-known-vault-value-123456');
  const secrets = { redact: (value: string) => vault.redact(value) } as unknown as SecretService;
  const stored: string[] = [];
  const files = {
    put: async (data: Uint8Array) => { stored.push(new TextDecoder().decode(data)); return { id: `blob${stored.length}` } as never; },
    path: (id: string) => `C:/blobs/${id}`,
  } as unknown as FileStore;
  const short = await finalizeOutput({ content: [{ type: 'text', text: `error: ${key} / a-known-vault-value-123456` }], structured: { error: key } } as never, { secrets, files }, 'shell.exec');
  const shortText = (short.output.content[0] as { text: string }).text;
  assert.equal(shortText, 'error: \u2039secret:stripe-live\u203a / secret://sec_known');
  assert.deepEqual(short.output.structured, { error: '\u2039secret:stripe-live\u203a' });
  const long = await finalizeOutput({ content: [{ type: 'text', text: `${key}\n${'x'.repeat(MAX_TEXT_CHARS)}` }] } as never, { secrets, files }, 'shell.exec');
  assert.ok(!(long.output.content[0] as { text: string }).text.includes(key));
  assert.equal(stored.length, 1);
  assert.ok(!stored[0].includes(key) && stored[0].startsWith('\u2039secret:stripe-live\u203a'), 'the stored copy is masked, too');
  assert.equal(preview(secrets, { args: key }), '{"args":"\u2039secret:stripe-live\u203a"}');
});

test('secrets.redact (chat messages, app pages) is not touched by the shape rule', () => {
  const key = ['AIza', 'SyA-', rest(31)].join('');
  assert.equal(new Redactor().redact(`const KEY = "${key}"`), `const KEY = "${key}"`, 'a web key in an app stays as written');
});
