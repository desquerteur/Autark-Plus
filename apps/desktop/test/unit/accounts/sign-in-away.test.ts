// B-091: a plan sign-in from the phone ("away") finishes on the phone. Codex runs `login --device-auth` and hands back
// its page and one-time code (read from the coloured lines after "one-time code"); Claude Code runs as usual with
// stdin piped and BROWSER set to a no-op, hands back its page with `paste`, and code() writes the page's code to the
// CLI's stdin, waits for it to end and the account check, and answers ok. A PC sign-in and an away one replace each
// other on the person's own call (an agent's never ends the phone's); no running away sign-in → "The sign-in ended – start it again."; the code is never logged.
// Owns: nothing in production. Never starts a real CLI (scripted children).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_MS, SignIns } from '../../../src/runtime/accounts/sign-in.ts';
import { Supervisor } from '../../../src/runtime/system/supervisor.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import type { Account } from '../../../src/shared/model/providers.ts';
import { account, fakeFinder, fakeOs, fakeSpawn, tick, type SpawnCall } from '../engines/fakes.ts';
import { harness } from './harness.ts';

const DEVICE_URL = 'https://auth.openai.com/codex/device';
const CLAUDE_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=c1&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s2';
const C = (code: number) => `\u001b[${code}m`;

/** SignIns whose sign-ins print what `print` writes; the account state the check leaves is `h.state`. */
function rig(print: (call: SpawnCall) => void = () => {}, urlWaitMs = 2_000) {
  const logged: unknown[] = [];
  const checks: string[] = [];
  const { spawn, calls } = fakeSpawn(print);
  const supervisor = new Supervisor({ spawn, os: fakeOs(), killTree: async () => {}, log: { warn: (...args: unknown[]) => { logged.push(args); } } });
  const h = { state: 'needs_login' as Account['state'], calls, logged, checks, service: undefined as unknown as SignIns };
  h.service = new SignIns({
    finder: fakeFinder({ codex: '/bin/codex', claude: '/bin/claude' }), supervisor, env: {}, now: () => 0, urlWaitMs,
    label: (provider) => provider, check: async (id) => { checks.push(id); }, state: () => h.state,
  });
  return h;
}

const later = (stream: NodeJS.WritableStream, ...chunks: string[]) => setImmediate(() => { for (const chunk of chunks) stream.write(chunk); });

test('codex away: login --device-auth, the page and the one-time code from the coloured lines; nothing else changes', async () => {
  const h = rig((call) => {
    if (!call.args.includes('--device-auth')) return;
    later(call.child.stdout,
      `\n${C(1)}Welcome to Codex${C(0)}\n1. Open this link in your browser and sign in to your account\n   ${C(94)}${DEVICE_URL}${C(0)}\n\n`,
      `2. Enter this one-time code ${C(90)}(expires in 15 minutes)${C(0)}\n`, `   ${C(94)}FR4A-`, `CONBK${C(0)}\n`);
  });
  const codex = account({ id: 'acc_codex', provider: 'codex', home: '/data/accounts/codex/acc_codex' });
  assert.deepEqual(await h.service.login(codex, true, true), { started: true, url: DEVICE_URL, code: 'FR4A-CONBK' }, 'the code on the line after its label, split over chunks');
  assert.deepEqual(h.calls[0].args, ['login', '--device-auth']);
  assert.deepEqual(h.calls[0].options.stdio, ['ignore', 'pipe', 'pipe'], 'no stdin for Codex');
  assert.equal(h.calls[0].options.env?.BROWSER, undefined);
  assert.deepEqual(await h.service.login(codex, true, true), { started: true, url: DEVICE_URL, code: 'FR4A-CONBK' }, 'asked again while it runs: the same page and code');
  assert.equal(h.calls.length, 1);
  await assert.rejects(h.service.code('acc_codex', 'FR4A-CONBK'), (error: unknown) => error instanceof WorkforceError && error.message === 'The sign-in ended – start it again.', 'nothing to paste for Codex');
  assert.equal(AWAY_MS, 15 * 60_000, 'device codes expire after 15 min');
  assert.deepEqual(h.logged, []);
  await h.service.dispose();
});

test('a PC sign-in and an away one replace each other', async () => {
  const h = rig(() => {}, 0);
  const claude = account({ id: 'acc_claude', provider: 'claude' });
  await h.service.login(claude);
  await h.service.login(claude, true, true);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].child.killed, true, 'the PC sign-in made way for the phone\'s');
  assert.deepEqual(h.calls[1].options.stdio, ['pipe', 'pipe', 'pipe']);
  await h.service.login(claude, true, true);
  assert.equal(h.calls.length, 2, 'the same kind again: no new process');
  assert.deepEqual(await h.service.login(claude, false), { started: true }, 'an agent\'s accounts.sign_in (no page)…');
  assert.equal(h.calls.length, 2, '…never ends the person\'s phone sign-in');
  assert.equal(h.calls[1].child.killed, false);
  await h.service.login(claude);
  assert.equal(h.calls.length, 3);
  await h.service.dispose();
});

