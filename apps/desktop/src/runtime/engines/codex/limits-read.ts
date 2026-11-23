// Codex limits read on the app server: `account/rateLimits/read`. A background read (the account monitor's cadence) sends
// `excludeResetCreditDetails` – Codex then skips the separate reset-credit detail lookup and still reports how many there
// are; the person opening the limits (Settings › Models & accounts, the quota card) and the read after a reset was used ask
// for the details – accounts/limits.ts mergeLimits keeps the stored details meanwhile.
// Owns: this request's parameters. Never: normalizes or stores the answer (engine.ts, accounts/limits.ts do).

import type { RpcClient } from './rpc.ts';

/** The raw `account/rateLimits/read` answer; `details` false skips the reset credits' detail lookup. */
export function readRateLimits(rpc: Pick<RpcClient, 'request'>, details: boolean): Promise<unknown> {
  return rpc.request('account/rateLimits/read', details ? {} : { excludeResetCreditDetails: true });
}
