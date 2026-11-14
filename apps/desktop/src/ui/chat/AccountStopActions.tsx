// AF-021: under a turn that stopped because its chosen account could not run (meta.accountChoice, runtime
// routing/account-choice.ts) – "Use <other account>" for each other account of that provider that can run now, and
// "Automatic". A pick becomes this chat's choice for the agent (chats.update settings.accounts – Automatic stored as
// 'auto' when the agent has a default, so it beats it; composer/account-menu.ts accountsWith) and the turn is tried again
// (messages.retry).
// Owns: those buttons. Never: switches an account without the person's click.

import { useState } from 'preact/hooks';
import type { Message } from '../../shared/model/chat.ts';
import { ACCOUNT_AUTO, readStop } from '../../shared/model/account-choice.ts';
import { accounts, agents, conversations, usage } from '../lib/store.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { toastError } from '../lib/toasts.ts';
import { accountOptions, accountsWith } from './composer/account-menu.ts';

export function AccountStopActions(props: { message: Message }) {
  const { message } = props;
  const [busy, setBusy] = useState(false);
  const stop = readStop(message.meta.accountChoice);
  if (!stop || !can('chats.update')) return null;
  const others = accountOptions(accounts.value, usage.value, stop.provider, Date.now()).filter((option) => option.id !== stop.accountId && !option.trouble);
  const use = async (value: string) => {
    const chat = conversations.value.find((entry) => entry.id === message.conversationId);
    const agentDefault = agents.value.find((entry) => entry.id === message.authorId)?.modelPolicy?.account;
    const next = accountsWith(chat?.settings.accounts, message.authorId, value, agentDefault);
    setBusy(true);
    try {
      await rpc.call('chats.update', { id: message.conversationId, settings: { accounts: next } });
      await rpc.call('messages.retry', { messageId: message.id });
    } catch (error) { toastError(error, 'Could not switch the account'); } finally { setBusy(false); }
  };
  return (
    <span class="account-actions">
      {others.map((option) => (
        <button type="button" key={option.id} class="text-button" disabled={busy} onClick={() => void use(option.id)}>{`Use ${option.name}`}</button>
      ))}
      <button type="button" class="text-button" disabled={busy} onClick={() => void use(ACCOUNT_AUTO)}>Automatic</button>
    </span>
  );
}
