// What each Settings page holds right now, as words for the settings search (F20, owner 15.11.2026: "direkt Passwörter
// suchen … und auch in den anderen Einstellungsbereichen … Sachen dort", also where "es richtig viele gibt bei irgendeinem
// User"): the names the lists this connection may read hold – Secrets (the names, purposes, tags and sources of the single
// secrets and logins, as the page lists them), Apps (names and addresses), Skills & memory (names and descriptions), Models
// (the accounts' names, providers and plans, from the store) and Devices (names) – one lower-case text per page for
// sections.ts searchSections, which the settings search (SettingsNav.tsx) and the palette's Settings group use.
// Loaded the first time a search holds text (wantSettingsWords), then a list again on its own change event (one load at a
// time, one more after it when events came meanwhile) and after a reconnect; never on a timer.
// Owns: those words and when they load. Never: loads a value (secrets.list and secrets.groups carry metadata only) or a list
// this session may not call.

import { computed, signal } from '@preact/signals';
import type { ConnectedApp } from '../../shared/model/apps.ts';
import type { Device } from '../../shared/model/devices.ts';
import type { SkillInfo } from '../../shared/model/knowledge.ts';
import type { Account } from '../../shared/model/providers.ts';
import type { SecretGroup, SecretInfo } from '../../shared/model/security.ts';
import { SYSTEM_ID } from '../../shared/ids.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { accounts } from '../lib/store.ts';
import type { PageWords } from './sections.ts';

const text = (parts: ReadonlyArray<string | undefined>): string => parts.filter(Boolean).join('\n').toLowerCase();

/** Secrets: what its rows show – names, purposes, tags and sources (the app's own entries stay out, as on the page). */
export function secretWords(secrets: readonly SecretInfo[], groups: readonly SecretGroup[]): string {
  const entries = [...secrets.filter((info) => !info.group && info.createdBy !== SYSTEM_ID), ...groups];
  return text(entries.flatMap((entry) => [entry.label, entry.description, ...(entry.tags ?? []), entry.source]));
}

export const appWords = (apps: readonly ConnectedApp[]): string => text(apps.flatMap((app) => [app.name, app.address]));
export const skillWords = (skills: readonly SkillInfo[]): string => text(skills.flatMap((skill) => [skill.name, skill.name.replace(/-/g, ' '), skill.description]));
export const accountWords = (list: readonly Account[]): string => text(list.flatMap((account) => [account.label, account.provider, account.plan]));
export const deviceWords = (devices: Iterable<string>): string => text([...devices]);

type Listed = 'secrets' | 'apps' | 'skills' | 'devices';

/** The lists loaded so far; Models comes from the accounts store. */
const lists = signal<PageWords>({});
const deviceNames = new Map<string, string>();

/** The words of every page this session may read (sections.ts PageWords). */
export const settingsWords = computed<PageWords>(() => ({ ...lists.value, ...(can('accounts.detect') ? { models: accountWords(accounts.value) } : {}) }));

const LOADERS: Readonly<Record<Listed, { allowed: () => boolean; load: () => Promise<string> }>> = {
  secrets: {
    allowed: () => can('secrets.list'),
    load: async () => secretWords(await rpc.call('secrets.list'), can('secrets.groups') ? await rpc.call('secrets.groups') : []),
  },
  apps: { allowed: () => can('apps.list'), load: async () => appWords(await rpc.call('apps.list')) },
  skills: {
    allowed: () => can('skills.list') || can('skills.catalog'),
    load: async () => skillWords(await (can('skills.list') ? rpc.call('skills.list') : rpc.call('skills.catalog'))),
  },
  devices: {
    allowed: () => can('devices.list'),
    load: async () => {
      deviceNames.clear();
      for (const device of await rpc.call('devices.list')) deviceNames.set(device.id, device.name);
      return deviceWords(deviceNames.values());
    },
  },
};

const busy = new Set<Listed>();
const again = new Set<Listed>();

function setWords(page: Listed, words: string | undefined): void {
  const next = { ...lists.value };
  if (words === undefined) delete next[page]; else next[page] = words;
  lists.value = next;
}

/** Loads one page's words (one load at a time; events during it load once more after it). */
function refresh(page: Listed): void {
  if (busy.has(page)) { again.add(page); return; }
  const loader = LOADERS[page];
  if (!loader.allowed()) { setWords(page, undefined); return; }
  busy.add(page);
  void loader.load().then((words) => setWords(page, words), () => undefined) // the page's own list says why it failed
    .finally(() => { busy.delete(page); if (again.delete(page)) refresh(page); });
}

const PAGES = Object.keys(LOADERS) as Listed[];
let started = false;

/** The settings search holds text: the words load once and follow their lists' changes from then on. */
export function wantSettingsWords(): void {
  if (started) return;
  started = true;
  for (const page of PAGES) refresh(page);
  rpc.on('secrets.changed', () => refresh('secrets'));
  rpc.on('apps.changed', () => refresh('apps'));
  rpc.on('skills.changed', () => refresh('skills'));
  rpc.on('device.upserted', (device: Device) => {
    if (deviceNames.get(device.id) === device.name || !LOADERS.devices.allowed()) return;
    deviceNames.set(device.id, device.name);
    setWords('devices', deviceWords(deviceNames.values()));
  });
  rpc.on('device.removed', ({ id }) => { if (deviceNames.delete(id)) setWords('devices', deviceWords(deviceNames.values())); });
  rpc.onOpen(() => { for (const page of PAGES) refresh(page); });
}
