// B-088: the ChatGPT plan's one-request dictation (src/runtime/voice/plan-transcribe.ts): what goes up (the take, a language,
// the login in the headers, no model fields), what comes back, the one refresh-and-retry through the account's own
// Codex server, and that no token ever shows in an error.
// Owns: these assertions only. Never: the network, a real login or a real Codex server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { PLAN_TRANSCRIBE_URL, planMissing, planReady, planTranscribe } from '../../../src/runtime/voice/plan-transcribe.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { quietLog, toneWav } from './local-fixture.ts';

const FILE_ID = 'e'.repeat(64);

interface Call { url: string; headers: Record<string, string>; body: FormData }

function setup(options: { login?: object | null; signedIn?: boolean; state?: string; enabled?: boolean; answers?: Array<{ status: number; body?: unknown }>; refreshWrites?: object; refreshFails?: boolean; take?: { mime: string; name: string; bytes: Uint8Array } } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'plan-transcribe-'));
  const writeLogin = (login: object) => writeFileSync(path.join(home, 'auth.json'), JSON.stringify(login));
  if (options.login !== null) writeLogin(options.login ?? { auth_mode: 'chatgpt', tokens: { access_token: 'tok-first', account_id: 'acct-1' } });
  const account = { id: 'acc_c', provider: 'codex', label: 'Codex', auth: 'cli', plan: 'prolite', home, state: options.state ?? 'ok', priority: 0, enabled: options.enabled ?? true, detected: false, createdAt: 1 };
  const take = options.take ?? { mime: 'audio/wav', name: 'take.wav', bytes: toneWav(1) };
  const requests: string[] = [];
  const refreshes: unknown[] = [];
  const link = {
    hold: () => () => undefined,
    request: async (method: string, params: unknown) => {
      requests.push(method); refreshes.push(params);
      if (options.refreshFails) throw new Error('server down');
      if (options.refreshWrites) writeLogin(options.refreshWrites);
      return {};
    },
  };
  const services = {
    log: quietLog,
    accounts: { candidates: (engine?: string) => (engine === 'codex' && options.signedIn !== false ? [account] : []) },
    files: { get: () => ({ id: FILE_ID, mime: take.mime, name: take.name, size: take.bytes.byteLength, createdAt: 1 }), read: async () => take.bytes },
    host: { media: {} },
    engines: { get: () => ({ realtime: async () => link }) },
  } as unknown as RuntimeServices;
  const calls: Call[] = [];
  const answers = [...(options.answers ?? [{ status: 200, body: { text: ' Hallo Welt. ', asset_pointer: 'asset-secret', asset_ttl: '30d' } }])];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as FormData });
    const answer = answers.shift() ?? { status: 500 };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status });
  };
  const ref = services.files.get(FILE_ID)!;
  return { services, fetch, calls, ref, requests, refreshes, done: () => rmSync(home, { recursive: true, force: true }) };
}

test('one request: the take and a language go up with the login in the headers, no model fields; the trimmed text comes back', async () => {
  const t = setup();
  try {
    const heard = await planTranscribe(t.services, t.ref, 'de', t.fetch);
    assert.deepEqual(heard, { text: 'Hallo Welt.' });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, PLAN_TRANSCRIBE_URL);
    assert.deepEqual(t.calls[0].headers, { Authorization: 'Bearer tok-first', 'ChatGPT-Account-Id': 'acct-1' });
    const body = t.calls[0].body;
    assert.equal(body.get('language'), 'de');
    assert.equal(body.has('model'), false, 'the endpoint picks its own model');
    assert.equal(body.has('response_format'), false);
    const file = body.get('file') as File;
    assert.equal(file.type, 'audio/wav');
    assert.ok(file.size > 0);
    assert.deepEqual(t.requests, [], 'no refresh without a rejection');
  } finally { t.done(); }
});

test('a compact take (Ogg Opus from the page) goes up as it is: the same bytes, its own type and name, one request', async () => {
  const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, ...new Array(58).fill(7)]);
  const t = setup({ take: { mime: 'audio/ogg', name: 'Dictation 2026-11-16 10-00 (2).ogg', bytes } });
  try {
    assert.deepEqual(await planTranscribe(t.services, t.ref, 'de', t.fetch), { text: 'Hallo Welt.' });
    assert.equal(t.calls.length, 1);
    const file = t.calls[0].body.get('file') as File;
    assert.equal(file.type, 'audio/ogg');
    assert.equal(file.name, 'dictation.ogg');
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes, 'not decoded, not re-encoded');
  } finally { t.done(); }
});

test('no language known: none is sent (the endpoint detects it); silence is an empty text, not a failure', async () => {
  const t = setup({ answers: [{ status: 200, body: { text: '   ' } }] });
  try {
    assert.deepEqual(await planTranscribe(t.services, t.ref, undefined, t.fetch), { text: '' });
    assert.equal(t.calls[0].body.has('language'), false);
  } finally { t.done(); }
});

