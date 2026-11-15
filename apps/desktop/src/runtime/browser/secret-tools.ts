// The AI stores secrets it meets on a page itself, without ever seeing them (owner 29.10.2026: the secrets catalog is
// THE system, IDs not values). browser.save_secret reads one element of the agent's own browser by its ref (a field's
// value, else its text) and stores it – the same value is never stored twice (the agent gets that handle), the agent's
// own secret of the same name takes the new value. browser.save_totp reads the 2FA setup key a page shows and stores it
// as the `totp` field of the agent's login for that site (a new login when there is none); filling the returned handle
// types the current code. Both record the page's site as the source (provenance only) and return only the handle.
// Owns: these two tools. Never: returns, logs or journals a value.

import type { SecretGroup } from '../../shared/model/security.ts';
import { registrableDomain } from '../secrets/service.ts';
import { toOtpauth } from '../secrets/totp.ts';
import { clip, defineTool } from '../tools/builtin/util.ts';
import type { ToolContext, ToolDef, ToolOutput } from '../tools/types.ts';
import { failure, json } from '../tools/types.ts';
import type { BrowserService } from './service.ts';
import { TAB_PROP, useOf } from './place.ts';

const KINDS = ['api_key', 'token', 'password', 'card', 'note'] as const;
const MAX_VALUE = 16_384;
const OWN_ONLY = "This reads my own browser: open the page there (browser.open with where: 'own').";
export const NO_KEY = "No 2FA setup key is visible – open the page's 'enter key manually' / 'can't scan' option and try again.";
export const SEVERAL_KEYS = 'This page shows more than one 2FA setup key, so none was saved – open the one for this account alone.';

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** 13–19 digits (spaces or dashes between) passing the Luhn check: a payment card number. */
export function looksLikeCard(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

interface SaveArgs { ref: string; name: string; description: string; kind?: (typeof KINDS)[number]; route?: string; tags?: string[]; tab?: string }

async function saveSecret(browser: BrowserService, args: SaveArgs, ctx: ToolContext): Promise<ToolOutput> {
  if (args.tab?.startsWith('web-') || !browser.isOpen(ctx.agent.id)) return failure(OWN_ONLY);
  ctx.status('saving a secret');
  const page = await browser.fieldValue(ctx.agent.id, { tab: args.tab, ref: args.ref, use: useOf(ctx) });
  const value = page.value.trim();
  if (!value) return failure(`Element ${args.ref} holds no value; nothing was saved.`);
  if (value.length > MAX_VALUE) return failure('That value is too long to store as a secret.');
  const secrets = ctx.services.secrets;
  const held = secrets.holding ? await secrets.holding(value, ctx.agent.id) : [];
  const same = held.length ? secrets.list().find((entry) => entry.id === held[0]) : undefined;
  if (same) return json({ ok: true, id: same.id, handle: `secret://${same.id}`, name: same.label, note: 'That value is already stored; use this handle.' });
  const source = registrableDomain(page.host);
  const own = secrets.list().find((info) => !info.group && info.createdBy === ctx.agent.id && info.kind !== 'totp' && sameName(info.label, args.name));
  const kind = args.kind ?? (looksLikeCard(value) ? 'card' : page.password ? 'password' : 'api_key');
  const saved = await secrets.save({
    ...(own ? { id: own.id, label: own.label, kind: own.kind } : { label: args.name, kind, createdBy: ctx.agent.id }),
    value, description: args.description, ...(source ? { source } : {}), ...(args.route ? { route: args.route } : {}), ...(args.tags ? { tags: args.tags } : {}),
  });
  return json({ ok: true, id: saved.id, handle: `secret://${saved.id}`, name: saved.label, kind: saved.kind, note: own ? 'My secret of that name took the new value; the handle is the same.' : 'Stored in the secrets catalog: use it by handle anywhere (browser.act value, a command\'s env, a web.fetch header).' });
}

async function saveTotp(browser: BrowserService, args: { tab?: string; group?: string; name?: string }, ctx: ToolContext): Promise<ToolOutput> {
  if (args.tab?.startsWith('web-') || !browser.isOpen(ctx.agent.id)) return failure(OWN_ONLY);
  ctx.status('saving a 2FA key');
  const page = await browser.setupKeys(ctx.agent.id, { tab: args.tab, use: useOf(ctx) });
  const domain = registrableDomain(page.host);
  if (!domain) return failure('Open the site\'s 2FA setup page first.');
  if (!page.keys.length) return failure(NO_KEY);
  if (page.keys.length > 1) return failure(SEVERAL_KEYS);
  const secrets = ctx.services.secrets;
  const groups = secrets.groups();
  let group: SecretGroup | undefined;
  if (args.group) {
    group = groups.find((entry) => entry.id === args.group);
    if (!group || group.kind === 'card') return failure('No stored login with that id (secrets.list shows them).');
  } else {
    group = groups.filter((entry) => entry.kind === 'login' && entry.createdBy === ctx.agent.id && registrableDomain(entry.source) === domain)
      .sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt))[0];
  }
  const old = group ? secrets.list().find((info) => info.group?.id === group!.id && info.kind === 'totp') : undefined;
  const totp = { ...(old ? { id: old.id } : {}), field: old?.field ?? 'totp', kind: 'totp' as const, value: toOtpauth(page.keys[0]!) };
  const saved = group
    ? await secrets.saveGroup({ id: group.id, fields: [totp] })
    : await secrets.saveGroup({ label: args.name?.trim() || `${ctx.agent.name} · ${domain}`, kind: 'login', source: domain, tags: [`for the web at ${domain}`], fields: [totp] }, { createdBy: ctx.agent.id });
  const field = saved.fields.find((info) => info.kind === 'totp')!;
  const { digits, period } = page.keys[0]!;
  return json({ ok: true, group: saved.group.id, label: saved.group.label, handle: `secret://${field.id}`, digits, period, note: 'Fill the code field with this handle (browser.act value "secret://<id>"); every fill types the current code.' });
}

