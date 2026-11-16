// Detection → accounts (split from service.ts): the cached DetectionReport (one scan at a time;
// dismissed entries marked; one that could not tell an installed CLI's login is scanned again on the
// next detect), adoption of what a scan found – logins in the default CLI homes and running local servers become
// 'detected' accounts unless the person removed them (dismissed.ts); a Codex login runs on a copy in a home of its own
// (cli-homes.ts found) – the checks a scan triggers, and "Add again" for a dismissed login.
// 16.11.2026: a plan login another company on this PC made (its home in the PC's logins folder, cli-homes.ts sharedLogins)
// becomes an account here too, switched on and checked – one login, one home, every company – unless a row here uses that
// home or the same person's login (provider and e-mail) already, or the person removed it here.
// Owns: the report cache and the adoption rules. Never: scans itself (detect.ts), signs in or deletes.

import { foundHere, type Account, type DetectionReport, type ProviderId } from '../../shared/model/providers.ts';
import { isPlanProvider } from '../../shared/model/plan-roles.ts';
import { WorkforceError } from '../../shared/errors.ts';
import type { AccountRepo } from './repo.ts';
import { homeLoginKey, loginKey, serverKey, type DismissedLogins } from './dismissed.ts';
import { envKey } from './env-keys.ts';
import { loginUnknown } from './detect.ts';
import { homeKey, sameEmail, type SharedLogin } from './cli-homes.ts';
import { PROVIDER_LABELS } from './service-shape.ts';

/** Providers whose logins live in a CLI home (default or <accounts>/<provider>/<id>; Gemini CLI and Copilot CLI only the default, PR8). */
export const CLI_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>(['codex', 'claude', 'gemini-cli', 'copilot', 'kimi-cli']);

export interface AdoptionDeps {
  repo: AccountRepo;
  dismissed: DismissedLogins;
  /** Stores and announces an account (AccountService). */
  save(account: Account): Account;
  /** A new account row with the service's defaults (label, priority, id). */
  blank(provider: ProviderId, patch: Partial<Account>): Account;
  /** A found login as its account (cli-homes.ts CliHomes.found: Codex in a home of its own with a copy of the login). */
  found(account: Account): Account;
  /** This PC's plan logins in its logins folder, whichever company made them (cli-homes.ts sharedLogins). */
  shared(): SharedLogin[];
  /** One check in the account monitor's serial queue. */
  checkOnce(id: string): void;
  scan(): Promise<DetectionReport>;
  env(): NodeJS.ProcessEnv;
  now(): number;
  /** Demo/test mode: an empty report – real logins are never detected. */
  demo?: boolean;
}

export class Adoption {
  private readonly deps: AdoptionDeps;
  private report: DetectionReport | undefined;
  private detecting: Promise<DetectionReport> | undefined;

  constructor(deps: AdoptionDeps) { this.deps = deps; }

  /** The last scan's report (no scan), dismissed logins and servers marked like detect(); undefined before the first. */
  cached(): DetectionReport | undefined { return this.report && this.deps.dismissed.mark(this.report); }

  /**
   * The cached report (a new scan when forced, none yet, or the last one could not tell an installed
   * CLI's login – detect.ts loginUnknown, e.g. a status command that timed out), dismissed logins and servers marked.
   */
  async detect(force: boolean): Promise<DetectionReport> {
    if (this.report && !force && !loginUnknown(this.report)) return this.deps.dismissed.mark(this.report);
    if (this.deps.demo) return (this.report = { clis: [], localServers: [], envKeys: [], checkedAt: this.deps.now() });
    if (!this.detecting) {
      this.detecting = this.deps.scan()
        .then((report) => { this.report = report; this.adopt(report); return report; })
        .finally(() => { this.detecting = undefined; });
    }
    return this.deps.dismissed.mark(await this.detecting);
  }

