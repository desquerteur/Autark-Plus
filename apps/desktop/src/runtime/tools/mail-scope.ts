// Which wakes and runs an app event (an incoming mail) started: the dispatcher keeps them in their own group and
// retries them without a chat. Owner 16.11.2026: a run a mail started works like every other run, with every tool –
// nothing here holds a tool back.
// Owns: mail origin classification. Never: refuses a tool or infers anything from mail text.
import { mailOriginKey, type Origin } from '../../shared/model/origin.ts';

/** A run or wake an app event started (a mailbox's identity, or a legacy `app:` source). */
export function mailMarker(origin: Origin | undefined): boolean {
  return Boolean(origin?.mailProvenance || origin?.mailScope || origin?.source.startsWith('app:'));
}
/** The wake group of such an origin: one per mailbox identity, so one mail's wakes never merge with the person's work. */
export function mailPartition(origin: Origin | undefined): string {
  return mailOriginKey(origin) || (mailMarker(origin) ? `legacy:${origin?.source}` : '');
}
