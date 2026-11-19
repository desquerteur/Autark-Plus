// Feedback 1b136d01 (owner 19.11.2026: "wenn ein PC noch nicht geupdatet ist, dass man dann praktisch den Update-Button
// sieht … und darunter steht der PC-Name von dem anderen PC und man kann ihn dann per PC einfach updaten mit einem Klick"):
// system.update presses a PC's own Update button – here (host.update: a fresh check of the official feed, then the same
// download and install as the button) or, with `device`, on a linked own PC over the mesh ('system.update', CEO links only:
// an employer's or employee's PC never updates another's). What gets installed is always the official update of that PC's
// own feed, never a file from the caller.
// Owns: the forward and the serve. Never: decides the version or installs a file itself.

import { WorkforceError } from '../../../shared/errors.ts';
import type { RuntimeServices } from '../../contracts.ts';
import { DevicesRepo } from '../repo.ts';
import { linkOf, selfId } from './home.ts';

/** The mesh method a linked own PC answers. */
export const UPDATE_METHOD = 'system.update';

/** This PC's Update button. */
export async function updateHere(s: Pick<RuntimeServices, 'host'>): Promise<{ ok: true }> {
  if (!s.host.update) throw new WorkforceError('unavailable', 'This Autark runs without its app window, so it cannot update itself from here.');
  await s.host.update();
  return { ok: true };
}

/** The Update button of `device` (this PC itself when it is this one). */
export async function updateOn(s: RuntimeServices, device: string | undefined): Promise<{ ok: true }> {
  if (!device || device === selfId(s.db)) return updateHere(s);
  const record = new DevicesRepo(s.db).get(device);
  if (!record || linkOf(record)?.kind !== 'ceo') throw new WorkforceError('not_found', 'That PC is not one of your linked PCs.', { details: { deviceId: device } });
  if (!s.devices.online(device)) throw new WorkforceError('unavailable', `${record.name} is offline right now.`, { details: { deviceId: device, reachable: false } });
  await s.devices.call(device, UPDATE_METHOD, {});
  return { ok: true };
}

/** 'system.update' from a linked PC: only the owner's own PCs (the mesh registers it for CEO links). */
export async function serveUpdate(s: RuntimeServices, from: string): Promise<{ ok: true }> {
  if (linkOf(new DevicesRepo(s.db).get(from))?.kind !== 'ceo') throw new WorkforceError('forbidden', 'Only your own PCs update this PC.');
  return updateHere(s);
}
