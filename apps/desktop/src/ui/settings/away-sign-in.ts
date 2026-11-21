// B-091: a plan sign-in the person finishes on their phone. The runtime starts it "away" when the call comes from a
// device (accounts.login / accounts.add) and returns the page with Codex's one-time code (`code`) or Claude Code's
// `paste`; the PC never gets either, so its CLI keeps opening the PC's browser. The sheet (SignInSheet.tsx) shows it and
// closes itself with a toast once the account works – Codex: its CLI ends on its own after the code was entered on the
// page; Claude Code: the code the page showed, handed back with accounts.loginCode. One opened on an account that
// already worked waits for an accepted code or the person's own close.
// Owns: the open sheet and these steps. Never: logs or keeps a code, or decides account state (the runtime does).

import { effect, signal } from '@preact/signals';
import type { AwaySignIn } from '../../shared/api/methods-providers.ts';
import { rpc } from '../lib/rpc.ts';
import { accounts } from '../lib/store.ts';
import { pushToast } from '../lib/toasts.ts';

/**
 * The open sheet: its account, the page, Codex's code; `failed`: the last Claude Code code was not accepted;
 * `working`: the account already worked when it opened (a switch of login) – only an accepted code or the person closes it.
 */
export interface AwaySheet { id: string; url: string; code?: string; failed?: true; working?: true }

export const awaySignIn = signal<AwaySheet | null>(null);

export const CODE_FAILED = 'That code did not work – open sign-in again.';

const usable = (state: string | undefined): boolean => state === 'ok' || state === 'cooling';

/** Opens the sheet for a sign-in result with `code` or `paste`; false: none (the PC's browser has the sign-in). */
export function openAwaySignIn(id: string, result: { url?: string; signInUrl?: string } & AwaySignIn): boolean {
  const url = result.url ?? result.signInUrl;
  if (!url || !(result.code || result.paste)) return false;
  const working = usable(accounts.peek().find((account) => account.id === id)?.state);
  awaySignIn.value = { id, url, ...(result.code ? { code: result.code } : {}), ...(working ? { working: true as const } : {}) };
  return true;
}

function signedIn(id: string): void {
  if (awaySignIn.peek()?.id !== id) return;
  awaySignIn.value = null;
  pushToast({ title: `${accounts.peek().find((account) => account.id === id)?.label ?? 'Account'} signed in` });
}

// the sheet closes itself once the account store shows its account working (again)
effect(() => {
  const sheet = awaySignIn.value;
  if (sheet && !sheet.working && usable(accounts.value.find((entry) => entry.id === sheet.id)?.state)) signedIn(sheet.id);
});

/**
 * Claude Code: hands the code from the page to the waiting sign-in. A code that did not work starts a fresh sign-in
 * right away, so the next "Open sign-in" tap opens its page directly (a page opened after a wait is blocked by the
 * phone's browser).
 */
export async function submitCode(code: string): Promise<void> {
  const sheet = awaySignIn.peek();
  if (!sheet) return;
  const ok = await rpc.call('accounts.loginCode', { id: sheet.id, code }).then((result) => result.ok, () => false);
  if (ok) return signedIn(sheet.id);
  if (awaySignIn.peek()?.id !== sheet.id) return;
  const again = await rpc.call('accounts.login', { id: sheet.id }).catch(() => undefined);
  if (awaySignIn.peek()?.id === sheet.id) awaySignIn.value = { ...sheet, url: again?.url ?? sheet.url, failed: true };
}
