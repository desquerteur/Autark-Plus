// 16.11.2026 taking a company off this PC (src/main/company-remove.ts) on real temp folders with a fake bin, start
// registration and notice: the mark goes first, the only company stays, a bad or unknown id is refused before anything;
// the company open here hands over to the next one (a running one shows, else the first one left starts) and quits
// after the answer, hidden it only quits; another running one is asked to remove itself, then swept. The sweep waits
// while a company still runs, takes its start at sign-in off before the bin, moves another company's whole folder,
// and the first company's data into one folder beside the others – Electron's own entries, the mark and this PC's
// logins folder stay. A bin that refuses keeps everything and says where; an old mark's failure is only logged.
// HostServices routes company.remove.
// Owns: these assertions only. Never: starts a process, uses the real bin or touches the real data folders.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { companiesDir } from '../../../src/main/companies.ts';
import { moveFirstData, removeCompany, sweepRemoved, type RemoveDeps, type SweepDeps } from '../../../src/main/company-remove.ts';
import { HostServices, type HostServicesDeps } from '../../../src/main/host-services.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { REMOVED_FILE } from '../../../src/shared/model/companies.ts';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'wf-company-remove-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A PC with the first company (a data entry and Electron's own) and company-2 / company-3, plus the logins folder. */
function pc() {
  const first = path.join(tmp, `pc-${++n}`, 'Autark');
  const dir = companiesDir(first);
  mkdirSync(path.join(first, 'agents'), { recursive: true });
  writeFileSync(path.join(first, 'workforce.db'), 'db');
  writeFileSync(path.join(first, 'settings.json'), '{}');
  mkdirSync(path.join(first, 'Local Storage'), { recursive: true });
  writeFileSync(path.join(first, 'Local State'), '{}');
  writeFileSync(path.join(first, 'Preferences'), '{}');
  for (const id of ['company-2', 'company-3']) { mkdirSync(path.join(dir, id, 'agents'), { recursive: true }); writeFileSync(path.join(dir, id, 'workforce.db'), 'db'); }
  mkdirSync(path.join(dir, 'logins', 'claude', 'home-1'), { recursive: true });
  return { first, dir, companies: { first, dir } };
}

function removeDeps(companies: { first: string; dir: string }, current: string | null, visible = true) {
  const calls: string[] = [];
  const deps: RemoveDeps = {
    companies, current, now: () => 1_000, visible: () => visible,
    spawn: (args) => { calls.push(`spawn ${args.join(' ')}`.trim()); },
    quit: () => { calls.push('quit'); },
    call: async (dir, id) => { calls.push(`call ${path.basename(dir)} ${id}`); return true; },
    sweep: () => { calls.push('sweep'); },
    setTimer: (fn) => { calls.push('tick'); fn(); },
  };
  return { calls, deps };
}

const code = async (run: () => Promise<unknown>) => { try { await run(); return 'none'; } catch (error) { return (error as WorkforceError).code; } };

test('company.remove: a bad or unknown id and the only company are refused before anything; the mark names it', async () => {
  const p = pc();
  const r = removeDeps(p.companies, 'company-2');
  assert.equal(await code(() => removeCompany({ id: '../x' } as never, r.deps)), 'bad_request');
  assert.equal(await code(() => removeCompany({ id: 'company-9' }, r.deps)), 'not_found');
  assert.deepEqual(r.calls, []);
  assert.deepEqual(await removeCompany({ id: 'company-3', name: 'Side Shop' }, r.deps), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(path.join(p.dir, 'company-3', REMOVED_FILE), 'utf8')), { at: 1_000, name: 'Side Shop' });
  assert.deepEqual(r.calls, ['sweep'], 'it does not run: straight to the sweep');
  assert.equal(await code(() => removeCompany({ id: 'company-3' }, r.deps)), 'not_found', 'once marked it is gone from here');
  await removeCompany({ id: null }, r.deps);
  assert.equal(await code(() => removeCompany({ id: 'company-2' }, removeDeps(p.companies, null).deps)), 'conflict', 'the only company left stays');
  assert.ok(!existsSync(path.join(p.dir, 'company-2', REMOVED_FILE)));
});

