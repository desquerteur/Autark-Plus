// RPC handler: the meeting server – its state (off, connecting, connected, error; linked PCs
// online there and linked through a tunnel). The owner and – B-084 (D6) – the owner's phone on a secure
// transport ('settings' + secure, as remote.*); the address itself is settings.devices.relay (settings.update).
// Owns: the method registration and its device tier. Never: relay logic or anything secret (there is nothing secret in the state).

import { WorkforceError } from '../../../shared/errors.ts';
import type { HandlerTable } from '../table.ts';

/** B-084 (D6): device administration for my phone on a secure transport, like the PC. */
const DEVICE_ADMIN = { capability: 'settings', secure: true } as const;

export function register(table: HandlerTable): void {
  table.add('remote.relay', (_params, ctx) => {
    if (!ctx.extras.relay) throw new WorkforceError('unavailable', 'The meeting server is not available on this PC.');
    return ctx.extras.relay.state();
  }, DEVICE_ADMIN);
}
