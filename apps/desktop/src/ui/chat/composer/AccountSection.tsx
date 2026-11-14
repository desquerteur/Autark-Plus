// AF-021: the model menu's "Account" section – "Automatic (recommended)" and each account of the model's provider with
// its picture (AF-009: logo, else avatar, else initials), name, share left and reset (account-menu.ts). Shown only
// where the provider has more than one account (or one is chosen). A pick is this chat's choice for the agent
// (chats.update settings.accounts); the agent's default is marked "Agent default". Under the list, for the owner,
// whether a used-up chosen account stops the turn and asks (default) or another one runs and the chat says so
// (settings.json routing.accountFallback).
// Owns: the section. Never: routes or hides that a choice could not run.

import { ACCOUNT_AUTO } from '../../../shared/model/account-choice.ts';
import { AccountAvatar } from '../../lib/account-avatar.tsx';
import { Icon } from '../../lib/ui.tsx';
import { settings, updateSettings } from '../../lib/store.ts';
import { can } from '../../lib/session.ts';
import { toastError } from '../../lib/toasts.ts';
import { optionMeta, type AccountOption } from './account-menu.ts';

export function AccountSection(props: {
  options: readonly AccountOption[];
  selected: { value: string; source: 'chat' | 'agent' | 'auto' };
  agentDefault?: string;
  onPick: (value: string) => void;
}) {
  const { options, selected } = props;
  const now = Date.now();
  if (options.length < 2 && selected.value === ACCOUNT_AUTO) return null;
  const fallback = settings.value?.routing.accountFallback ?? 'ask';
  return (
    <div class="menu-section account-section" role="group" aria-label="Account">
      <div class="account-section-title">Account</div>
      <button type="button" class="menu-item account-option" role="menuitemradio" aria-checked={selected.value === ACCOUNT_AUTO}
        onClick={() => props.onPick(ACCOUNT_AUTO)}>
        <span class="account-auto-face" aria-hidden="true"><Icon name="sparkle" size={13} /></span>
        <span class="account-option-text">
          <span class="account-option-name">Automatic (recommended)</span>
          <span class="account-option-meta">The quota that resets soonest</span>
        </span>
        {selected.value === ACCOUNT_AUTO && <Icon name="check" size={16} class="menu-check" />}
      </button>
      {options.map((option) => {
        const on = selected.value === option.id;
        const meta = optionMeta(option, now);
        const own = props.agentDefault === option.id;
        return (
          <button type="button" key={option.id} class={`menu-item account-option${option.trouble ? ' trouble' : ''}`} role="menuitemradio"
            aria-checked={on} onClick={() => props.onPick(option.id)} title={`${option.name} · ${meta}`}>
            <AccountAvatar provider={option.provider} name={option.name} size={22} />
            <span class="account-option-text">
              <span class="account-option-name">{option.name}</span>
              <span class="account-option-meta">{own ? `Agent default · ${meta}` : meta}</span>
            </span>
            {on && <Icon name="check" size={16} class="menu-check" />}
          </button>
        );
      })}
      {can('settings.update') && (
        <button type="button" class="menu-item account-fallback" role="menuitemcheckbox" aria-checked={fallback === 'switch'}
          onClick={() => void updateSettings({ routing: { accountFallback: fallback === 'switch' ? 'ask' : 'switch' } }).catch((error) => toastError(error, 'Could not save'))}>
          <span class="menu-label"><span>Used up: switch by itself</span></span>
          {fallback === 'switch' ? <Icon name="check" size={16} class="menu-check" /> : <span class="menu-hint">Off · asks first</span>}
        </button>
      )}
    </div>
  );
}
