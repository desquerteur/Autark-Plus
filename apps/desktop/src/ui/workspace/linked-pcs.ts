// The person's other PCs a file, folder or media tab can be opened on (B-081): the linked CEO PCs – the ones whose
// files.path answers this PC (devices/sync/paths.ts) – with their names and whether they are online. One devices.list
// on first need and after a reconnect, then 'device.upserted' / 'device.removed' keep it current; no polling. The
// three-dots menu's "Open on" and the new-tab page's Files cells read it.
// Owns: that list, a PC's name for a path tab, and asking a PC for its data folder. Never: opens a tab or draws anything.

import { signal } from '@preact/signals';
import type { Device } from '../../shared/model/devices.ts';
import type { RootInfo } from '../../shared/model/system.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';

/** The linked CEO PCs, in the order devices.list gives them. */
export const linkedPcs = signal<Device[]>([]);
let watched = false;

/** Another PC of the person's own: no phone, not this one, not an employee's PC or the employer's, still linked. */
export function isCeoPc(device: Device): boolean {
  return device.kind === 'pc' && !device.self && !device.personId && device.joinedAs !== 'employee' && device.status !== 'revoked' && device.status !== 'pairing';
}

/** `list` with `device` put in (or taken out, when it is no CEO PC any more) – pure. */
export function withDevice(list: readonly Device[], device: Device): Device[] {
  if (!isCeoPc(device)) return list.filter((entry) => entry.id !== device.id);
  return list.some((entry) => entry.id === device.id) ? list.map((entry) => (entry.id === device.id ? device : entry)) : [...list, device];
}

function refresh(): void {
  rpc.call('devices.list').then((list) => { linkedPcs.value = list.filter(isCeoPc); }, () => undefined);
}

/** Starts keeping linkedPcs current (idempotent; the owner's window – a phone has no devices.list). */
export function watchLinkedPcs(): void {
  if (watched || !can('devices.list')) return;
  watched = true;
  rpc.on('device.upserted', (device) => { linkedPcs.value = withDevice(linkedPcs.peek(), device); });
  rpc.on('device.removed', ({ id }) => { linkedPcs.value = linkedPcs.peek().filter((entry) => entry.id !== id); });
  rpc.onOpen(refresh);
  refresh();
}

/** The name of linked PC `id` for a line ("not found on Tower"); 'another PC' while the list does not know it. */
export function pcName(id: string): string {
  return linkedPcs.value.find((pc) => pc.id === id)?.name ?? 'another PC';
}

/** The PCs the new-tab page's Files row offers a cell for. */
export const rootPcs = (): Device[] => linkedPcs.value;

/** That PC's data folder, workspace and map, asked there (system.root with `device`). */
export function pcRoot(device: string): Promise<RootInfo> {
  return rpc.call('system.root', { device });
}
