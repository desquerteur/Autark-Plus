// B-091 (owner 13.11.2026: sign in to Codex and Claude Code right on the phone): a sign-in result with `code` (Codex) or
// `paste` (Claude Code) – only a phone gets them – opens the one sign-in sheet; a PC result opens none. The sheet closes
// itself with a toast once the account works; a Claude Code code that did not work shows the inline error and starts a
// fresh sign-in at once. The plan button's flow opens the sheet and waits the device code's 15 minutes. The sheet's
// markup is .tsx, so its texts are read from the source.
// Owns: these assertions. Never: runs a real CLI or reaches a runtime.

import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@preact/signals';
import type { Account } from '../../../src/shared/model/providers.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';
import { accounts } from '../../../src/ui/lib/store.ts';
import { toasts } from '../../../src/ui/lib/toasts.ts';
import { awaySignIn, CODE_FAILED, openAwaySignIn, submitCode } from '../../../src/ui/settings/away-sign-in.ts';
import { AWAY_WAIT_MS, SIGN_IN_WAIT_MS, startPlanSetup, type PlanEnv } from '../../../src/ui/onboarding/plan-setup.ts';

const account = (id: string, provider: string, state: Account['state']): Account =>
  ({ id, provider, label: provider === 'codex' ? 'Codex' : 'Claude Code', auth: 'cli', enabled: true, state, priority: 0, detected: false, createdAt: 1 }) as Account;
const DEVICE = 'https://auth.openai.com/codex/device';
const CLAUDE = 'https://claude.com/cai/oauth/authorize?state=test';
const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => { mock.restoreAll(); awaySignIn.value = null; accounts.value = []; toasts.value = []; });

test('only a result with a code or paste opens the sheet; a PC sign-in opens none', () => {
  assert.equal(openAwaySignIn('acc_c', { url: DEVICE }), false);
  assert.equal(awaySignIn.value, null, 'the PC: its CLI opens the browser, no sheet');
  assert.equal(openAwaySignIn('acc_c', { code: 'FR4A-CONBK' }), false, 'no page, no sheet');
  assert.equal(openAwaySignIn('acc_c', { url: DEVICE, code: 'FR4A-CONBK' }), true);
  assert.deepEqual(awaySignIn.value, { id: 'acc_c', url: DEVICE, code: 'FR4A-CONBK' });
  assert.equal(openAwaySignIn('acc_k', { signInUrl: CLAUDE, paste: true }), true, 'accounts.add hands its signInUrl on');
  assert.deepEqual(awaySignIn.value, { id: 'acc_k', url: CLAUDE });
});

test('the sheet closes itself with a toast once its account works, not for another account', () => {
  accounts.value = [account('acc_c', 'codex', 'needs_login')];
  openAwaySignIn('acc_c', { url: DEVICE, code: 'FR4A-CONBK' });
  accounts.value = [account('acc_c', 'codex', 'needs_login'), account('acc_o', 'claude', 'ok')];
  assert.notEqual(awaySignIn.value, null);
  accounts.value = [account('acc_c', 'codex', 'cooling')];
  assert.equal(awaySignIn.value, null);
  assert.deepEqual(toasts.value.map((toast) => toast.title), ['Codex signed in']);
});

test('a sheet opened on an account that already works stays open for the code (no false toast)', async () => {
  accounts.value = [account('acc_c', 'codex', 'ok'), account('acc_k', 'claude', 'cooling')];
  openAwaySignIn('acc_c', { url: DEVICE, code: 'FR4A-CONBK' });
  assert.equal(awaySignIn.value?.code, 'FR4A-CONBK', 'the person sees the code');
  accounts.value = [account('acc_c', 'codex', 'ok'), account('acc_k', 'claude', 'cooling')];
  assert.notEqual(awaySignIn.value, null, 'a fresh reading of the working account closes nothing');
  mock.method(rpc, 'call', async () => ({ ok: true }));
  openAwaySignIn('acc_k', { url: CLAUDE, paste: true });
  assert.notEqual(awaySignIn.value, null);
  await submitCode('the-code');
  assert.equal(awaySignIn.value, null, 'an accepted code closes it');
  assert.deepEqual(toasts.value.map((toast) => toast.title), ['Claude Code signed in']);
});

