// desquerteur/Autark-Plus#24 – Gemini CLI's Google sign-in on lexivers (21.11.2026, Gemini CLI 0.69.0): ACP authenticate with
// oauth-personal answers -32000 "This client is no longer supported for Gemini Code Assist for individuals …" – Google stopped
// personal accounts on 18 June 2026. That refusal reaches the person ('account.sign_in_failed' with an explained text) instead
// of a silent 5-minute wait. Owns: nothing in production. Never starts a CLI or uses the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Account } from '../../../src/shared/model/providers.ts';
import { AcpRpcError } from '../../../src/runtime/engines/acp/protocol.ts';
import { ACP_PROVIDERS, GEMINI_PERSONAL_SIGN_IN_GONE, signInRefusal, startAuthentication } from '../../../src/runtime/engines/acp/providers.ts';
import { AcpPlans, type AcpPlanDeps } from '../../../src/runtime/accounts/acp-plans.ts';

const GOOGLE = 'This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google';
const gemini = { id: 'acc_g', provider: 'gemini-cli', label: 'Gemini', auth: 'cli', state: 'needs_login', enabled: true, priority: 0, rotation: false, detected: false, createdAt: 1 } as Account;
const METHODS = [{ id: 'oauth-personal', name: 'Log in with Google' }, { id: 'gemini-api-key', name: 'Gemini API key' }];
const port = (authenticate: () => Promise<boolean>) => ({ authMethods: async () => METHODS, authenticate });

test('signInRefusal: Google\'s refusal of personal accounts is explained; another agent error keeps its words, shortened', () => {
  const spec = ACP_PROVIDERS['gemini-cli'];
  assert.equal(signInRefusal(spec, GOOGLE), GEMINI_PERSONAL_SIGN_IN_GONE);
  assert.equal(signInRefusal(spec, 'UNSUPPORTED_CLIENT'), GEMINI_PERSONAL_SIGN_IN_GONE);
  assert.match(GEMINI_PERSONAL_SIGN_IN_GONE, /API key/);
  assert.equal(signInRefusal(spec, '  Quota\n project missing '), 'Gemini CLI refused the sign-in: Quota project missing');
  assert.equal(signInRefusal(spec, 'x'.repeat(400)).length, 'Gemini CLI refused the sign-in: '.length + 300);
});

test('startAuthentication: the agent\'s error answer ends the sign-in with its reason; a plain false stays without one', async () => {
  const spec = ACP_PROVIDERS['gemini-cli'];
  const refused = await startAuthentication(port(() => Promise.reject(new AcpRpcError('remote', -32000, GOOGLE))), gemini, spec);
  assert.deepEqual(await refused.done, { ok: false, message: GEMINI_PERSONAL_SIGN_IN_GONE });
  assert.deepEqual(await (await startAuthentication(port(async () => false), gemini, spec)).done, { ok: false });
  assert.deepEqual(await (await startAuthentication(port(async () => true), gemini, spec)).done, { ok: true });
});

test('AcpPlans.login: a refused Google sign-in announces its reason, then checks the account', async () => {
  const order: string[] = [];
  let checked!: () => void;
  const checkedOnce = new Promise<void>((resolve) => { checked = resolve; });
  const deps = {
    repo: { list: () => [gemini], get: () => gemini }, dismissed: { delete: () => true }, save: (a: Account) => a, blank: () => gemini,
    signIns: {}, engine: () => port(() => Promise.reject(new AcpRpcError('remote', -32000, GOOGLE))),
    check: async (id: string) => { order.push(`check ${id}`); checked(); },
    failed: (id: string, message: string) => { order.push(`failed ${id}: ${message}`); },
  } as unknown as AcpPlanDeps;
  const plans = new AcpPlans(deps);
  assert.deepEqual(await plans.login(gemini), { started: true }, 'the sign-in started (add returns, the flow waits)');
  await checkedOnce;
  assert.deepEqual(order, [`failed acc_g: ${GEMINI_PERSONAL_SIGN_IN_GONE}`, 'check acc_g']);
});
