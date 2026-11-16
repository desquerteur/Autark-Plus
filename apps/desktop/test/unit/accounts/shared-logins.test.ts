// One plan login per PC (16.11.2026, accounts/cli-homes.ts + adoption.ts + service.ts): two companies on one PC share its
// logins folder. A login one company made is adopted by the other at its next detect – switched on, checked, its row
// pointing at that same home (no copy) – unless that company has the home or the person's login already, or the login is
// signed out; removing it in one company drops only that row (the home and the other company's row stay, and it is not
// adopted back there); signing out in one company signs the login out for both: the other takes no linked PC's login into
// it and does not report the sign-out as unexpected. A Codex login found in the default home joins another company's home
// of that e-mail only for the same workspace. Fake homes in a temp folder, the account harness's scripted CLIs.
// Owns: these assertions only. Never: a real CLI, account or login.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Account } from '../../../src/shared/model/providers.ts';
import { attachRelogin } from '../../../src/runtime/accounts/failure.ts';
import { CliHomes, readNote, signedOut } from '../../../src/runtime/accounts/cli-homes.ts';
import { harness, row } from './harness.ts';

const credentials = (refresh: string, expiresAt = 1_793_900_000_000) => JSON.stringify({ claudeAiOauth: { accessToken: `a-${refresh}`, refreshToken: refresh, expiresAt, scopes: [], subscriptionType: 'max' } });

/** One PC with two companies: both account services on one logins folder; Codex is signed in nowhere. */
function pc(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'shared-logins-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logins = path.join(root, 'logins');
  const company = () => {
    const h = harness({ accounts: logins, homeDir: path.join(root, 'user') });
    h.login.codex = false;
    const reported: Account[] = [];
    attachRelogin(h.service, { signedOut: (account: Account) => { reported.push(account); } } as never);
    return { ...h, reported };
  };
  /** A Claude Code home in the logins folder with a login file (none: signed out) and its note. */
  const home = (id: string, login: string | undefined, email?: string) => {
    const dir = path.join(logins, 'claude', id);
    mkdirSync(dir, { recursive: true });
    if (login) writeFileSync(path.join(dir, '.credentials.json'), login);
    if (email) writeFileSync(path.join(dir, '.autark-login.json'), JSON.stringify({ email }));
    return dir;
  };
  return { root, logins, first: company(), second: company(), home };
}

test('a login made in one company is adopted by the other at its next detect: switched on, checked, the same home', async (t) => {
  const { logins, first, second, home } = pc(t);
  const dir = home('acc_lena', credentials('r1'), 'lena@example.com');
  first.repo.save(row('acc_lena', { provider: 'claude', auth: 'cli', home: dir, email: 'lena@example.com' }));
  home('acc_out', undefined, 'out@example.com'); // signed out: nothing to adopt
  home('acc_max', credentials('r2'), 'max@example.com'); // the second company has Max's login in a home of before
  second.repo.save(row('acc_old', { provider: 'claude', auth: 'cli', home: path.join(logins, '..', 'company-2', 'accounts', 'claude', 'acc_old'), email: 'max@example.com' }));

  await second.service.detect();
  await second.settle();
  const adopted = second.service.get('acc_lena');
  assert.ok(adopted, 'Lena\'s login is a plan of the second company too');
  assert.deepEqual([adopted.home, adopted.enabled, adopted.state, adopted.label, adopted.email], [dir, true, 'ok', 'Claude Code 2', 'lena@example.com']);
  assert.ok(second.checks.includes('acc_lena'), 'and checked at once');
  assert.deepEqual(second.service.list().map((account) => account.id).sort(), ['acc_lena', 'acc_old'], 'no row for a signed-out login or a person it has already');
  assert.deepEqual(readdirSync(path.join(logins, 'claude')).sort(), ['acc_lena', 'acc_max', 'acc_out'], 'no copy, no new home');

  await second.service.detect(true);
  await second.settle();
  assert.equal(second.service.list().length, 2, 'detecting again doubles nothing');
  await first.service.detect();
  await first.settle();
  assert.deepEqual(first.service.list().map((account) => account.id).sort(), ['acc_lena', 'acc_max'], 'the first company keeps its row and adopts Max\'s login');
});

