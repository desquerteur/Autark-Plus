// AF-021: the agent page's "Account" row – the agent's default account where a provider has several accounts
// (ModelPolicy.account, models.setPolicy). "Automatic (recommended)" or one account, each with its share left and
// reset (chat/composer/account-menu.ts). A chat's own choice in the model menu beats it; with neither, routing picks.
// Owns: the row. Never: shown without a choice to make (no provider with two accounts and no default stored).

import { useEffect, useState } from 'preact/hooks';
import type { Agent } from '../../shared/model/org.ts';
import type { ModelPolicy, ProviderId } from '../../shared/model/providers.ts';
import { Select, type SelectOption } from '../lib/ui.tsx';
import { accounts, usage } from '../lib/store.ts';
import { rpc } from '../lib/rpc.ts';
import { toastError } from '../lib/toasts.ts';
import { PROVIDER_NAMES } from '../settings/providers.ts';
import { accountOptions, optionMeta } from '../chat/composer/account-menu.ts';

export function AgentAccountRow(props: { agent: Agent; readOnly: boolean }) {
  const stored = props.agent.modelPolicy?.account ?? '';
  const [value, setValue] = useState(stored);
  useEffect(() => setValue(stored), [stored]);
  const now = Date.now();
  const providers = [...new Set(accounts.value.filter((account) => account.enabled).map((account) => account.provider))];
  const choices = providers.map((provider) => accountOptions(accounts.value, usage.value, provider, now)).filter((list) => list.length > 1).flat();
  if (!choices.length && !value) return null;
  const save = async (next: string) => {
    const before = value;
    setValue(next);
    const { account: _old, ...rest } = props.agent.modelPolicy ?? {};
    const policy: ModelPolicy = next ? { ...rest, account: next } : rest;
    try { await rpc.call('models.setPolicy', { agentId: props.agent.id, policy }); } catch (error) { setValue(before); toastError(error, 'Could not save the account'); }
  };
  const options: Array<SelectOption<string>> = [
    { value: '', label: 'Automatic (recommended)', hint: 'The quota that resets soonest' },
    ...choices.map((option) => ({ value: option.id, label: `${option.name} · ${PROVIDER_NAMES[option.provider as ProviderId] ?? option.provider}`, hint: optionMeta(option, now) })),
  ];
  if (value && !choices.some((option) => option.id === value)) options.push({ value, label: 'Removed account' });
  // the same markup as AgentDetails.tsx Row
  return (
    <div class="agent-row">
      <span class="agent-row-text">
        <span class="agent-row-label">Account</span>
        <small class="agent-row-hint">{value ? 'Default for its chats – a chat can choose another' : 'Chosen per turn'}</small>
      </span>
      <Select label="Account" value={value} options={options} disabled={props.readOnly} onChange={(next) => void save(next)} />
    </div>
  );
}
