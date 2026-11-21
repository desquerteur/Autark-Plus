// B-080 end to end with a REAL provider login (opt-in, uses the person's plan for one small turn):
//   WORKFORCE_E2E_REAL=codex  node --test test/e2e/runtime-real-steer.test.mjs   (or =claude)
// A line the person sends while the agent's turn runs a long shell command goes into that running turn at its next step –
// as in plain Codex and Claude Code –: the turn's answer heeds it, the run journal notes the steer, and no second turn
// is needed for it. The headless runtime starts in a temp profile with the CLI's default login (as runtime-real.test.mjs).
// Skipped unless WORKFORCE_E2E_REAL is set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_EVENTS, startRuntime } from './lib/runtime-client.mjs';

const provider = process.env.WORKFORCE_E2E_REAL;
const SLEEP = process.platform === 'win32' ? 'powershell -NoProfile -Command "Start-Sleep -Seconds 35; Write-Output finished"' : 'sleep 35; echo finished';

test(`real ${provider ?? 'provider'}: a line sent mid-turn reaches the running turn`, { skip: !provider, timeout: 420_000 }, async (t) => {
  const runtime = await startRuntime({ fake: false, keepData: process.env.WORKFORCE_E2E_KEEP === '1' });
  t.after(() => runtime.stop());
  const { client } = runtime;
  await client.call('accounts.detect', { force: true });
  const accounts = await client.call('accounts.list');
  const account = accounts.find((item) => item.provider === provider && item.state === 'ok');
  assert.ok(account, `a logged-in ${provider} CLI is detected`);
  for (const other of accounts) if (other.id !== account.id) await client.call('accounts.update', { id: other.id, enabled: false });
  const models = (await client.call('models.list', { refresh: true })).filter((model) => model.provider === provider && model.available);
  const order = { cheap: 0, strong: 1, frontier: 2 };
  const model = [...models].sort((a, b) => (order[a.tier] ?? 1) - (order[b.tier] ?? 1) || (a.relCost ?? 1) - (b.relCost ?? 1))[0];
  const manager = (await client.call('agents.list')).find((agent) => agent.template === 'manager');
  await client.call('events.subscribe', { topics: ['chats', 'org', `runs:${manager.id}`] });
  const chat = await client.call('chats.create', { title: 'Steer check', agentIds: [manager.id] });
  await client.call('events.subscribe', { topics: [`chat:${chat.id}`] });
  await client.call('models.setPolicy', { agentId: manager.id, conversationId: chat.id, policy: { pin: model.id, effort: model.efforts.includes('low') ? 'low' : model.defaultEffort } });

  await client.call('messages.send', { conversationId: chat.id, body: `Run exactly this shell command with your shell tool and wait for it to finish: ${SLEEP}\nThen reply in one short line with the word DONE.` });
  const call = await client.waitFor('run.item', (item) => item.kind === 'tool_call', 240_000);
  t.diagnostic(`tool call ${call.name} in run ${call.runId}`);
  await new Promise((resolve) => setTimeout(resolve, 3000)); // the command is running now
  const sentAt = Date.now();
  await client.call('messages.send', { conversationId: chat.id, body: 'One more thing for the same reply: end it with the word BANANA.' });
  const reply = await client.waitFor(MESSAGE_EVENTS, (message) => message.conversationId === chat.id && message.authorId === manager.id && message.state === 'final' && /DONE/i.test(message.body), 300_000);
  t.diagnostic(`model ${model.id}: ${reply.body.slice(0, 200)} (${Math.round((Date.now() - sentAt) / 1000)} s after the second line)`);
  const steered = client.events.some((frame) => frame.event === 'run.item' && frame.data.runId === call.runId && frame.data.kind === 'note' && frame.data.data?.steered);
  assert.ok(steered, 'the run journal notes the steer into the running turn');
  assert.match(reply.body, /BANANA/i, 'the running turn heeded the line it got mid-turn');
  const runs = (await client.call('agents.runs', { id: manager.id })).filter((run) => run.conversationId === chat.id);
  t.diagnostic(`runs in the chat: ${runs.length}`);
});
