// Owns: durable, non-secret mailbox incarnations. Never: hashes credentials or derives authority from a repeatable fingerprint.
import { randomUUID } from 'node:crypto';
import type { MailServer } from '../../shared/model/apps.ts';
import type { AppKv, Connector } from './types.ts';

export const validMailGeneration = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
type Servers = { imap: MailServer; smtp: MailServer; user?: string };
type Identity = { generation: string; config: string; effective?: string };
// Host names are case insensitive; usernames and address local parts are not assumed so.
// Missing explicit endpoints remain distinct from resolved endpoints. Passwords/handles are not identity.
const serverKey = (s?: MailServer) => s ? [s.host.toLowerCase(), s.port, s.tls] : null;
function key(c: Connector, servers?: Servers): string {
  const m = c.mail!;
  const values = [m.address, m.user ?? null, serverKey(m.imap), serverKey(m.smtp)];
  if (servers) values.push(servers.user ?? null, serverKey(servers.imap), serverKey(servers.smtp));
  const result = JSON.stringify(values);
  if (/secret:\/\//i.test(result)) throw new Error('Mailbox identity unresolved.');
  return result;
}
export function mailGeneration(kv: AppKv, c: Connector, servers?: Servers): string | undefined {
  if (c.transport !== 'mail' || !c.mail) { kv.delete(`mailidentity:${c.id}`); return undefined; }
  const config = key(c), effective = servers ? key(c, servers) : undefined;
  const old = kv.get<Identity>(`mailidentity:${c.id}`);
  const same = old && validMailGeneration(old.generation) && old.config === config
    && (effective === undefined || old.effective === undefined || old.effective === effective);
  const next: Identity = same ? { ...old, ...(effective ? { effective } : {}) }
    : { generation: randomUUID(), config, ...(effective ? { effective } : {}) };
  // Persist before publishing to a connection or event. A failed write yields no usable generation.
  kv.set(`mailidentity:${c.id}`, next);
  return next.generation;
}
