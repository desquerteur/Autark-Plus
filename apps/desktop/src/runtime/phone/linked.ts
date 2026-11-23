// The phones linked to this company: the person's phones with the Autark app (a phone record carrying the key it paired
// with – devices/rendezvous/phone.ts relayPhone; the roster carries it to every PC of mine) with their phone use now,
// and the phones attached over ADB (KI-Runde 17.11.2026: an ADB phone counted as linked nowhere, so phone.* stayed
// refused outside computer mode while a phone hung on the cable). What hangs off this PC comes from the driver itself
// (services.phones.here, contracts/phones.ts), what hangs off another PC from that PC's caps (devices/tools.ts
// localCaps) – `pc` names it while it is not this one, and phone.* then runs there with `device: <that PC>`.
// The registry offers phone.* while an app phone is linked or adb is on this PC (tools/registry.ts), "My environment now" names them
// (context/environment.ts phonesLine) and devices.list lists them (devices/list-tool.ts).
// Owns: that list. Never: reaches a phone, names a revoked one, or reads the caps of a PC that is offline (its last caps
// would keep a phone it no longer holds).

import type { RuntimeServices } from '../contracts.ts';
import '../contracts/phones.ts';
import { DevicesRepo } from '../devices/repo.ts';
import { relayPhone } from '../devices/rendezvous/phone.ts';

/** `use` (an app phone attached to this PC): 'on' / 'off' while it is connected, 'away' while no PC holds it; undefined
 *  while another PC holds it (`pc`) – that PC knows its use. An ADB phone has none. */
export interface LinkedPhone { id: string; name: string; via: 'app' | 'adb'; pc?: string; use?: 'on' | 'off' | 'away' }

const safe = <T>(read: () => T, fallback: T): T => { try { return read(); } catch { return fallback; } };

export function linkedPhones(services: Pick<RuntimeServices, 'db' | 'devices' | 'phones'>): LinkedPhone[] {
  const others = safe(() => services.devices.list(), []).filter((device) => device.kind === 'pc' && device.status !== 'revoked' && device.status !== 'offline' && !device.self);
  const mine = safe(() => services.phones?.here?.(), undefined) ?? { app: [], adb: [] };
  const app = safe(() => new DevicesRepo(services.db).list({ kinds: ['phone'] }).filter(relayPhone), []).map((phone): LinkedPhone => {
    const pc = mine.app.includes(phone.id) ? undefined : others.find((device) => (device.caps?.appPhones ?? []).includes(phone.id));
    if (pc) return { id: phone.id, name: phone.name, via: 'app', pc: pc.name };
    return { id: phone.id, name: phone.name, via: 'app', use: safe(() => services.phones?.useOf(phone.id), undefined) ?? 'away' };
  });
  const elsewhere = others.flatMap((pc) => (pc.caps?.adbPhones ?? []).map((serial) => ({ serial, pc: pc.name })));
  const adb = [
    ...mine.adb.map((serial): LinkedPhone => ({ id: serial, name: serial, via: 'adb' })),
    ...elsewhere.filter((entry) => !mine.adb.includes(entry.serial)).map((entry): LinkedPhone => ({ id: entry.serial, name: entry.serial, via: 'adb', pc: entry.pc })),
  ];
  return [...app, ...adb];
}
