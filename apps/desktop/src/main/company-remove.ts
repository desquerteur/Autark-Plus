// Taking a company off this PC (owner 16.11.2026: "die Firmen nur wie Konten ... austreten ... einfach löschen, mit dann
// noch mehrmals Abfrage"). company.remove writes the removal mark (shared/model/companies.ts REMOVED_FILE) – from then on
// no list, open, wake or start takes the company (companies.ts) – lets the company end and moves its folder to the
// recycle bin, never a hard delete: Electron's trashItem aborts what the bin cannot take, and the folder then stays,
// marked, for the next start to try again. The company open here may go too: when its window shows, the next company
// opens (a running one shows itself, else the first one left starts) and this one quits; that company's sweep – at its
// start or at the second start that showed it (desktop.ts) – moves this folder once this app has ended. Another running
// company is asked to remove itself over loopback (its companies.remove: hidden, it just quits) and moved once it ended.
// The first company's folder is the app's own: its data moves into one folder beside the companies ("first – removed
// <time>") that goes to the bin, while Electron's own entries (shared/model/electron-profile.ts) and the mark stay, so
// a plain start opens the next company from then on (companies.ts startingCompany). Its workspace (<home>/Workforce)
// stays where it is, and so does this PC's logins folder beside the companies (no company). Its start at sign-in goes
// before the bin. The only company on this PC stays.
// Owns: the mark, the order of these steps and the sweep. Never: imports electron (desktop.ts passes the bin, the
// start registration and the notice), deletes a file itself, or moves a company that still runs.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostOps } from '../shared/api/host-bridge.ts';
import { WorkforceError } from '../shared/errors.ts';
import { FIRST_FOLDER, folderOf, isCompanyId, REMOVED_FILE } from '../shared/model/companies.ts';
import { isElectronProfileEntry } from '../shared/model/electron-profile.ts';
import { companyArgs, folders, isRemoved, remainingCompanies, runtimeOf } from './companies.ts';

type Companies = { first: string; dir: string };

export interface RemoveDeps {
  companies: Companies;
  current: string | null; // this process's company
  now(): number;
  visible(): boolean; // this company's window shows: the person removed it from here
  spawn(args: string[]): void; // starts another company, or shows it where it runs
  quit(): void; // this app; called on the next tick, after the answer went out
  call(dir: string, id: string | null): Promise<boolean>; // asks another running company to remove itself (companies.ts callCompany)
  sweep(): void; // sweepRemoved in the background
  setTimer?(fn: () => void, ms: number): unknown;
}

/** A removal asked for this recently is told when it fails; an older mark's next try only goes into the log. */
const TOLD_MS = 10 * 60_000;

const isDir = (dir: string): boolean => { try { return statSync(dir).isDirectory(); } catch { return false; } };
const folderFor = (companies: Companies, id: string | null): string => (id === null ? companies.first : path.join(companies.dir, id));

/** Host op company.remove: marks the company, then it ends (this one: after the answer) and the sweep moves its folder. */
export async function removeCompany(args: HostOps['company.remove']['args'], deps: RemoveDeps): Promise<HostOps['company.remove']['result']> {
  const raw = args as { id?: unknown; name?: unknown };
  if (raw.id !== null && !isCompanyId(raw.id)) throw new WorkforceError('bad_request', 'Invalid company id: one from companies.list, or null for the first company.');
  const id = raw.id as string | null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  const dir = folderFor(deps.companies, id);
  const self = id === deps.current;
  if (!self && (!isDir(dir) || isRemoved(dir))) throw new WorkforceError('not_found', 'There is no company with this id on this PC (companies.list).');
  const left = remainingCompanies(deps.companies).filter((other) => other !== id);
  if (!left.length) throw new WorkforceError('conflict', 'This is the only company on this PC, so it stays. Another company comes first (the profile menu\'s "+").');
  if (!isRemoved(dir)) writeFileSync(path.join(dir, REMOVED_FILE), `${JSON.stringify({ at: deps.now(), ...(name ? { name } : {}) })}\n`);
  if (self) {
    if (deps.visible()) {
      const running = left.filter((other) => runtimeOf(folderFor(deps.companies, other)) !== null);
      const next = running.length ? running[0] : left[0]; // the first company's id is null: no ?? here
      try { deps.spawn(companyArgs(next)); } catch { /* the person opens it from the tray; this one still goes */ }
    }
    const later = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    later(() => deps.quit(), 0);
    return { ok: true };
  }
  if (runtimeOf(dir)) await deps.call(dir, id);
  deps.sweep();
  return { ok: true };
}

