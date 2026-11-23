// apps.* manages the connectors in <data>/connectors through named operations only. A connected device
// must be secure and hold Settings. 16.11.2026 (the owner's phone reaches every setting): what runs on the PC itself –
// a local command server, removing a mailbox, the sign-in page of an app (its answer returns to this PC's own address,
// so the phone opens it in the PC's pane, side.open) – is for whoever acts on the PC's files (onPc: the owner, or the
// owner's phone holding 'manage' on a secure transport, files-path.ts PATH_RULE); a Settings-only device keeps the named
// HTTP operations.
// Owns: parameter checks and scope rules. Never: connector business logic or secret values in an answer/log.

import { WorkforceError } from '../../../shared/errors.ts';
import '../../../shared/api/methods-apps.ts';
import { APP_ID_PATTERN } from '../../../shared/model/apps.ts';
import type { ConnectedApp } from '../../../shared/model/apps.ts';
import '../../contracts/apps.ts';
import type { AppsService } from '../../contracts/apps.ts';
import { bad, input, onlyKeys } from '../params.ts';
import { allowedScope, type HandlerContext, type HandlerTable } from '../table.ts';
import { PATH_RULE } from './files-path.ts';

const SETTINGS = { capability: 'settings', secure: true } as const;
/** The owner, or the owner's phone that acts on this PC's files (its pane is the PC's): what runs on the PC is its too. */
const onPc = (ctx: HandlerContext): boolean => allowedScope(PATH_RULE, ctx.scope);
const SETTINGS_AND_SECRETS = { allCapabilities: ['settings', 'permissions'], secure: true } as const;
type Transport = 'http' | 'stdio' | 'mail';

function target(o: Record<string, unknown>): { id: string; name: string; transport: Transport } {
  const { id, name, transport } = o;
  if (typeof id !== 'string' || !APP_ID_PATTERN.test(id) || typeof name !== 'string' || !name.trim() ||
      (transport !== 'http' && transport !== 'stdio' && transport !== 'mail')) {
    bad('target', 'a connector id, name and transport');
  }
  return { id, name, transport };
}

function appsOf(ctx: HandlerContext): AppsService {
  const service = ctx.services.apps;
  if (!service) throw new WorkforceError('unavailable', 'Connected apps are not available yet.', { details: { service: 'apps' } });
  return service;
}

function appForScope(app: ConnectedApp, ctx: HandlerContext): ConnectedApp {
  if (onPc(ctx) || !app.signInUrl) return app;
  const { signInUrl: _url, ...redacted } = app;
  return redacted;
}

function addEntries(params: unknown): Array<{ name: string; entry: Record<string, unknown> }> {
  const o = input(params);
  onlyKeys(o, ['entries']);
  if (!Array.isArray(o.entries) || o.entries.length > 40) bad('entries', 'a connector list of at most 40 entries');
  return o.entries.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('entries', 'name and entry pairs');
    const pair = value as Record<string, unknown>;
    onlyKeys(pair, ['name', 'entry']);
    if (typeof pair.name !== 'string' || !pair.entry || typeof pair.entry !== 'object' || Array.isArray(pair.entry)) bad('entries', 'name and entry pairs');
    return { name: pair.name, entry: pair.entry as Record<string, unknown> };
  });
}

function hasSecretReference(entries: Array<{ name: string; entry: Record<string, unknown> }>): boolean {
  return entries.some(({ entry }) => ['headers', 'env'].some((field) => {
    const values = entry[field];
    return values !== null && typeof values === 'object' && !Array.isArray(values) &&
      Object.values(values as Record<string, unknown>).some((value) => typeof value === 'string' && /secret:\/\/[A-Za-z0-9_-]{1,128}/i.test(value));
  }));
}

function requireSecretsAccess(ctx: HandlerContext, entries: Array<{ name: string; entry: Record<string, unknown> }>): void {
  if (ctx.scope.kind === 'device' && hasSecretReference(entries) && !ctx.scope.capabilities.includes('permissions')) {
    throw new WorkforceError('forbidden', 'Connector secret references require Settings › Secrets access.');
  }
}

function rejectPhoneLocalCommands(ctx: HandlerContext, entries: Array<{ name: string; entry: Record<string, unknown> }>): void {
  if (!onPc(ctx) && entries.some(({ entry }) => typeof entry.command === 'string')) {
    throw new WorkforceError('forbidden', 'Local command connectors run processes on the PC; adding one takes the PC or a phone that manages its files.');
  }
}

export function register(table: HandlerTable): void {
  table.add('apps.list', (params, ctx) => {
    onlyKeys(input(params), []);
    return appsOf(ctx).list().map((app) => appForScope(app, ctx));
  }, SETTINGS);

  table.add('apps.reconnect', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['id', 'name', 'transport']);
    if (typeof o.id !== 'string' || !APP_ID_PATTERN.test(o.id)) bad('id', 'an app id');
    // A device must repeat the visible tuple; slug IDs can move when colliding connectors change.
    const expected = ctx.scope.kind === 'device' ? target(o)
      : typeof o.name === 'string' && (o.transport === 'http' || o.transport === 'stdio' || o.transport === 'mail') ? target(o) : undefined;
    return appsOf(ctx).reconnect(o.id, expected).then((app) => appForScope(app, ctx));
  }, SETTINGS);

  table.add('apps.setEnabled', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['id', 'name', 'transport', 'enabled']);
    const selected = target(o);
    if (typeof o.enabled !== 'boolean') bad('enabled', 'a boolean');
    appsOf(ctx).mutate({ kind: 'setEnabled', ...selected, enabled: o.enabled });
  }, SETTINGS);

  table.add('apps.remove', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['id', 'name', 'transport']);
    const selected = target(o);
    // Removing a mailbox drops its DNC binding: for whoever acts on the PC (the owner, the owner's managing phone).
    if (selected.transport === 'mail' && !onPc(ctx)) {
      throw new WorkforceError('conflict', 'Mailbox removal takes the PC or a phone that manages its files.');
    }
    appsOf(ctx).mutate({ kind: 'remove', ...selected, ...(selected.transport === 'mail' ? { allowMailRemoval: true } : {}) });
  }, SETTINGS);

  table.add('apps.setToken', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['id', 'name', 'transport', 'secretId']);
    const selected = target(o);
    if (selected.transport !== 'http' || typeof o.secretId !== 'string') bad('target', 'an HTTP connector and secret id');
    appsOf(ctx).mutate({ kind: 'setToken', id: selected.id, name: selected.name, transport: 'http', secretId: o.secretId });
  }, SETTINGS_AND_SECRETS);

  table.add('apps.validateAdd', (params, ctx) => {
    const entries = addEntries(params);
    rejectPhoneLocalCommands(ctx, entries);
    requireSecretsAccess(ctx, entries);
    return appsOf(ctx).validateAdd(entries);
  }, SETTINGS);
  table.add('apps.add', (params, ctx) => {
    const entries = addEntries(params);
    rejectPhoneLocalCommands(ctx, entries);
    requireSecretsAccess(ctx, entries);
    return appsOf(ctx).mutate({ kind: 'add', entries });
  }, SETTINGS);
}
