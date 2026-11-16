// Home's "no AI" notice: after the first run while no model can answer (first-run-model.ts noUsableModel), Home's
// band says "No AI is connected yet – your team can't start." with [Connect] – Settings at its Models group. A status,
// not an offer: no Dismiss; it goes as soon as a model can answer.
// B-085: the careful-access notice beside it – after the first run, while settings.profile.pcAccess is 'careful' and
// this connection may write settings, a quiet info line "The team checks with you before changes outside its
// folders." with [Give full access] (pc-access.ts setPcAccess); it goes once the access is whole. Lowest priority.
// Owns: these notices (aiNotice and accessNotice are pure) and their registration (shell/StatusLine.tsx
// registerShellNotices calls registerAiNotice once per app start). Never: shows the no-AI line away from Home, either
// line before the snapshots are in or during the first run, or where this connection may not read the accounts (no
// AI) or write the settings (access).

import type { Account, ModelInfo } from '../../shared/model/providers.ts';
import type { Settings } from '../../shared/model/system.ts';
import { navigate } from '../lib/router.ts';
import { can } from '../lib/session.ts';
import { accounts, loaded, models, route, settings } from '../lib/store.ts';
import { toastError } from '../lib/toasts.ts';
import { NOTICE_PRIORITY, registerNotice, type Notice } from '../shell/notices.ts';
import { noUsableModel } from './first-run-model.ts';
import { setPcAccess } from './pc-access.ts';

export const AI_NOTICE_ID = 'no-ai';
export const AI_NOTICE_TEXT = "No AI is connected yet – your team can't start.";
export const ACCESS_NOTICE_ID = 'pc-access';
export const ACCESS_NOTICE_TEXT = 'The team checks with you before changes outside its folders.';
/** Below every other line: a standing choice, never pushing a to-do or a status out of the three shown. */
export const ACCESS_NOTICE_PRIORITY = 10;

export interface AiNoticeInput {
  onboarding: Settings['onboarding'] | undefined;
  /** The route is Home. */
  home: boolean;
  /** The snapshots are loaded (before that the account list is empty, not "nothing connected"). */
  loaded: boolean;
  /** This connection may read the accounts (the owner's window). */
  readable: boolean;
  models: readonly ModelInfo[];
  accounts: readonly Account[];
}

/** The band line while no model can answer after the first run, or null. */
export function aiNotice(input: AiNoticeInput, connect: () => void): Notice | null {
  if (!input.home || !input.loaded || !input.readable || input.onboarding?.step !== 'done') return null;
  if (!noUsableModel(input.models, input.accounts)) return null;
  return {
    id: AI_NOTICE_ID, tone: 'warn', priority: NOTICE_PRIORITY.setup,
    text: AI_NOTICE_TEXT,
    actions: [{ label: 'Connect', run: connect }],
  };
}

export interface AccessNoticeInput {
  settings: Pick<Settings, 'onboarding' | 'profile'> | null | undefined;
  loaded: boolean;
  /** This connection may write the settings. */
  writable: boolean;
}

/** B-085: the quiet line while the team works carefully after the first run, or null. */
export function accessNotice(input: AccessNoticeInput, give: () => unknown): Notice | null {
  const s = input.settings;
  if (!s || !input.loaded || !input.writable || s.onboarding.step !== 'done' || s.profile.pcAccess !== 'careful') return null;
  return {
    id: ACCESS_NOTICE_ID, tone: 'info', priority: ACCESS_NOTICE_PRIORITY,
    text: ACCESS_NOTICE_TEXT,
    actions: [{ label: 'Give full access', run: give }],
  };
}

/** Registers both providers (once per app start); returns the function that removes them. */
export function registerAiNotice(): () => void {
  const offs = [
    registerNotice(() => aiNotice({
      onboarding: settings.value?.onboarding,
      home: route.value.view === 'home',
      loaded: loaded.value,
      readable: can('accounts.list'),
      models: models.value,
      accounts: accounts.value,
    }, () => navigate({ view: 'settings', section: 'models' }))),
    registerNotice(() => accessNotice({ settings: settings.value, loaded: loaded.value, writable: can('settings.update') },
      () => setPcAccess('whole').catch((error) => toastError(error, 'Could not give full access')))), // returned: the action shows busy
  ];
  return () => { for (const off of offs) off(); };
}
