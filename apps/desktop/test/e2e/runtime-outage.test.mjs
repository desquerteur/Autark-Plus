// End-to-end (T04): an outage neither stalls nor blocks a task, and its end resumes the task at
// once – over the real headless runtime (built app/runtime-cli.mjs) with the deterministic fake
// engine and real WebSocket RPC.
// Covers: with the only (demo) account disabled, the task turn cannot start; the task stays open,
// its chat gets one quiet "Paused: … – continues by itself" line and its next look is at least about
// a minute later (tasks/next.ts lookAfterTurn: an outage waits the stall pause, at most 30 min);
// enabling the account again (account.upserted / models.updated) brings that look forward
// (tasks/watch.ts outagesEnded), and its next turn runs on the fake engine.
// Run: npm run build && node --test test/e2e/runtime-outage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRuntime } from './lib/runtime-client.mjs';

test('an outage pauses a task without blocking it; the end of the outage resumes it', { timeout: 240_000 }, async (t) => {
  const runtime = await startRuntime();
  t.after(() => runtime.stop());
  const { client } = runtime;
  await client.call('events.subscribe', { topics: ['chats', 'tasks', 'org', 'system'] });
  const agents = await client.call('agents.list');
  const manager = agents.find((agent) => agent.template === 'manager') ?? agents[0];
  assert.ok(manager, 'the first run seeds a manager');
  const [demo] = await client.call('accounts.list');
  assert.ok(demo, 'demo mode seeds one fake-engine account');

  await client.call('accounts.update', { id: demo.id, enabled: false });
  const chat = await client.call('chats.create', { title: 'Outage', agentIds: [manager.id] });
  await client.call('events.subscribe', { topics: [`chat:${chat.id}`, `runs:${manager.id}`] });
  const task = await client.call('tasks.create', { conversationId: chat.id, title: 'Summarize the launch notes', to: manager.id });

  const failedRun = await client.waitFor('run.upserted', (run) => run.taskId === task.id && run.status === 'failed', 90_000);
  const line = await client.waitFor('message.created', (message) => message.conversationId === chat.id && message.meta?.status?.details?.outage === true, 90_000);
  assert.match(line.body, /^Paused: .+ – continues by itself$/, 'one quiet line, no failed bubble');
  const failed = await client.waitFor('task.upserted', (item) => item.id === task.id && (item.nextAt ?? 0) > (failedRun.endedAt ?? 0), 90_000);
  assert.equal(failed.status, 'open', 'not paused or ended by the outage');
  assert.ok(failed.nextAt - Date.now() > 30_000, 'the next try waits about a minute or longer');

  const enabledAt = Date.now();
  await client.call('accounts.update', { id: demo.id, enabled: true });
  const resumed = await client.waitFor('run.upserted', (run) => run.taskId === task.id && run.status === 'done' && (run.startedAt ?? 0) >= enabledAt, 50_000);
  assert.ok(Date.now() - enabledAt < 50_000, 're-woken by the event, not by the backoff');
  assert.equal(resumed.agentId, manager.id);
  assert.equal((await client.call('tasks.get', { id: task.id })).status, 'open');
  // The fake engine only echoes, so the task would keep continuing (paced); stop it here.
  await client.call('tasks.finish', { id: task.id, status: 'dropped' });
});
