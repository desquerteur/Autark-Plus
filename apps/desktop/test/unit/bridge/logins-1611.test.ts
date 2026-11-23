// Bridge 16.11.2026 (bridge/logins-1611.ts): two companies on one PC with copies of one login move their homes of before
// into the PC's logins folder – one home per login, both rows pointing at it, the newest login file in it, nothing lost
// and no copy left – in either start order; a second start changes nothing; a home that cannot move, whose folder there
// holds another person's login, or whose login sits in the macOS Keychain stays where it is and keeps working; a start cut off between the rename and the row
// finishes the next time; a live company's lock is waited for, a dead one's taken over by one waiter only; sign-out marks
// move into the homes' notes. One e-mail with two plans (Codex workspaces, Claude organisations) stays two logins; a joined
// row restored to its home of before points at that login's home again. The service runs the bridge at its start. Fake
// homes and logins in a temp folder.
// Owns: these assertions only. Never: a real CLI, login or data folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import type { Account } from '../../../src/shared/model/providers.ts';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate } from '../../../src/runtime/db/migrate.ts';
import { AccountRepo } from '../../../src/runtime/accounts/repo.ts';
import { KvRepo } from '../../../src/runtime/store/kv.ts';
import { readNote, signedOut, SIGNED_OUT } from '../../../src/runtime/accounts/cli-homes.ts';
import { moveLoginHomes } from '../../../src/runtime/bridge/logins-1611.ts';
import { harness, row } from '../accounts/harness.ts';

const claude = (refresh: string, expiresAt: number) => JSON.stringify({ claudeAiOauth: { accessToken: `a-${refresh}`, refreshToken: refresh, expiresAt, scopes: [], subscriptionType: 'max' } });
const codex = (refresh: string, at: string) => JSON.stringify({ tokens: { id_token: 'id', access_token: `a-${refresh}`, refresh_token: refresh, account_id: 'org-1' }, last_refresh: at });
const silent = { info: () => {}, warn: () => {} };

function machine(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'logins-1611-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logins = path.join(root, 'Autark Companies', 'logins');
  /** A company: its data folder, database and rows; `home` writes a home of before with its login file and other files. */
  const company = (data: string) => {
    const db = new Db(':memory:');
    migrate(db);
    const repo = new AccountRepo(db);
    const home = (provider: 'claude' | 'codex', id: string, login: string, extra: Partial<Account> = {}) => {
      const dir = path.join(data, 'accounts', provider, id);
      mkdirSync(path.join(dir, provider === 'claude' ? 'projects' : 'sessions'), { recursive: true });
      writeFileSync(path.join(dir, provider === 'claude' ? '.credentials.json' : 'auth.json'), login);
      writeFileSync(path.join(dir, provider === 'claude' ? '.claude.json' : 'config.toml'), `${id} settings`);
      repo.save(row(id, { provider, auth: 'cli', home: dir, ...extra }));
      return dir;
    };
    const move = (tries = 100, platform: NodeJS.Platform = 'win32') => moveLoginHomes({ db, repo, legacy: path.join(data, 'accounts'), logins, log: silent, platform, tries });
    return { data, db, repo, home, move };
  };
  return { root, logins, first: company(path.join(root, 'Autark')), second: company(path.join(root, 'Autark Companies', 'company-2')) };
}

const file = (home: string, name: string) => readFileSync(path.join(home, name), 'utf8');

