// A company as a whole, out and in again (owner 16.11.2026: "vielleicht auch früher exportieren, kann man sie einfach
// irgendwo importieren wieder. in autark"). Export = a new folder "<name> <time>" inside the chosen one: the backup of
// this company (backup.ts, the same as system.backup) plus secrets.csv with the secrets' values readable
// (secrets/export.ts) – a backup's own values stay bound to the folder that wrote them, so another place reads them from
// that file. Import = an export (or any backup folder) becomes a new company on this PC: a new folder beside the others,
// the restore staged in it (restore.ts), then main opens it (companies.open) and its first start puts the data in,
// making its own identity there (machine-bound.ts forgetBound). No new format.
// Owns: the export folder and the new company's folder with its staged restore. Never: writes into another company's
// folder, starts a company itself (main does), or puts secrets.csv into a data folder (restore.ts leaves it out).

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { WorkforceError } from '../../shared/errors.ts';
import { nextCompanyId } from '../../shared/model/companies.ts';
import type { RuntimeServices } from '../contracts.ts';
import { exportSecrets } from '../secrets/export.ts';
import { EXPORT_SECRETS, MANIFEST_FILE, checkBackup, isInside, stamp } from './backup.ts';
import { stageRestore } from './restore.ts';

/** A name that is safe as a folder name on every OS ('' when nothing is left). */
const folderName = (text: string): string => text.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60);

/** The export's own new folder inside `dir`: "<name> <time>", " (2)" … when taken. */
function exportFolder(dir: string, name: string, now: number): string {
  const base = path.join(dir, `${folderName(name) || 'Autark company'} ${stamp(now)}`);
  for (let n = 1; ; n += 1) {
    const folder = n > 1 ? `${base} (${n})` : base;
    if (!existsSync(folder)) return folder;
  }
}

/**
 * Exports this company into a new folder inside `dir` (absolute, outside its data folder): the backup through `backup`
 * (Portability.backup – one at a time), then secrets.csv beside it. Returns the folder, its size and the secrets written.
 */
export async function exportCompany(
  services: Pick<RuntimeServices, 'db' | 'host' | 'secrets' | 'clock' | 'paths' | 'settings'>,
  backup: (dir: string) => Promise<{ path: string; bytes: number }>,
  dir: string, name: string,
): Promise<{ path: string; bytes: number; secrets: number }> {
  if (isInside(dir, services.paths.data)) throw new WorkforceError('bad_request', 'Choose a folder outside the company\'s data folder for the export.');
  const made = await backup(exportFolder(dir, name, services.clock.now()));
  const secrets = await exportSecrets(services, { file: path.join(made.path, EXPORT_SECRETS) });
  return { path: made.path, bytes: made.bytes, secrets: secrets.count };
}

/** Makes the export (or backup folder, or its manifest.json) at `target` a new company here and opens it; its first start puts the data in. */
export async function importCompany(services: Pick<RuntimeServices, 'host' | 'clock' | 'log'>, target: string): Promise<{ ok: true; id: string }> {
  const { host } = services;
  const info = host.app.companies;
  if (!info || !host.openCompany) throw new WorkforceError('unavailable', 'Companies are imported only in the desktop app.');
  const folder = path.basename(target) === MANIFEST_FILE ? path.dirname(target) : path.resolve(target);
  checkBackup(folder);
  let taken: string[] = [];
  try { taken = readdirSync(info.dir); } catch { /* no other company yet */ }
  const id = nextCompanyId(taken);
  const dir = path.join(info.dir, id);
  mkdirSync(dir, { recursive: true });
  stageRestore(dir, folder, services.clock.now());
  services.log.info('company import staged', { id, from: folder });
  await host.openCompany({ id });
  return { ok: true, id };
}
