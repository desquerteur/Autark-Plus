// RPC handlers: connecting PCs (Settings › Devices) – this PC's Remote ID and requests, connecting
// to another PC by Remote ID or address as the CEO or an employee, deciding requests waiting here
// (an employee's PC with the person it belongs to, or – F13 – a new person; F17: also one waiting on another of my PCs,
// decided there), and the PCs on this network.
// The owner and – B-084 (D6) – the owner's phone on a secure transport ('settings' + secure: the app's tunnel, HTTPS or
// the tailnet; a plain LAN browser and people never), so Settings › Devices on the phone is the PC's.
// Whether other PCs may ask at all is settings.devices.findable (settings.json).
// Owns: param checks and the device tier. Never: request logic, or returning keys or session secrets.

import { WorkforceError } from '../../../shared/errors.ts';
import { readDecide } from '../../remote/mirror.ts';
import { input, onlyKeys, optBool, optOneOf, text } from '../params.ts';
import type { RemoteApi } from '../extras.ts';
import type { HandlerContext, HandlerTable } from '../table.ts';

/** B-084 (D6): device administration for my phone on a secure transport, like the PC. */
const DEVICE_ADMIN = { capability: 'settings', secure: true } as const;

function remoteOf(ctx: HandlerContext): RemoteApi {
  if (!ctx.extras.remote) throw new WorkforceError('unavailable', 'Connecting PCs is not available on this PC.');
  return ctx.extras.remote;
}

export function register(table: HandlerTable): void {
  table.add('remote.state', (_params, ctx) => remoteOf(ctx).state(), DEVICE_ADMIN);
  table.add('remote.connect', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['target', 'role']);
    return remoteOf(ctx).connect({ target: text(o, 'target', { max: 200 }), role: optOneOf(o, 'role', ['ceo', 'employee'] as const) ?? 'ceo' });
  }, DEVICE_ADMIN);
  table.add('remote.cancel', (_params, ctx) => { remoteOf(ctx).cancel(); return { ok: true as const }; }, DEVICE_ADMIN);
  table.add('remote.decide', async (params, ctx) => {
    const { id, accept, personId, newPerson } = readDecide(params, (person) => Boolean(ctx.services.people?.get(person)));
    await remoteOf(ctx).decide(id, accept, personId, newPerson);
    return { ok: true as const };
  }, DEVICE_ADMIN);
  table.add('remote.nearby', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['refresh']);
    return remoteOf(ctx).nearby(optBool(o, 'refresh') ?? false);
  }, DEVICE_ADMIN);
}