test('claude away: BROWSER opens nothing, the page comes back with paste; code() writes the code and answers ok once it works', async () => {
  const h = rig((call) => {
    later(call.child.stdout, `Opening browser to sign in…\nIf the browser didn't open, visit: ${CLAUDE_URL}\n`, 'Paste code here if prompted > ');
    call.child.onLine = (line, child) => { if (line === 'abc#XYZ-good') h.state = 'ok'; child.exit(h.state === 'ok' ? 0 : 1); };
  });
  const claude = account({ id: 'acc_claude', provider: 'claude', home: '/data/accounts/claude/acc_claude' });
  assert.deepEqual(await h.service.login(claude, true, true), { started: true, url: CLAUDE_URL, paste: true });
  assert.deepEqual(h.calls[0].args, ['auth', 'login', '--claudeai']);
  assert.deepEqual(h.calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(h.calls[0].options.env?.BROWSER, process.platform === 'win32' ? 'C:\\Windows\\System32\\where.exe' : '/usr/bin/true');
  assert.equal(h.calls[0].options.env?.CLAUDE_CONFIG_DIR, '/data/accounts/claude/acc_claude');

  // A wrong code: the CLI ends with an error, the account stays signed out.
  assert.deepEqual(await h.service.code('acc_claude', '  wrong  '), { ok: false });
  assert.deepEqual(h.calls[0].child.lines, ['wrong'], 'trimmed, one line');
  assert.deepEqual(h.checks, ['acc_claude'], 'checked after it ended');
  await assert.rejects(h.service.code('acc_claude', 'abc#XYZ-good'), (error: unknown) => error instanceof WorkforceError && error.code === 'not_found');

  // Open sign-in again: a fresh process takes the right code.
  assert.deepEqual(await h.service.login(claude, true, true), { started: true, url: CLAUDE_URL, paste: true });
  assert.deepEqual(await h.service.code('acc_claude', ' abc#XYZ-good '), { ok: true });
  assert.deepEqual(h.calls[1].child.lines, ['abc#XYZ-good']);
  await tick();
  assert.ok(!JSON.stringify(h.logged).includes('abc#XYZ'), 'the code is never logged');
  await h.service.dispose();
});

test('a PC sign-in takes no pasted code; no sign-in at all → "start it again"', async () => {
  const h = rig(() => {}, 0);
  await h.service.login(account({ id: 'acc_pc', provider: 'claude' }));
  assert.deepEqual(h.calls[0].options.stdio, ['ignore', 'pipe', 'pipe'], 'stdin stays closed at the PC');
  assert.equal(h.calls[0].options.env?.BROWSER, undefined, 'the PC browser opens as before');
  for (const id of ['acc_pc', 'acc_none']) {
    await assert.rejects(h.service.code(id, 'abc'), (error: unknown) => error instanceof WorkforceError && error.code === 'not_found' && error.message === 'The sign-in ended – start it again.', id);
  }
  await h.service.dispose();
});

test('the account service: add/login away hand code/paste beside the page (never stored); loginCode finishes the Claude sign-in', async () => {
  const h = harness({ signInUrlMs: 2_000 });
  const pending = h.service.add({ provider: 'codex' }, { away: true });
  while (!h.signIns.length) await tick();
  assert.deepEqual(h.signIns[0].args, ['login', '--device-auth']);
  h.signIns[0].child.stdout.write(`1. Open this link\n   ${DEVICE_URL}\n2. Enter this one-time code (expires in 15 minutes)\n   AB12-CDE34\n`);
  const codex = await pending;
  assert.deepEqual([codex.signInUrl, codex.code, codex.paste], [DEVICE_URL, 'AB12-CDE34', undefined]);
  assert.ok(!JSON.stringify([h.service.list(), h.upserts]).includes('AB12-CDE34'), 'no stored row or event carries the code');

  const adding = h.service.add({ provider: 'claude' }, { away: true });
  while (h.signIns.length < 2) await tick();
  const signIn = h.signIns[1];
  signIn.child.stdout.write(`visit: ${CLAUDE_URL}\n`);
  const claude = await adding;
  assert.deepEqual([claude.signInUrl, claude.paste, claude.code], [CLAUDE_URL, true, undefined]);
  assert.deepEqual(await h.service.login(claude.id, { page: true, away: true }), { started: true, url: CLAUDE_URL, paste: true }, 'Open sign-in again while it runs');
  signIn.child.onLine = (_line, child) => { child.exit(0); }; // the account check answers signed in
  assert.deepEqual(await h.service.loginCode(claude.id, 'the-code'), { ok: true });
  assert.deepEqual(signIn.child.lines, ['the-code']);
  await assert.rejects(h.service.loginCode('acc_missing', 'x'), (error: unknown) => error instanceof WorkforceError && error.code === 'not_found');
  h.signIns[0].child.exit(0);
  await h.settle();
  await h.service.dispose();
});
