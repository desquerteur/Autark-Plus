// The change log of Settings › Security (owner 16.11.2026: agents may change these settings like any other, so every
// change is written down – who, when, old → new – and can be read in the tab). Two settings: profile.pcAccess and
// profile.forEveryAgent. The log listens to `settings.updated` – the bus is synchronous – so a change counts however it
// came: the RPC handler names its caller around settings.update (actingAs), anything else (an edit of settings.json, a
// linked PC's sync) is recorded as 'other'. A caller is named only for the fields its own patch carries: an update also
// takes over an edit of settings.json that was not handed over yet (settings/service.ts update), and that edit is not
// the caller's (Noah's review 16.11.2026, A). The values as last seen stay in kv security/last, so a change made while
// Autark was not running gets its entry at the next start (C). The newest SECURITY_LOG_MAX entries stay in kv
// security/changes.
// Owns: noticing the change, naming the caller, keeping and reading the entries. Never: blocks or reverts a change,
// logs another setting, or keeps more than SECURITY_LOG_TEXT characters of a value. It is a record, not a lock: whoever
// can write this PC's files can write the record too.

import type { ClientScope } from '../../shared/api/protocol.ts';
import { SECURITY_LOG_MAX, SECURITY_LOG_TEXT, type SecurityActor, type SecurityChange, type SecurityField } from '../../shared/model/security-log.ts';
import type { Settings } from '../../shared/model/system.ts';

/** The part of the key/value store the log needs (store/kv.ts KvRepo). */
export interface LogKv {
  get<T>(ns: string, key: string): T | undefined;
  set(ns: string, key: string, value: unknown, at: number): void;
}

const NS = 'security';
const CHANGES = 'changes';
const LAST = 'last';
const OTHER: SecurityActor = { kind: 'other', name: 'settings.json or a linked PC' };
const WHILE_OFF: SecurityActor = { kind: 'other', name: 'While Autark was not running' };
/** The launch token without an agent's name: a `wf` outside an agent's turn, a script, a plain request to this PC's port. */
const LAUNCH_TOKEN: SecurityActor = { kind: 'other', name: 'A command on this PC (wf or a script, no agent named)' };
/** Each logged setting: its name in the log, where it lives in settings.json (section, key) and its value as text. */
const FIELDS: ReadonlyArray<readonly [SecurityField, string, string, (settings: Settings) => string]> = [
  ['pcAccess', 'profile', 'pcAccess', (settings) => settings.profile.pcAccess ?? 'whole'],
  ['forEveryAgent', 'profile', 'forEveryAgent', (settings) => (settings.profile.forEveryAgent ?? '').replace(/\r\n?/g, '\n').trim()],
  // 17.11.2026: sharing in the public library (absent counts as on, library/publish.ts)
  ['libraryPublish', 'library', 'publish', (settings) => (settings.library?.publish === false ? 'off' : 'on')],
];

let acting: { by: SecurityActor; fields: ReadonlySet<SecurityField> } | undefined;

/** The security fields a settings patch itself carries (a section set to null resets it whole, so every field in it). */
function fieldsOf(patch: unknown): ReadonlySet<SecurityField> {
  if (!patch || typeof patch !== 'object') return new Set();
  const sections = patch as Record<string, unknown>;
  return new Set(FIELDS.filter(([, section, key]) => {
    if (!(section in sections)) return false;
    const part = sections[section];
    return part === null || (typeof part === 'object' && key in (part as object));
  }).map(([field]) => field));
}

/**
 * Runs a settings update as `by`: the entries it causes for the fields of `patch` carry that name (the update is
 * synchronous, nothing else runs between). A field the patch does not carry but the update changed is not the caller's.
 */
export function actingAs<T>(by: SecurityActor, patch: unknown, run: () => T): T {
  const before = acting;
  acting = { by, fields: fieldsOf(patch) };
  try { return run(); } finally { acting = before; }
}

/**
 * Who a scope is. The person: the desktop window and main's own link (entry-electron.ts marks them). An agent: its `wf`
 * (the name it gave, http/ws.ts) or its MCP lease. The launch token alone names nobody.
 */
export function actorOf(scope: ClientScope, lookup: { person: () => string; agent: (id: string) => string | undefined }): SecurityActor {
  switch (scope.kind) {
    case 'owner':
      if (scope.agentId) return { kind: 'agent', id: scope.agentId, name: lookup.agent(scope.agentId) ?? 'An agent' };
      return scope.window || scope.main ? { kind: 'person', name: lookup.person() } : LAUNCH_TOKEN;
    case 'agent': return { kind: 'agent', id: scope.agentId, name: lookup.agent(scope.agentId) ?? 'An agent' };
    case 'device': return { kind: 'phone', id: scope.deviceId, name: `${lookup.person()}'s phone` };
    case 'person': return { kind: 'colleague', id: scope.personId, name: 'A colleague' };
    case 'external': return { kind: 'agent', id: scope.memberId, name: 'An external agent' };
    default: return OTHER;
  }
}

function cut(text: string): string {
  return text.length > SECURITY_LOG_TEXT ? `${text.slice(0, SECURITY_LOG_TEXT)}…` : text;
}

/** The entries newest first. */
export function readSecurityChanges(kv: Pick<LogKv, 'get'>): SecurityChange[] {
  const stored = kv.get<SecurityChange[]>(NS, CHANGES);
  return Array.isArray(stored) ? stored : [];
}

/** Starts the log; the returned function stops it. */
export function startSecurityLog(deps: { bus: { on(event: 'settings.updated', listener: (settings: Settings) => void): () => void }; settings: { get(): Settings }; kv: LogKv; now: () => number }): () => void {
  const read = (settings: Settings): Map<SecurityField, string> => new Map(FIELDS.map(([field, , , value]) => [field, value(settings)]));
  /** Writes one entry per changed field and remembers `next` as the values last seen. */
  const note = (from: Map<SecurityField, string> | undefined, next: Map<SecurityField, string>, by: (field: SecurityField) => SecurityActor): void => {
    const at = deps.now();
    const entries: SecurityChange[] = [];
    for (const [field] of FIELDS) {
      const old = from?.get(field);
      const to = next.get(field) ?? '';
      if (old !== undefined && old !== to) entries.push({ at, field, by: by(field), from: cut(old), to: cut(to) });
    }
    if (entries.length) deps.kv.set(NS, CHANGES, [...entries.reverse(), ...readSecurityChanges(deps.kv)].slice(0, SECURITY_LOG_MAX), at);
    // also when a field is new to the stored values (a setting logged since a later version): remembered from now on
    if (entries.length || !from || FIELDS.some(([field]) => !from.has(field))) deps.kv.set(NS, LAST, Object.fromEntries(next), at);
  };

  let last = read(deps.settings.get());
  const stored = deps.kv.get<Record<string, unknown>>(NS, LAST);
  const seen = stored && typeof stored === 'object'
    ? new Map(FIELDS.flatMap(([field]) => (typeof stored[field] === 'string' ? [[field, stored[field] as string] as const] : [])))
    : undefined;
  note(seen, last, () => WHILE_OFF); // a change made while Autark was off; the first start only remembers the values

  return deps.bus.on('settings.updated', (settings) => {
    const next = read(settings);
    const named = acting;
    note(last, next, (field) => (named?.fields.has(field) ? named.by : OTHER));
    last = next;
  });
}