export interface SweepDeps {
  companies: Companies;
  now(): number;
  trash(folder: string): Promise<void>; // shell.trashItem
  unregister(id: string | null, dir: string): Promise<void>; // its start at sign-in off (launcher-tasks.ts applyLauncher)
  notify(title: string, body: string): void;
  log(line: string): void;
  /** How long a company may take to end and its folder to move (default 2 min), the pause between tries, the pause after its runtime ended. */
  waitMs?: number;
  pollMs?: number;
  graceMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** The mark's name (else the folder) and when it was written. */
function markOf(dir: string, id: string | null): { name: string; at?: number } {
  let mark: { name?: unknown; at?: unknown } = {};
  try { mark = JSON.parse(readFileSync(path.join(dir, REMOVED_FILE), 'utf8')) as typeof mark; } catch { /* the folder names it */ }
  const name = typeof mark.name === 'string' && mark.name.trim() ? mark.name.trim().slice(0, 80) : id ?? FIRST_FOLDER;
  return { name, ...(typeof mark.at === 'number' ? { at: mark.at } : {}) };
}

/** The first company's own entries: all but Electron's and the mark. */
const firstData = (first: string): string[] => {
  try { return readdirSync(first).filter((entry) => entry !== REMOVED_FILE && !isElectronProfileEntry(entry)); } catch { return []; }
};

/** Local time as "2026-11-16 1530" (a file name: no colon). */
function stamp(now: number): string {
  const d = new Date(now);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}`;
}

/** Moves the first company's data into "<companies>/first – removed <time>" (no company id); all or nothing. */
export function moveFirstData(companies: Companies, now: number): string {
  let holder = path.join(companies.dir, `${FIRST_FOLDER} – removed ${stamp(now)}`);
  for (let n = 2; existsSync(holder); n += 1) holder = path.join(companies.dir, `${FIRST_FOLDER} – removed ${stamp(now)} (${n})`);
  mkdirSync(holder, { recursive: true });
  const moved: string[] = [];
  try {
    for (const entry of firstData(companies.first)) {
      renameSync(path.join(companies.first, entry), path.join(holder, entry));
      moved.push(entry);
    }
  } catch (error) {
    for (const entry of moved.reverse()) { try { renameSync(path.join(holder, entry), path.join(companies.first, entry)); } catch { /* it stays in the holder */ } }
    try { rmdirSync(holder); } catch { /* not empty: what could not go back stays there */ }
    throw error;
  }
  return holder;
}

/** One marked company: waits until it ended, takes its start at sign-in off, moves its folder to the bin. True when it went. */
async function sweepOne(id: string | null, deps: SweepDeps): Promise<boolean> {
  const dir = folderFor(deps.companies, id);
  const { name, at } = markOf(dir, id);
  const told = at !== undefined && deps.now() - at < TOLD_MS;
  const until = Date.now() + (deps.waitMs ?? 120_000);
  const poll = deps.pollMs ?? 1_000;
  const fail = (body: string, line: string): false => {
    deps.log(`company ${folderOf({ id })} not removed: ${line}`);
    if (told) deps.notify('Company not removed', body);
    return false;
  };
  while (runtimeOf(dir)) {
    if (Date.now() >= until) return fail(`${name} did not end, so its folder stays here. It goes to the recycle bin at the next start.`, 'it still runs');
    await sleep(poll);
  }
  await sleep(deps.graceMs ?? 3_000); // its app closes after its runtime
  await deps.unregister(id, dir).catch((error: unknown) => deps.log(`company ${folderOf({ id })}: start at sign-in not removed: ${(error as Error)?.message ?? 'error'}`));
  let holder: string | undefined;
  for (;;) {
    try {
      if (id === null) holder ??= moveFirstData(deps.companies, deps.now());
      await deps.trash(holder ?? dir);
      deps.log(`company ${folderOf({ id })} moved to the recycle bin`);
      deps.notify('Company removed', `${name} is in the recycle bin.`);
      return true;
    } catch (error) {
      if (id !== null && !existsSync(dir)) return true; // another start moved it meanwhile
      if (Date.now() >= until) {
        const place = holder ?? dir;
        return fail(`The recycle bin did not take ${name}. Its folder stays in ${place}.`, `${(error as Error)?.message ?? 'error'} (${place})`);
      }
      await sleep(poll);
    }
  }
}

let sweeping: Promise<unknown> = Promise.resolve();

/**
 * Moves every marked company to the recycle bin once it has ended – one sweep at a time in this app (at its start, after
 * a removal, at a second start). The person hears of each one that went, and of a failure where the removal was asked
 * for in the last minutes; an older mark's failure only goes into the log. Never throws.
 */
export function sweepRemoved(deps: SweepDeps): Promise<Array<{ id: string | null; removed: boolean }>> {
  const run = sweeping.then(async () => {
    const { first, dir } = deps.companies;
    const marked: Array<string | null> = [
      ...(isRemoved(first) && firstData(first).length ? [null] : []),
      ...folders(dir).filter((id) => isCompanyId(id) && isRemoved(path.join(dir, id))),
    ];
    return Promise.all(marked.map(async (id) => ({ id, removed: await sweepOne(id, deps).catch(() => false) })));
  });
  sweeping = run.catch(() => undefined);
  return run.catch(() => []);
}
