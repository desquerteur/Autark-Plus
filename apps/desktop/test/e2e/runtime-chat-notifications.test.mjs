// End-to-end (C3): per-chat notification levels over the real headless runtime (demo engine, temp
// profile) and real WebSocket RPC. The demo engine echoes the person's message, so "@CEO" in it
// makes the agent's reply mention the person. KI-Runde 17.11.2026 (contract 5.7): an agent's
// @mention of the person addresses its line and stays a 'reply' – the chat's unread count carries
// it, no toast and no push; "All messages" toasts replies; "Mentions and tasks" is the one level
// where that mention arrives as 'important' with a toast; Off leaves it a reply without a toast.
// Run: npm run build && node --test test/e2e/runtime-chat-notifications.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRuntime, waitForNew } from './lib/runtime-client.mjs';

test('an agent\'s @mention of the person is a reply; "All messages" toasts it, "Mentions and tasks" makes it important', { timeout: 300_000 }, async (t) => {
  const live = await startRuntime();
  t.after(() => live.stop());
  await live.client.call('events.subscribe', { topics: ['chats', 'system'] });
  const chat = (await live.client.call('chats.list'))[0];
  assert.ok(chat, 'the manager\'s first chat');

  /** Sends a message that the demo engine echoes with "@CEO" and returns the reply's notification. */
  const replyNote = async (body) => {
    const next = waitForNew(live.client, 'notify', (note) => note.conversationId === chat.id && (note.kind === 'reply' || note.kind === 'important'), 90_000);
    await live.client.call('messages.send', { conversationId: chat.id, body });
    return next;
  };

  const plain = await replyNote('First check, @CEO');
  assert.equal(plain.kind, 'reply', 'a default chat announces the mention as a reply');
  assert.equal(plain.toast, false, 'no toast: the chat\'s unread count carries it');

  await live.client.call('chats.update', { id: chat.id, settings: { notifications: 'off' } });
  const muted = await replyNote('Second check, @CEO');
  assert.equal(muted.kind, 'reply');
  assert.equal(muted.toast, false, 'Off: no toast (and no push) for the same reply');

  await live.client.call('chats.update', { id: chat.id, settings: { notifications: 'all' } });
  const loud = await replyNote('Third check, @CEO');
  assert.equal(loud.kind, 'reply');
  assert.equal(loud.toast, true, 'All messages: the reply toasts');

  await live.client.call('chats.update', { id: chat.id, settings: { notifications: 'mentions' } });
  const mentioned = await replyNote('Fourth check, @CEO');
  assert.equal(mentioned.kind, 'important', 'Mentions and tasks: the mention of the person is important');
  assert.equal(mentioned.toast, true, 'and it toasts');
});