test('company.remove of the company open here: its window hands over to the next one, then it quits; hidden it only quits', async () => {
  const p = pc();
  const shown = removeDeps(p.companies, 'company-2');
  await removeCompany({ id: 'company-2' }, shown.deps);
  assert.deepEqual(shown.calls, ['spawn', 'tick', 'quit'], 'the first company (none running) starts, then this one quits after the answer');
  assert.ok(existsSync(path.join(p.dir, 'company-2', REMOVED_FILE)));
  const q = pc();
  writeFileSync(path.join(q.dir, 'company-3', 'runtime.json'), JSON.stringify({ port: 1, token: 'tok', pid: process.pid })); // company-3 runs
  const prefer = removeDeps(q.companies, null);
  await removeCompany({ id: null }, prefer.deps);
  assert.deepEqual(prefer.calls, ['spawn --company=company-3', 'tick', 'quit'], 'a running company shows itself first');
  const hidden = removeDeps(pc().companies, 'company-3', false);
  await removeCompany({ id: 'company-3' }, hidden.deps);
  assert.deepEqual(hidden.calls, ['tick', 'quit'], 'asked by another company (its window hidden): it only quits');
});

test('company.remove of another running company asks it to remove itself, then sweeps', async () => {
  const p = pc();
  writeFileSync(path.join(p.dir, 'company-3', 'runtime.json'), JSON.stringify({ port: 1, token: 'tok', pid: process.pid }));
  const r = removeDeps(p.companies, 'company-2');
  await removeCompany({ id: 'company-3' }, r.deps);
  assert.deepEqual(r.calls, ['call company-3 company-3', 'sweep']);
});

function sweepDeps(companies: { first: string; dir: string }, options: { refuse?: boolean; now?: number } = {}) {
  const trashed: string[] = [];
  const unregistered: Array<string | null> = [];
  const notices: string[] = [];
  const lines: string[] = [];
  const deps: SweepDeps = {
    companies, now: () => options.now ?? 2_000, waitMs: 300, pollMs: 10, graceMs: 0,
    trash: async (folder) => {
      if (options.refuse) throw new Error('the bin refused');
      trashed.push(folder);
      renameSync(folder, path.join(tmp, `bin-${++n}`)); // the bin takes the whole folder
    },
    unregister: async (id) => { unregistered.push(id); },
    notify: (title, body) => { notices.push(`${title}: ${body}`); },
    log: (line) => { lines.push(line); },
  };
  return { deps, trashed, unregistered, notices, lines };
}

test('the sweep moves another company\'s whole folder after its start at sign-in went; the logins folder stays', async () => {
  const p = pc();
  writeFileSync(path.join(p.dir, 'company-3', REMOVED_FILE), JSON.stringify({ at: 1_500, name: 'Side Shop' }));
  const s = sweepDeps(p.companies);
  assert.deepEqual(await sweepRemoved(s.deps), [{ id: 'company-3', removed: true }]);
  assert.deepEqual(s.trashed, [path.join(p.dir, 'company-3')]);
  assert.deepEqual(s.unregistered, ['company-3']);
  assert.deepEqual(s.notices, ['Company removed: Side Shop is in the recycle bin.']);
  assert.ok(existsSync(path.join(p.dir, 'company-2', 'workforce.db')) && existsSync(path.join(p.dir, 'logins', 'claude', 'home-1')), 'the others and the logins stay');
  assert.deepEqual(await sweepRemoved(s.deps), [], 'nothing marked any more');
});