for (const order of ['older company first', 'newer company first'] as const) {
  test(`two companies with copies of one login → one home, both rows point at it, the newest login in it, nothing lost (${order})`, async (t) => {
    const { logins, first, second } = machine(t);
    // The old company's copies are older (switched off for the clash), the newer company's refreshed today.
    const firstClaude = first.home('claude', 'acc_f1', claude('old', 1_000), { email: 'Lena@Example.com', enabled: false, state: 'disabled' });
    const firstCodex = first.home('codex', 'acc_fx', codex('old', '2026-11-15T17:36:00Z'), { email: 'lena@example.com', detected: true });
    const secondClaude = second.home('claude', 'acc_s1', claude('new', 2_000), { email: 'lena@example.com' });
    const secondCodex = second.home('codex', 'acc_sx', codex('new', '2026-11-16T08:00:00Z'), { email: 'lena@example.com', detected: true });
    second.home('claude', 'acc_s2', claude('max', 3_000), { email: 'max@example.com' }); // only this company has Max's login
    const starts = order === 'older company first' ? [first, second] : [second, first];
    for (const company of starts) await company.move(); // resolves once the joined copies' old folders are gone

    const claudeHomes = readdirSync(path.join(logins, 'claude')).sort();
    const codexHomes = readdirSync(path.join(logins, 'codex'));
    assert.equal(claudeHomes.length, 2, 'Lena\'s login and Max\'s: one home each');
    assert.equal(codexHomes.length, 1);
    const lena = first.repo.get('acc_f1')!.home!;
    assert.equal(second.repo.get('acc_s1')!.home, lena, 'both rows point at the one home');
    assert.equal(second.repo.get('acc_sx')!.home, first.repo.get('acc_fx')!.home);
    assert.equal(path.dirname(lena), path.join(logins, 'claude'));
    assert.equal(file(lena, '.credentials.json'), claude('new', 2_000), 'the newest login is in it');
    assert.equal(file(first.repo.get('acc_fx')!.home!, 'auth.json'), codex('new', '2026-11-16T08:00:00Z'));
    assert.equal(file(second.repo.get('acc_s2')!.home!, '.credentials.json'), claude('max', 3_000), 'Max\'s home moved whole');
    assert.equal(readNote(lena).email?.toLowerCase(), 'lena@example.com', 'its note names the login');
    for (const dir of [firstClaude, firstCodex, secondClaude, secondCodex]) assert.equal(existsSync(dir), false, 'no copy stays behind');
    const winner = order === 'older company first' ? 'acc_f1' : 'acc_s1';
    assert.equal(file(lena, '.claude.json'), `${winner} settings`, 'the home that moved first is the one that stays, with its own files');
    assert.ok(existsSync(path.join(lena, 'projects')));
    assert.deepEqual([first.repo.get('acc_f1')!.enabled, second.repo.get('acc_s1')!.enabled], [false, true], 'each row keeps its own switch');

    for (const company of starts) await company.move(); // the next start
    assert.deepEqual(readdirSync(path.join(logins, 'claude')).sort(), claudeHomes, 'a second start changes nothing');
    assert.equal(first.repo.get('acc_f1')!.home, lena);
  });
}

test('safety: a home that cannot move stays where it is and keeps working; a folder holding another person\'s login is never joined', (t) => {
  const { logins, first, second } = machine(t);
  const kept = first.home('claude', 'acc_f1', claude('r1', 1_000), { email: 'lena@example.com' });
  mkdirSync(logins, { recursive: true });
  writeFileSync(path.join(logins, 'claude'), 'not a folder'); // the home cannot move there
  first.move();
  assert.equal(first.repo.get('acc_f1')!.home, kept, 'the row still points at its home');
  assert.equal(file(kept, '.credentials.json'), claude('r1', 1_000), 'with its login');
  rmSync(path.join(logins, 'claude'));
  rmSync(logins, { recursive: true });
  writeFileSync(logins, 'not a folder'); // nor when the logins folder itself cannot be made
  first.move();
  assert.equal(first.repo.get('acc_f1')!.home, kept);
  rmSync(logins);

  const other = path.join(logins, 'claude', 'acc_s1');
  mkdirSync(other, { recursive: true });
  writeFileSync(path.join(other, '.autark-login.json'), JSON.stringify({ email: 'max@example.com' }));
  const mine = second.home('claude', 'acc_s1', claude('r2', 2_000), { email: 'lena@example.com' }); // the same folder name, another person there
  second.move();
  assert.equal(second.repo.get('acc_s1')!.home, mine, 'kept in place');
  assert.equal(file(mine, '.credentials.json'), claude('r2', 2_000));
  first.move(); // now it can move: into a home of its own (the other folder names Max)
  assert.equal(path.dirname(first.repo.get('acc_f1')!.home!), path.join(logins, 'claude'));
  assert.equal(file(first.repo.get('acc_f1')!.home!, '.credentials.json'), claude('r1', 1_000));

  // On a Mac, Claude Code keeps the login in the Keychain under the folder's path: that home stays where it works.
  const mac = first.home('claude', 'acc_mac', claude('r3', 3_000), { email: 'mia@example.com' });
  first.move(100, 'darwin');
  assert.equal(first.repo.get('acc_mac')!.home, mac);
  assert.ok(existsSync(mac));
});