export function secretTools(browser: BrowserService): ToolDef[] {
  const save = defineTool<SaveArgs>({
    name: 'browser.save_secret',
    description: 'Stores a value shown in my own browser in the secrets catalog without my seeing it. Only the handle comes back; the same value is never saved twice.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', minLength: 1, maxLength: 24, description: 'The field, e.g. "e12".' },
        name: { type: 'string', minLength: 1, maxLength: 120 },
        description: { type: 'string', minLength: 1, maxLength: 4000, description: 'What it opens and when it is used.' },
        kind: { type: 'string', enum: [...KINDS], description: 'Default from the field.' },
        route: { type: 'string', maxLength: 40 },
        tags: { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 12 },
        tab: TAB_PROP,
      },
      required: ['ref', 'name', 'description'], additionalProperties: false,
    },
    category: 'write_local', requires: 'device',
    describe: (args) => ({ summary: `Save the value of element ${clip(args.ref, 24)} as the secret "${clip(args.name.replace(/["\s]+/g, ' '), 60)}"`, reversible: true, external: false }),
    run: (args, ctx) => saveSecret(browser, args, ctx),
  });
  const totp = defineTool<{ tab?: string; group?: string; name?: string }>({
    name: 'browser.save_totp',
    description: 'Turns on authenticator 2FA for an account and stores its key without my seeing it. It works on the 2FA setup page in my own browser with "enter key manually" open; the handle it returns fills the current code.',
    inputSchema: {
      type: 'object',
      properties: {
        tab: TAB_PROP,
        group: { type: 'string', maxLength: 64, description: 'A stored login; default my login for this site, else a new one.' },
        name: { type: 'string', minLength: 1, maxLength: 120, description: 'Name of a new login.' },
      },
      additionalProperties: false,
    },
    category: 'write_local', requires: 'device',
    describe: () => ({ summary: 'Save the 2FA setup key shown in the browser in a login', reversible: true, external: false }),
    run: (args, ctx) => saveTotp(browser, args, ctx),
  });
  return [save, totp];
}
