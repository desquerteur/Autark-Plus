// Owns: explicit contact stops from a configured local DNC file, read for every delivery.
// Never: infers stops from message text or keeps a second contact list.
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { domainToASCII } from 'node:url';
import { MailError } from './mailbox.ts';

function domain(value: string): string {
  const out = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ''));
  if (!out || !/^[a-z0-9.-]+$/.test(out) || out.split('.').some((s) => !s || s.startsWith('-') || s.endsWith('-'))) throw new Error();
  return out;
}
function address(value: string): string {
  const parts = value.trim().toLowerCase().split('@');
  if (parts.length !== 2 || !parts[0] || /[\s<>]/.test(parts[0])) throw new Error();
  return `${parts[0]}@${domain(parts[1])}`;
}
export function assertContactRecipients(file: string | undefined, recipients: string[]): void {
  if (file === undefined) return;
  let stopped = false;
  try {
    if (!isAbsolute(file)) throw new Error();
    const rows: unknown = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(rows)) throw new Error();
    const addresses = new Set<string>();
    const domains: string[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || row.status !== 'DNC') throw new Error();
      for (const [key, normalize, dest] of [['addresses', address, addresses], ['organization_domains', domain, domains]] as const) {
        const values = row[key] ?? [];
        if (!Array.isArray(values)) throw new Error();
        for (const value of values) {
          if (typeof value !== 'string') throw new Error();
          const normalized = normalize(value);
          if (dest instanceof Set) dest.add(normalized); else dest.push(normalized);
        }
      }
    }
    stopped = recipients.some((recipient) => {
      const normalized = address(recipient), host = normalized.split('@')[1];
      return addresses.has(normalized) || domains.some((d) => host === d || host.endsWith(`.${d}`));
    });
  } catch { throw new MailError('Not sent: configured contact-stop file could not be read or validated.'); }
  if (stopped) throw new MailError('Not sent: recipient matches an explicit contact stop.');
}