test('a start cut off between the rename and the row finishes next time; the lock of a live company is waited for, a gone one\'s taken over', (t) => {
  const { logins, first } = machine(t);
  const dir = first.home('codex', 'acc_fx', codex('r1', '2026-11-15T17:36:00Z'));
  mkdirSync(path.join(logins, 'codex'), { recursive: true });
  writeFileSync(path.join(logins, '.move.lock'), String(process.pid)); // another company moves right now
  first.move(2);
  assert.equal(first.repo.get('acc_fx')!.home, dir, 'nothing moves under a live lock');
  assert.equal(file(dir, 'auth.json'), codex('r1', '2026-11-15T17:36:00Z'));
  writeFileSync(path.join(logins, '.move.lock'), '2147483646'); // its process is gone
  const moved = path.join(logins, 'codex', 'acc_fx');
  renameSync(dir, moved); // the cut-off start: the folder moved, the row still names the old one
  first.move(2);
  assert.equal(first.repo.get('acc_fx')!.home, moved);
  assert.equal(file(moved, 'auth.json'), codex('r1', '2026-11-15T17:36:00Z'));
  assert.equal(existsSync(path.join(logins, '.move.lock')), false, 'the lock is released');
});

test('one e-mail with two plans (two Codex workspaces, two Claude organisations) stays two logins: nothing is joined or deleted', async (t) => {
  const { logins, first, second } = machine(t);
  const workspace = (refresh: string, at: string, id: string) => JSON.stringify({ tokens: { id_token: 'id', access_token: `a-${refresh}`, refresh_token: refresh, account_id: id }, last_refresh: at });
  first.home('codex', 'acc_fx', workspace('personal', '2026-11-15T10:00:00Z', 'ws-personal'), { email: 'lena@example.com' });
  const business = second.home('codex', 'acc_sx', workspace('business', '2026-11-16T10:00:00Z', 'ws-business'), { email: 'lena@example.com' });
  const firstClaude = first.home('claude', 'acc_f1', claude('team', 1_000), { email: 'lena@example.com' });
  const secondClaude = second.home('claude', 'acc_s1', claude('max', 2_000), { email: 'lena@example.com' });
  writeFileSync(path.join(firstClaude, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'lena@example.com', organizationUuid: 'org-team' } }));
  writeFileSync(path.join(secondClaude, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'lena@example.com', organizationUuid: 'org-personal' } }));
  await first.move();
  await second.move();

  const [personalHome, businessHome] = [first.repo.get('acc_fx')!.home!, second.repo.get('acc_sx')!.home!];
  assert.notEqual(personalHome, businessHome, 'two homes');
  assert.equal(JSON.parse(file(personalHome, 'auth.json')).tokens.account_id, 'ws-personal', 'the personal workspace keeps its login');
  assert.equal(JSON.parse(file(businessHome, 'auth.json')).tokens.account_id, 'ws-business', 'the business one too, moved whole');
  assert.equal(path.dirname(businessHome), path.join(logins, 'codex'));
  assert.equal(existsSync(business), false, 'moved, not copied');
  assert.notEqual(first.repo.get('acc_f1')!.home, second.repo.get('acc_s1')!.home);
  assert.equal(file(second.repo.get('acc_s1')!.home!, '.credentials.json'), claude('max', 2_000));
  assert.equal(file(first.repo.get('acc_f1')!.home!, '.credentials.json'), claude('team', 1_000));
});

