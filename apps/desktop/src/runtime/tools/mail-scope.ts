// Owns: mail origin classification and the exact-message tool boundary.
// Never: infers authority from mail text or issues execution capabilities.
import { validMailGeneration } from '../apps/mail-identity.ts';
import { mailOriginKey, type Origin } from '../../shared/model/origin.ts';

export const SCOPED_REPLY_ARG = '_runtimeScopedReply';

/** Applied before placement, secret expansion, cached results and tool execution, including tools.call targets.
 * No handoff tools are admitted: durable provenance is not implemented yet; a task is not a privilege upgrade. */
export function mailScopeRefusal(origin: Origin | undefined, name: string, args: unknown, company?: unknown, apps?: () => ReadonlyArray<{ id: string; transport: string }>): string | undefined {
  const scope = origin?.mailScope;
  if (!scope) {
    if (!mailMarker(origin)) return undefined;
    if (!origin?.mailProvenance) {
      try {
        const app = apps?.().find(a => `app:${a.id}` === origin?.source);
        if (app && app.transport !== 'mail') return undefined;
      } catch { /* unresolved app identity stays unavailable */ }
    }
    return 'Mail execution capability unavailable.';
  }
  const denied = 'Outside this mail capability (only its exact messages and sender-only replies).';
  if (!validMailGeneration(scope.generation)) return denied;
  if (company !== undefined || !scope.appId || !Array.isArray(scope.messageIds) || !scope.messageIds.length) return denied;
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const action = name.startsWith(`app.${scope.appId}.`) ? name.slice(`app.${scope.appId}.`.length) : '';
  const keys: Record<string, string[]> = { read: ['id'], reply: ['id', 'text', 'all'], mark: ['id', 'read'] };
  if (!Object.hasOwn(keys, action) || Object.keys(input).some((key) => !keys[action].includes(key))) return denied;
  if (typeof input.id !== 'string' || !scope.messageIds.includes(input.id)) return denied;
  if (input.all !== undefined && input.all !== false) return denied;
  // Secret handles cannot reach connector expansion; even a known handle is not authority to use the vault.
  if (Object.values(input).some((value) => typeof value === 'string' && /secret:\/\//i.test(value))) return denied;
  return undefined;
}

/** Conservative partition: an unresolved app wake stays separate from owner work. */
export function mailMarker(origin: Origin | undefined): boolean {
  return Boolean(origin?.mailProvenance || origin?.mailScope || origin?.source.startsWith('app:'));
}
export function mailPartition(origin: Origin | undefined): string {
  return mailOriginKey(origin) || (mailMarker(origin) ? `legacy:${origin?.source}` : '');
}
/** Durable identities only; an incoming scope is not authority to issue another scope. */
export function validMailProvenance(origin: Origin | undefined): boolean {
  const p = origin?.mailProvenance;
  return Boolean(p && validMailGeneration(p.generation) && !origin?.mailScope && /^[a-z][a-z0-9-]{0,23}$/.test(p.appId)
    && origin?.source === `app:${p.appId}` && Array.isArray(p.messageIds)
    && p.messageIds.length > 0 && p.messageIds.length <= 50
    && p.messageIds.every(id => typeof id === 'string' && /^INBOX\/[1-9]\d{0,9}\/[1-9]\d{0,9}$/.test(id)));
}