  /**
   * Creates 'detected' accounts for logins in the default CLI homes and running local servers (idempotent),
   * except dismissed ones. One check each (the monitor's queue): a new plan login, a detected login whose
   * sign-in changed outside Workforce (signed out → needs_login), an 'error' account whose CLI is
   * installed again and an environment key that is set again; a key that is gone is 'needs_login'.
   */
  adopt(report: DetectionReport): void {
    const { repo, dismissed } = this.deps;
    const existing = repo.list();
    const gone = new Set(dismissed.list());
    for (const cli of report.clis) {
      if (!CLI_PROVIDERS.has(cli.provider as ProviderId)) continue;
      const provider = cli.provider as ProviderId;
      const own = existing.find((a) => a.provider === provider && foundHere(a));
      const signInChanged = own?.enabled && cli.loggedIn !== undefined && cli.loggedIn === (own.state === 'needs_login');
      if (own) { if (signInChanged) this.deps.checkOnce(own.id); continue; }
      if (!cli.loggedIn || gone.has(loginKey(provider))) continue;
      const adopted = this.deps.save(this.deps.found(this.deps.blank(provider, { auth: 'cli', state: 'ok', detected: true })));
      if (isPlanProvider(provider)) this.deps.checkOnce(adopted.id);
    }
    this.adoptShared(gone);
    for (const server of report.localServers) {
      if (gone.has(serverKey(server.provider, server.baseUrl)) || existing.some((a) => a.provider === server.provider && a.baseUrl === server.baseUrl)) continue;
      this.deps.save(this.deps.blank(server.provider, { auth: 'local', baseUrl: server.baseUrl, state: 'ok', detected: true }));
    }
    const installed = new Set<string>(report.clis.filter((cli) => cli.path).map((cli) => cli.provider)); // a CLI missing at a failed turn may be back
    for (const account of existing.filter((a) => a.state === 'error' && a.enabled && installed.has(a.provider))) this.deps.checkOnce(account.id);
    for (const account of existing.filter((a) => a.auth === 'env' && a.enabled)) { // the variable may be gone or back since the last start
      const set = envKey(account, this.deps.env()) !== undefined;
      if (!set && account.state !== 'needs_login') this.deps.save({ ...account, state: 'needs_login' });
      else if (set && account.state === 'needs_login') this.deps.checkOnce(account.id);
    }
  }

  /** Another company's plan login on this PC as an account here (its id the home's folder name), switched on, then checked. */
  private adoptShared(gone: ReadonlySet<string>): void {
    for (const login of this.deps.shared()) {
      const rows = this.deps.repo.list();
      const mine = rows.some((a) => (a.home && homeKey(a.home) === homeKey(login.home)) || (a.provider === login.provider && sameEmail(a.email, login.email)));
      if (mine || login.signedIn === false || gone.has(homeLoginKey(login.provider, login.home)) || rows.some((a) => a.id === login.id)) continue;
      const same = rows.filter((a) => a.provider === login.provider).length;
      const label = PROVIDER_LABELS[login.provider]!;
      const adopted = this.deps.save({ ...this.deps.blank(login.provider, { auth: 'cli', state: 'unknown', home: login.home, label: same ? `${label} ${same + 1}` : label, ...(login.email ? { email: login.email } : {}) }), id: login.id });
      this.deps.checkOnce(adopted.id);
    }
  }

  /** "Add again": the dismissed default-home login becomes an account again if this PC still has it. */
  async addAgain(provider: ProviderId, label: string): Promise<Account> {
    if (!CLI_PROVIDERS.has(provider)) throw new WorkforceError('bad_request', 'Only a sign-in found on this PC can be added again.');
    this.deps.dismissed.delete(loginKey(provider));
    const signedIn = (report: DetectionReport | undefined) => report?.clis.some((cli) => cli.provider === provider && cli.loggedIn) === true;
    const report = signedIn(this.report) ? this.report! : await this.detect(true);
    this.adopt(report); // idempotent; also covers a scan that was already running when the dismissal ended
    const account = this.deps.repo.list().find((a) => a.provider === provider && foundHere(a));
    if (!account) throw new WorkforceError('not_found', `No ${label} sign-in was found on this PC.`);
    return account;
  }
}