test('a joined row restored to its home of before (a backup from before the move) points at that login\'s home again', async (t) => {
  const { first, second } = machine(t);
  first.home('claude', 'acc_f1', claude('r1', 1_000), { email: 'lena@example.com' });
  first.home('claude', 'acc_f2', claude('m1', 1_000), { email: 'max@example.com' });
  const old = second.home('claude', 'acc_s1', claude('r2', 2_000), { email: 'lena@example.com' });
  await first.move();
  await second.move();
  const [lena, max] = [first.repo.get('acc_f1')!.home!, first.repo.get('acc_f2')!.home!];
  assert.equal(second.repo.get('acc_s1')!.home, lena);
  second.repo.save({ ...second.repo.get('acc_s1')!, home: old }); // the restore: its home of before, deleted by the join
  const elsewhere = path.join(path.dirname(second.data), 'company-3', 'accounts', 'claude', 'acc_f2');
  second.repo.save(row('acc_imp', { provider: 'claude', auth: 'cli', home: elsewhere, email: 'max@example.com' })); // an imported row: another data folder's home
  await second.move();
  assert.equal(second.repo.get('acc_s1')!.home, lena, 'the same login\'s home');
  assert.equal(second.repo.get('acc_imp')!.home, max, 'by its folder name');
  assert.equal(file(lena, '.credentials.json'), claude('r2', 2_000));
});

test('a gone holder\'s lock is taken over by one waiter only: a lock another waiter made meanwhile stays', async (t) => {
  const { logins, first } = machine(t);
  const dir = first.home('codex', 'acc_fx', codex('r1', '2026-11-15T17:36:00Z'));
  const lockFile = path.join(logins, '.move.lock');
  mkdirSync(logins, { recursive: true });
  writeFileSync(lockFile, '2147483646'); // its process is gone
  const living = String(process.pid); // a living waiter that took the gone lock over between this one's look and its own step
  const read = fs.readFileSync;
  let raced = false;
  fs.readFileSync = ((...args: unknown[]) => {
    const text = (read as (...all: unknown[]) => unknown)(...args);
    if (!raced && String(args[0]) === lockFile) { raced = true; rmSync(lockFile); writeFileSync(lockFile, living); }
    return text;
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  t.after(() => { fs.readFileSync = read; syncBuiltinESMExports(); });
  await first.move(3);
  fs.readFileSync = read;
  syncBuiltinESMExports();
  assert.ok(raced);
  assert.equal(readFileSync(lockFile, 'utf8'), living, 'the other waiter keeps its lock');
  assert.equal(first.repo.get('acc_fx')!.home, dir, 'and this one moves nothing while it holds it');
  assert.ok(existsSync(dir));
});

test('sign-out marks of rows with a home move into the homes\' notes; the 0.3.8 handoff marker goes', (t) => {
  const { first } = machine(t);
  const dir = first.home('claude', 'acc_f1', claude('r1', 1_000));
  new KvRepo(first.db).set(SIGNED_OUT, 'acc_f1', true, 1);
  writeFileSync(path.join(first.data, '.claude-home-registry.json'), '{}');
  first.move();
  const account = first.repo.get('acc_f1')!;
  assert.notEqual(account.home, dir);
  assert.equal(signedOut.has(first.db, account), true, 'still signed out – now for every company using the home');
  assert.equal(new KvRepo(first.db).get(SIGNED_OUT, 'acc_f1'), undefined);
  assert.equal(existsSync(path.join(first.data, '.claude-home-registry.json')), false);
});

test('the account service moves this company\'s homes at its start, before anything uses them', async (t) => {
  const { logins, first } = machine(t);
  const dir = first.home('claude', 'acc_f1', claude('r1', 1_000), { email: 'lena@example.com' });
  const h = harness({ db: first.db, accounts: logins, data: first.data });
  assert.equal(h.service.get('acc_f1')!.home, path.join(logins, 'claude', 'acc_f1'));
  assert.equal(existsSync(dir), false);
  await h.service.dispose();
});
