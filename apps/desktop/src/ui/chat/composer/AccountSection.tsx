// AF-021: the model menu's "Account" section – "Automatic (recommended)" and each account of the model's provider with
// its picture (AF-009: logo, else avatar, else initials), name, share left and reset (account-menu.ts). Shown only
// where the provider has more than one account (or one is chosen). A pick is this chat's choice for the agent
// (chats.update settings.accounts); the agent's default is marked "Agent default". Under the list, for the owner,
// whether a used-up chosen account lets the next one run and the chat says so (default since AF-023: the Work use's
// fallback order of Settings › Models, else automatic – the same rule as everywhere, runtime/routing/account-fallback.ts)
// or stops the turn and asks (settings.json routing.accountFallback).
// Owns: the section. Never: routes or hides that a choice could not run.

import { ACCOUNT_AUTO, accountFallbackOf } from '../../../shared/model/account-choice.ts';
import { fallbackOrder } from '../../../shared/model/account-fallback.ts'; // AF-023
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
  const fallback = accountFallbackOf(settings.value?.routing.accountFallback); // AF-023: switch by default
  const ordered = fallbackOrder(settings.value?.routing.fallbacks, 'work').length > 0;
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
          {fallback === 'switch'
            ? <><span class="menu-hint">{ordered ? 'Order in Settings › Models' : 'Automatic'}</span><Icon name="check" size={16} class="menu-check" /></>
            : <span class="menu-hint">Off · asks first</span>}
        </button>
      )}
    </div>
  );
}