test('Claude Code: a code that works closes the sheet with one toast', async () => {
  accounts.value = [account('acc_k', 'claude', 'needs_login')];
  const calls: unknown[] = [];
  mock.method(rpc, 'call', async (method: string, params: unknown) => { calls.push([method, params]); return { ok: true }; });
  openAwaySignIn('acc_k', { url: CLAUDE, paste: true });
  await submitCode('abc#def');
  assert.deepEqual(calls, [['accounts.loginCode', { id: 'acc_k', code: 'abc#def' }]]);
  assert.equal(awaySignIn.value, null);
  accounts.value = [account('acc_k', 'claude', 'ok')];
  assert.deepEqual(toasts.value.map((toast) => toast.title), ['Claude Code signed in'], 'the account event after it adds no second toast');
});

test('Claude Code: a code that did not work shows the error and starts a fresh sign-in for the next tap', async () => {
  accounts.value = [account('acc_k', 'claude', 'needs_login')];
  const fresh = `${CLAUDE}&again=1`;
  const calls: string[] = [];
  let answer: 'no' | 'ended' = 'no';
  mock.method(rpc, 'call', async (method: string) => {
    calls.push(method);
    if (method === 'accounts.loginCode') { if (answer === 'ended') throw new Error('The sign-in ended – start it again.'); return { ok: false }; }
    return { started: true, url: fresh, paste: true };
  });
  openAwaySignIn('acc_k', { url: CLAUDE, paste: true });
  await submitCode('wrong');
  assert.deepEqual(calls, ['accounts.loginCode', 'accounts.login']);
  assert.deepEqual(awaySignIn.value, { id: 'acc_k', url: fresh, failed: true });
  answer = 'ended';
  await submitCode('late');
  assert.deepEqual(awaySignIn.value, { id: 'acc_k', url: fresh, failed: true }, 'an ended sign-in reads the same and starts again');
  assert.equal(toasts.value.length, 0);
  assert.equal(CODE_FAILED, 'That code did not work – open sign-in again.');
});

test('the plan button from the phone opens the sheet and waits the device code\'s 15 minutes; the PC keeps 5', async () => {
  for (const away of [true, false]) {
    const list = signal<Account[]>([]);
    const timers: number[] = [];
    const env: PlanEnv = {
      rpc: {
        install: async () => ({}),
        add: async () => ({ ...account('acc_new', 'codex', 'needs_login'), signInUrl: DEVICE, ...(away ? { code: 'FR4A-CONBK' } : {}) }),
        recheck: async () => ({}),
      },
      accounts: list, report: () => null,
      timer: (ms) => { timers.push(ms); return () => undefined; },
      focus: () => () => undefined,
      show: () => undefined,
    };
    const flow = startPlanSetup('codex', env);
    for (let i = 0; i < 20 && !timers.length; i += 1) await flush();
    assert.deepEqual(timers, [away ? AWAY_WAIT_MS : SIGN_IN_WAIT_MS]);
    assert.deepEqual(awaySignIn.value, away ? { id: 'acc_new', url: DEVICE, code: 'FR4A-CONBK' } : null);
    list.value = [account('acc_new', 'codex', 'ok')];
    assert.equal((await flow.done).ok, true);
    awaySignIn.value = null;
  }
});

test('the sheet: one button per plan, the texts the contract names, the result handed on by every add path', () => {
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const read = (file: string) => readFileSync(path.join(app, 'src', file), 'utf8');
  const sheet = read('ui/settings/SignInSheet.tsx');
  for (const text of ['Copy code and sign in', 'Device sign-in off? Turn it on once in ChatGPT › Settings › Security.', 'Open sign-in', 'Code from the page', '>Done<']) {
    assert.ok(sheet.includes(text), `"${text}"`);
  }
  assert.match(sheet, /<Dialog /, 'the existing dialog primitive');
  assert.match(sheet, /<DialogActions message=/, 'the error sits in the reserved message line – nothing shifts');
  assert.match(read('ui/settings/ModelSetup.tsx'), /<SignInSheet \/>/);
  assert.match(read('ui/settings/ModelSetup.tsx'), /signInStarted\(added\.id, added\.provider, added\)/);
  assert.match(read('ui/settings/AccountRow.tsx'), /signInStarted\(added\.id, added\.provider, added\)/);
  assert.match(read('ui/settings/account-actions.ts'), /signInStarted\(id, provider, result\)/);
});