test('a rejected login is refreshed by the account\'s own Codex server and read again, once', async () => {
  const t = setup({ answers: [{ status: 401 }, { status: 200, body: { text: 'Nach dem Refresh.' } }], refreshWrites: { tokens: { access_token: 'tok-second', account_id: 'acct-1' } } });
  try {
    assert.deepEqual(await planTranscribe(t.services, t.ref, 'de', t.fetch), { text: 'Nach dem Refresh.' });
    assert.deepEqual(t.requests, ['account/read']);
    assert.deepEqual(t.refreshes, [{ refreshToken: true }]);
    assert.deepEqual(t.calls.map((call) => call.headers.Authorization), ['Bearer tok-first', 'Bearer tok-second']);
  } finally { t.done(); }
});

test('a second rejection ends it, a failed refresh too: a user-safe error, never a loop, never a token in the message', async () => {
  const again = setup({ answers: [{ status: 401 }, { status: 401 }, { status: 200, body: { text: 'nie' } }], refreshWrites: { tokens: { access_token: 'tok-second' } } });
  try {
    await assert.rejects(planTranscribe(again.services, again.ref, 'de', again.fetch), (error: unknown) => {
      assert.ok(error instanceof WorkforceError);
      assert.doesNotMatch(error.message, /tok-/);
      return true;
    });
    assert.equal(again.calls.length, 2, 'one retry, no more');
  } finally { again.done(); }
  const broken = setup({ answers: [{ status: 401 }], refreshFails: true });
  try {
    await assert.rejects(planTranscribe(broken.services, broken.ref, 'de', broken.fetch), WorkforceError);
    assert.equal(broken.calls.length, 1, 'no retry when the refresh did not work');
  } finally { broken.done(); }
});

test('other failures fall through as errors: a limit, a refused take, an answer without text', async () => {
  for (const [answer, code] of [[{ status: 429 }, 'rate_limited'], [{ status: 400 }, 'bad_request'], [{ status: 200, body: { nothing: true } }, 'unavailable']] as const) {
    const t = setup({ answers: [answer] });
    try {
      await assert.rejects(planTranscribe(t.services, t.ref, 'de', t.fetch), (error: unknown) => error instanceof WorkforceError && error.code === code);
      assert.deepEqual(t.requests, [], 'only a 401 asks Codex to refresh');
    } finally { t.done(); }
  }
});

test('without a usable login nothing is sent: no file, no ChatGPT tokens (an API-key login), no plan account', async () => {
  for (const options of [{ login: null }, { login: { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-x' } }, { login: { tokens: { access_token: 'has space' } } }, { signedIn: false }]) {
    const t = setup(options);
    try {
      await assert.rejects(planTranscribe(t.services, t.ref, 'de', t.fetch), (error: unknown) => error instanceof WorkforceError && error.code === 'unavailable');
      assert.equal(t.calls.length, 0);
    } finally { t.done(); }
  }
});

test('planReady: a signed-in plan login, no file read', () => {
  const t = setup();
  try {
    assert.equal(planReady(t.services), true);
    assert.equal(planReady(setup({ signedIn: false }).services), false);
  } finally { t.done(); }
});

// 16.11.2026: a dictation on the notebook went to this PC's small model because the plan account stood at 'error'
// after a model list timed out; the dictation endpoint is no Codex turn, so only a gone or switched-off login is skipped.
test('a plan login in a passing state (limit, timed-out model list, not yet probed) still writes the dictation down', async () => {
  for (const state of ['cooling', 'error', 'unknown']) {
    const t = setup({ state });
    try {
      assert.equal(planReady(t.services), true, state);
      const heard = await planTranscribe(t.services, t.ref, 'de', t.fetch);
      assert.equal(heard.text, 'Hallo Welt.', state);
      assert.equal(t.calls.length, 1, state);
      assert.equal(t.calls[0].url, PLAN_TRANSCRIBE_URL, state);
    } finally { t.done(); }
  }
});

test('a gone or switched-off plan login is skipped without a request, and the log line says which', async () => {
  for (const [options, reason] of [[{ state: 'needs_login' }, 'needs_login'], [{ state: 'disabled' }, 'disabled'], [{ enabled: false }, 'disabled'], [{ signedIn: false }, 'no_plan_login']] as const) {
    const t = setup(options);
    try {
      assert.equal(planReady(t.services), false, reason);
      assert.equal(planMissing(t.services), reason);
      await assert.rejects(planTranscribe(t.services, t.ref, 'de', t.fetch), (error: unknown) => error instanceof WorkforceError && error.code === 'unavailable');
      assert.equal(t.calls.length, 0, reason);
    } finally { t.done(); }
  }
});
