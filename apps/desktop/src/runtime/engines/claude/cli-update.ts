// Keeps Claude Code current with its own updater (`claude update`, native and npm installs alike). Claude Code learns a
// new model only with a new version (live 09.11.2026: 2.1.303 knew no Fable 5.2, 2.1.321 did), and the engines run it
// only in print mode, which never updates itself – an npm install stayed weeks behind. So the runtime asks for an update
// shortly after start and every 6 h; when the version changed, the catalog lists the Claude accounts again and the new
// models are there. The install is the PC's – other profiles and the person's own terminals share it – so only a profile
// with a Claude account in use on this PC updates it, and a test profile (WORKFORCE_TEST_DATA) never does (FIXES-4 G3).
// Owns: when the update runs (not while a Claude process of the runtime runs: on Windows a running claude.exe blocks
// replacing it), its 10-minute limit and reading the outcome from its output.
// Never: installs Claude Code where none is found (accounts/install.ts does on request), runs in demo mode, or logs output.

import type { Supervisor } from '../../system/supervisor.ts';
import type { ExecutableFinder } from '../../accounts/executables.ts';
import { runCli } from '../../accounts/cli.ts';
import type { Account } from '../../../shared/model/providers.ts';

export interface ClaudeUpdateDeps {
  supervisor: Supervisor;
  finder: ExecutableFinder;
  log: { info(msg: string, data?: Record<string, unknown>): void; warn(msg: string, data?: Record<string, unknown>): void };
  /** After a new version was installed (the catalog lists the Claude accounts again). */
  onUpdated(): void;
  /** This profile's accounts, read at each attempt. */
  accounts(): readonly Pick<Account, 'provider' | 'enabled' | 'deviceId'>[];
  /** Default: the runtime's own WORKFORCE_TEST_DATA (`env` is only the update process's). */
  testProfile?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  demo?: boolean;
  timeoutMs?: number;
}

export type ClaudeUpdateOutcome = 'updated' | 'current' | 'busy' | 'missing' | 'unused' | 'failed';

const UPDATE_TIMEOUT_MS = 10 * 60_000;
const FIRST_AFTER_MS = 2 * 60_000;
const EVERY_MS = 6 * 60 * 60_000;
const RETRY_MS = 10 * 60_000;
/** "Successfully updated from 2.1.303 to version 2.1.321" (2.1.303). */
const UPDATED = /successfully updated|updated from .* to/i;

/** True while a Claude process of the runtime runs (turns, checks, probes): their lease owners start with "claude". */
export function claudeBusy(supervisor: Pick<Supervisor, 'leases'>): boolean {
  return supervisor.leases().some((lease) => lease.owner.startsWith('claude'));
}

/** True when a Claude account of this profile is on and runs on this PC, outside a test profile. */
function claudeInUse(deps: Pick<ClaudeUpdateDeps, 'accounts' | 'testProfile'>): boolean {
  if (deps.testProfile ?? Boolean(process.env.WORKFORCE_TEST_DATA)) return false;
  return deps.accounts().some((account) => account.provider === 'claude' && account.enabled && !account.deviceId);
}

/** One update attempt. */
export async function updateClaudeCode(deps: ClaudeUpdateDeps): Promise<ClaudeUpdateOutcome> {
  if (deps.demo) return 'missing';
  if (!claudeInUse(deps)) return 'unused';
  const exe = await deps.finder.find('claude');
  if (!exe) return 'missing';
  if (claudeBusy(deps.supervisor)) return 'busy';
  const result = await runCli(deps.supervisor, exe, ['update'], {
    env: deps.env, cwd: deps.cwd, timeoutMs: deps.timeoutMs ?? UPDATE_TIMEOUT_MS, owner: 'claude-update', maxBytes: 64 * 1024,
  }).catch(() => undefined);
  if (!result || result.timedOut || result.code !== 0) {
    deps.log.warn('Claude Code update failed', { code: result?.code ?? null, timedOut: result?.timedOut ?? false });
    return 'failed';
  }
  if (!UPDATED.test(`${result.stdout}\n${result.stderr}`)) return 'current';
  deps.finder.clear();
  deps.log.info('Claude Code updated');
  deps.onUpdated();
  return 'updated';
}

/**
 * Starts the update cycle (first shortly after start, then every 6 h); a busy runtime, or a profile whose first Claude
 * account is not there yet, tries again in 10 min (that retry only reads the account list). Returns stop.
 */
export function keepClaudeCodeCurrent(deps: ClaudeUpdateDeps & { firstAfterMs?: number; everyMs?: number; retryMs?: number }): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const plan = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      void updateClaudeCode(deps)
        .catch(() => 'failed' as const)
        .then((outcome) => plan(outcome === 'busy' || outcome === 'unused' ? deps.retryMs ?? RETRY_MS : deps.everyMs ?? EVERY_MS));
    }, ms);
    timer.unref?.();
  };
  plan(deps.firstAfterMs ?? FIRST_AFTER_MS);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