test('the first company: its data goes in one folder to the bin; Electron\'s entries and the mark stay; all or nothing', async () => {
  const p = pc();
  writeFileSync(path.join(p.first, REMOVED_FILE), JSON.stringify({ at: 1_900 }));
  const s = sweepDeps(p.companies);
  assert.deepEqual(await sweepRemoved(s.deps), [{ id: null, removed: true }]);
  assert.equal(s.trashed.length, 1);
  assert.match(path.basename(s.trashed[0]), /^first – removed \d{4}-\d\d-\d\d \d{4}$/);
  assert.equal(path.dirname(s.trashed[0]), p.dir, 'beside the companies, never a company id');
  assert.deepEqual(readdirSync(p.first).sort(), [REMOVED_FILE, 'Local State', 'Local Storage', 'Preferences'].sort(), 'Electron\'s own entries and the mark stay');
  assert.deepEqual(s.unregistered, [null]);
  assert.deepEqual(s.notices, ['Company removed: first is in the recycle bin.']);
  assert.deepEqual(await sweepRemoved(s.deps), [], 'nothing of it left to move');

  const q = pc();
  const holder = moveFirstData(q.companies, 0);
  const again = moveFirstData({ first: path.join(tmp, 'empty-first'), dir: q.dir }, 0);
  assert.notEqual(again, holder, 'a second holder of the same minute gets its own name');
  assert.deepEqual(readdirSync(holder).sort(), ['agents', 'settings.json', 'workforce.db']);
});

test('a company that still runs is not moved; a bin that refuses keeps it and says where; an old mark only goes into the log', async () => {
  const p = pc();
  writeFileSync(path.join(p.dir, 'company-3', 'runtime.json'), JSON.stringify({ port: 1, token: 'tok', pid: process.pid })); // this test process stands in
  writeFileSync(path.join(p.dir, 'company-3', REMOVED_FILE), JSON.stringify({ at: 1_990, name: 'Side Shop' }));
  const running = sweepDeps(p.companies);
  assert.deepEqual(await sweepRemoved(running.deps), [{ id: 'company-3', removed: false }]);
  assert.deepEqual(running.trashed, []);
  assert.deepEqual(running.unregistered, [], 'its start at sign-in stays while it runs');
  assert.match(running.notices[0] ?? '', /^Company not removed: Side Shop did not end/);
  rmSync(path.join(p.dir, 'company-3', 'runtime.json'));
  const refused = sweepDeps(p.companies, { refuse: true });
  assert.deepEqual(await sweepRemoved(refused.deps), [{ id: 'company-3', removed: false }]);
  assert.deepEqual(refused.notices, [`Company not removed: The recycle bin did not take Side Shop. Its folder stays in ${path.join(p.dir, 'company-3')}.`]);
  assert.ok(existsSync(path.join(p.dir, 'company-3', 'workforce.db')) && existsSync(path.join(p.dir, 'company-3', REMOVED_FILE)), 'kept, still marked for the next start');
  const later = sweepDeps(p.companies, { refuse: true, now: 1_990 + 11 * 60_000 });
  await sweepRemoved(later.deps);
  assert.deepEqual(later.notices, [], 'an old mark is not told again at every start');
  assert.ok(later.lines.some((line) => line.startsWith('company company-3 not removed')));
});

test('HostServices routes company.remove to company-remove.ts; without it (a test profile) it is unavailable', async () => {
  const seen: unknown[] = [];
  const deps = { removeCompany: async (args: unknown) => { seen.push(args); return { ok: true }; } } as unknown as HostServicesDeps;
  assert.deepEqual(await new HostServices(deps).handle({ id: 1, type: 'host', op: 'company.remove', args: { id: 'company-2', name: 'X' } }), { ok: true });
  assert.deepEqual(seen, [{ id: 'company-2', name: 'X' }]);
  await assert.rejects(new HostServices({} as unknown as HostServicesDeps).handle({ id: 2, type: 'host', op: 'company.remove', args: { id: null } }), (error: WorkforceError) => error.code === 'unavailable');
});
