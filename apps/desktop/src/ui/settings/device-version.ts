// Feedback F25 (16.11.2026, "warum das hier nicht synchron läuft"): the app version each PC runs, as Settings › Devices
// writes it after a PC's line – "0.3.6 – behind server 0.3.8" when another listed PC runs a newer one, else just
// "0.3.8". The version comes with each PC's caps (runtime/devices/tools.ts localCaps); a PC on an older version sends
// none and shows none.
// Feedback 1b136d01 (19.11.2026): a PC that is behind and online gets an Update button on its row (DevicesGroup.tsx,
// system.update {device}) – updateOffered says when.
// Owns: that text and when the button shows. Never: compares anything but the versions the devices list carries, or starts an update.

import { compareAppVersions, type Device } from '../../shared/model/devices.ts';

/** Whether a PC's row offers its Update: a PC that runs an older version than another listed PC, and is online. */
export function updateOffered(device: Pick<Device, 'id' | 'kind' | 'caps' | 'status'>, list: ReadonlyArray<Pick<Device, 'id' | 'kind' | 'name' | 'caps' | 'status'>>): boolean {
  return device.kind === 'pc' && device.status === 'online' && versionHint(device, list).includes(' – behind ');
}

/** The version part of a PC's line in Settings › Devices; '' for a phone, a browser or a PC that sends no version. */
export function versionHint(device: Pick<Device, 'id' | 'kind' | 'caps'>, list: ReadonlyArray<Pick<Device, 'id' | 'kind' | 'name' | 'caps' | 'status'>>): string {
  const own = device.kind === 'pc' ? device.caps.version : undefined;
  if (!own) return '';
  let ahead: { name: string; version: string } | undefined;
  for (const other of list) {
    const version = other.kind === 'pc' && other.id !== device.id && other.status !== 'revoked' ? other.caps.version : undefined;
    if (version && compareAppVersions(version, ahead?.version ?? own) > 0) ahead = { name: other.name, version };
  }
  return ahead ? `${own} – behind ${ahead.name} ${ahead.version}` : own;
}
