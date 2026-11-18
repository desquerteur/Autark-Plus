// 17.11.2026 (Konrad task_bgykyzcx #109): a plan login the person kept "Only on this PC" (Account.thisPcOnly) never leaves it – not its account
// row (devices/sync/tables.ts accounts `view`), not its login files (devices/sync/logins.ts); once it is shared ("On all PCs of this company") it
// travels like any account, and when it is kept here again the other PCs drop it (the row sync's `retract`). An account that was shared before
// stays shared: the column is 0 for everything that exists (migration 105).
// Owns: these assertions only. Never: a real login or a second PC (the sync test harness, sync-net.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Account } from '../../../src/shared/model/providers.ts';
import type { AccountService, RuntimeServices } from '../../../src/runtime/contracts.ts';
import { AccountRepo } from '../../../src/runtime/accounts/repo.ts';
import { ownLoginFiles } from '../../../src/runtime/devices/sync/login-cleanup.ts';
import { link, makePc, Net, settle, type Pc } from './sync-net.ts';

const base = { label: 'Codex', state: 'ok', priority: 0, enabled: true, createdAt: 1 } as const;
const login = (patch: Partial<Account> = {}): Account => ({ ...base, id: 'acc_codex', provider: 'codex', auth: 'cli', detected: true, email: 'lena@example.com', ...patch });

/** Two linked PCs whose account service knows `get` and `remove` (what the row sync calls). */
function pcs() {
  const net = new Net();
  const a = makePc(net, 'dev_a');
  const b = makePc(net, 'dev_b');
  link(a, b);
  const removed: string[] = [];
  for (const pc of [a, b]) {
    const repo = new AccountRepo(pc.h.db);
    (pc.h.services as { paths: RuntimeServices['paths'] }).paths = { accounts: path.join('data', pc.id, 'accounts') } as RuntimeServices['paths'];
    pc.h.services.accounts = {
      get: (id: string) => repo.get(id),
      list: () => repo.list(),
      remove: async (id: string) => { if (pc === b) removed.push(id); repo.remove(id); },
    } as unknown as AccountService;
  }
  const save = (pc: Pc, account: Account) => { new AccountRepo(pc.h.db).save(account); pc.h.bus.emit('account.upserted', account); };
  const at = (pc: Pc) => new AccountRepo(pc.h.db).get('acc_codex');
  return { a, b, save, at, removed };
}

test('a login kept on this PC does not travel; shared it does; kept here again the other PC drops it', async () => {
  const { a, b, save, at, removed } = pcs();
  save(a, login({ thisPcOnly: true }));
  await settle();
  assert.equal(at(b), undefined, 'kept on A: B never gets the row');
  assert.equal(at(a)?.thisPcOnly, true);

  save(a, login()); // "On all PCs of this company"
  await settle();
  assert.equal(at(b)?.provider, 'codex', 'shared: it travels like any account');
  assert.equal(at(b)?.thisPcOnly, undefined, 'B has no say in A\'s choice: the column does not travel');

  save(a, login({ thisPcOnly: true })); // kept here again
  await settle();
  assert.equal(at(a)?.thisPcOnly, true);
  assert.deepEqual(removed, ['acc_codex'], 'B drops it');
  assert.equal(at(b), undefined);

  save(a, login()); // and shared once more: it comes back
  await settle();
  assert.equal(at(b)?.provider, 'codex');
});

test('an account that exists and was never kept here stays shared; an environment key still stays on its PC', async () => {
  const { a, b, save, at } = pcs();
  save(a, login());
  save(a, { ...base, id: 'acc_env', provider: 'openai', auth: 'env', envVar: 'OPENAI_API_KEY', detected: true });
  await settle();
  assert.equal(at(b)?.id, 'acc_codex');
  assert.equal(new AccountRepo(b.h.db).get('acc_env'), undefined);
});

test('kept on A after it was shared: B drops the row and the login file it copied (no token stays), nothing else in the folder', async (t) => {
  const { a, b, save, at, removed } = pcs();
  const accounts = mkdtempSync(path.join(os.tmpdir(), 'wf-login-'));
  t.after(() => rmSync(accounts, { recursive: true, force: true }));
  (b.h.services as { paths: RuntimeServices['paths'] }).paths = { accounts } as RuntimeServices['paths'];
  save(a, login());
  await settle();
  const home = at(b)?.home;
  assert.equal(home, path.join(accounts, 'codex', 'acc_codex'), 'sync wrote the home as the folder named by the account id');
  mkdirSync(home!, { recursive: true });
  writeFileSync(path.join(home!, 'auth.json'), '{"tokens":{}}');
  writeFileSync(path.join(home!, 'config.toml'), 'model = "x"');
  save(a, login({ thisPcOnly: true }));
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(removed, ['acc_codex']);
  assert.equal(existsSync(path.join(home!, 'auth.json')), false, 'the copied login is gone');
  assert.equal(existsSync(path.join(home!, 'config.toml')), true, 'only login files go, the CLI settings stay');
});

test('login files go only from a home sync made for this very account: not a default home, another folder, a home another row uses, or an odd id', () => {
  const accounts = path.join('data', 'accounts');
  const own = path.join(accounts, 'codex', 'acc_codex');
  const row = { id: 'acc_codex', provider: 'codex', auth: 'cli', home: own } as const;
  assert.deepEqual(ownLoginFiles(accounts, row, []), [path.join(own, 'auth.json')]);
  assert.deepEqual(ownLoginFiles(accounts, { ...row, home: path.join('home', 'me', '.codex') }, []), [], 'a CLI default home');
  assert.deepEqual(ownLoginFiles(accounts, { ...row, home: path.join(accounts, 'codex', 'acc_other') }, []), [], 'the folder of another account');
  assert.deepEqual(ownLoginFiles(accounts, row, [{ id: 'acc_two', home: own }]), [], 'another row here uses the same home');
  assert.deepEqual(ownLoginFiles(accounts, { ...row, id: '../x', home: path.join(accounts, 'codex', '..', 'x') }, []), [], 'an id that is no folder name');
  assert.deepEqual(ownLoginFiles(accounts, { ...row, auth: 'api_key' }, []), [], 'no plan login');
  assert.deepEqual(ownLoginFiles(accounts, { ...row, home: undefined }, []), []);
});