test('a Codex login found in the default home runs in another company\'s home of that e-mail only when it is the same workspace', (t) => {
  const { root, logins } = pc(t);
  const user = path.join(root, 'user');
  const idToken = `h.${Buffer.from(JSON.stringify({ email: 'lena@example.com' })).toString('base64url')}.s`;
  const auth = (workspace: string, refresh: string, at: string) => JSON.stringify({ tokens: { id_token: idToken, access_token: `a-${refresh}`, refresh_token: refresh, account_id: workspace }, last_refresh: at });
  mkdirSync(path.join(user, '.codex'), { recursive: true });
  writeFileSync(path.join(user, '.codex', 'auth.json'), auth('ws-business', 'b1', '2026-11-16T10:00:00Z'));
  const personal = path.join(logins, 'codex', 'acc_personal'); // another company's home: the same e-mail, the personal workspace
  mkdirSync(personal, { recursive: true });
  writeFileSync(path.join(personal, 'auth.json'), auth('ws-personal', 'p1', '2026-11-15T10:00:00Z'));
  writeFileSync(path.join(personal, '.autark-login.json'), JSON.stringify({ email: 'lena@example.com' }));
  const homes = new CliHomes({
    accounts: logins, env: {}, homeDir: user, repo: { list: () => [] } as never, save: (account) => account, blank: () => { throw new Error('unused'); },
    login: async () => ({ started: false }), require: () => { throw new Error('unused'); }, mkdir: async () => {},
  });
  const business = homes.found(row('acc_new', { provider: 'codex', auth: 'cli' }));
  assert.equal(business.home, path.join(logins, 'codex', 'acc_new'), 'the business workspace gets a home of its own');
  assert.equal(JSON.parse(readFileSync(path.join(business.home!, 'auth.json'), 'utf8')).tokens.account_id, 'ws-business');
  assert.equal(JSON.parse(readFileSync(path.join(personal, 'auth.json'), 'utf8')).tokens.account_id, 'ws-personal', 'the personal one stays as it was');

  writeFileSync(path.join(personal, 'auth.json'), auth('ws-business', 'b0', '2026-11-15T10:00:00Z')); // the same workspace there
  assert.equal(homes.found(row('acc_two', { provider: 'codex', auth: 'cli' })).home, personal, 'the same login: its one home');
});

test('the home\'s note names the login\'s e-mail once a check knows it – the other company adopts by it', async (t) => {
  const { logins, first, home } = pc(t);
  const dir = home('acc_new', credentials('r1'));
  first.repo.save(row('acc_new', { provider: 'claude', auth: 'cli', home: dir, state: 'unknown' }));
  first.answers.set('acc_new', { state: 'ok', plan: 'max', email: 'lena@example.com' });
  await first.service.check('acc_new');
  assert.equal(readNote(dir).email, 'lena@example.com');
  assert.equal(readNote(path.join(logins, 'claude', 'acc_none')).email, undefined);
});

test('removing it in one company drops only that row: the home and the other company\'s row stay, and it is not adopted back', async (t) => {
  const { logins, first, second, home } = pc(t);
  const dir = home('acc_lena', credentials('r1'), 'lena@example.com');
  first.repo.save(row('acc_lena', { provider: 'claude', auth: 'cli', home: dir, email: 'lena@example.com' }));
  await second.service.detect();
  await second.settle();
  assert.ok(second.service.get('acc_lena'));

  await second.service.remove('acc_lena');
  assert.equal(second.service.get('acc_lena'), undefined);
  assert.deepEqual(readdirSync(path.join(logins, 'claude')), ['acc_lena'], 'the login\'s home stays');
  assert.equal(first.service.get('acc_lena')?.home, dir, 'the first company keeps using it');
  await second.service.detect(true);
  await second.settle();
  assert.equal(second.service.get('acc_lena'), undefined, 'removed here: the next detect does not adopt it again');
});

test('signing out in one company signs the one login out for both: no linked PC\'s login comes back, no unexpected sign-out is reported', async (t) => {
  const { first, second, home } = pc(t);
  const dir = home('acc_lena', credentials('r1'), 'lena@example.com');
  first.repo.save(row('acc_lena', { provider: 'claude', auth: 'cli', home: dir, email: 'lena@example.com' }));
  await second.service.detect();
  await second.settle();
  const theirs = second.service.get('acc_lena')!;
  assert.equal(theirs.state, 'ok');

  await first.service.logout('acc_lena');
  const logout = first.calls.find((call) => call.args.join(' ') === 'auth logout');
  assert.equal(logout?.options.env?.CLAUDE_CONFIG_DIR, dir, 'the CLI signs out in the one home');
  assert.equal(signedOut.has(second.db, theirs), true, 'the mark is the home\'s: the second company sees it too');
  second.answers.set('acc_lena', { state: 'needs_login', message: 'Not logged in' });
  assert.equal((await second.service.check('acc_lena', true)).state, 'needs_login');
  assert.deepEqual([first.reported, second.reported], [[], []], 'the person\'s own sign-out is no sign-in work in either company');

  second.answers.set('acc_lena', { state: 'ok', plan: 'max' }); // the person signs in again (in either company)
  await second.service.check('acc_lena');
  assert.equal(signedOut.has(first.db, first.service.get('acc_lena')!), false, 'a working login ends the mark for both');
});
