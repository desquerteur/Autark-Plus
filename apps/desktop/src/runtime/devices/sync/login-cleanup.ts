// 17.11.2026 (Noah's security look at "Only on this PC"): an account another PC takes back (the person kept it on that PC, or removed it) leaves the
// login files that were already copied here. The copy that sync wrote – <accounts>/<provider>/<account id>, named by the account's own id – loses its
// login files (auth.json, .credentials.json …) with the row, so no token stays on a PC the person did not choose. Never the home of another company's
// account, a CLI's default home (~/.codex …), a home shared with another row, or a path outside the accounts folder.
// Owns: which login files are removed with a dropped account. Never: removes the account row (accounts.remove does), a folder, or a note.

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { homeKey, loginFiles } from '../../accounts/cli-homes.ts';
import type { Account } from '../../../shared/model/providers.ts';

/** The login files this PC wrote for `account` when it arrived by sync (its own folder in the accounts folder), else none. */
export function ownLoginFiles(accounts: string, account: Pick<Account, 'id' | 'provider' | 'auth' | 'home'>, others: ReadonlyArray<Pick<Account, 'id' | 'home'>>, platform: NodeJS.Platform = process.platform): string[] {
  if (account.auth !== 'cli' || !account.home || !/^[\w-]{1,100}$/.test(account.id) || !/^[\w-]{1,40}$/.test(account.provider)) return [];
  const own = path.join(accounts, account.provider, account.id);
  if (homeKey(account.home) !== homeKey(own)) return []; // a default home, another company's folder, a path of the person's own
  if (others.some((other) => other.id !== account.id && other.home && homeKey(other.home) === homeKey(own))) return []; // another row here uses the same login
  return loginFiles(account.provider, platform).map((name) => path.join(own, name));
}

/** Removes those files (each one alone; a missing file is fine). Resolves to how many were removed or already gone. */
export async function removeLoginFiles(files: readonly string[]): Promise<number> {
  let gone = 0;
  for (const file of files) {
    try { await rm(file, { force: true }); gone++; } catch { /* the sign-in stays; the row is gone anyway */ }
  }
  return gone;
}
