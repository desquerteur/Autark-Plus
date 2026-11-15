// B-080 wave 3 start-time repair (chat/lifecycle.ts reconcileStreaming, MessageRepo.emptyAnswered; live 08.11.: 26 empty
// red or stopped bubbles, each answered by its agent minutes later, their Retry still able to start a turn): at the start
// this PC's empty agent rows that ended 'failed', or 'stopped' by the platform, go when their author answered later in
// the same chat – as the system, so message.removed reaches every client. A row with text, one without a later answer,
// the person's own quiet Stop row and a row synced from another PC (its run is not in this PC's journal) stay.
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { Journal } from '../../../src/runtime/runs/journal.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import { agent, harness } from './harness.ts';

test('at the start an empty failed or platform-stopped row its agent answered later goes; the others stay', () => {
  const h = harness();
  h.org.add(agent('ag_tom', 'Tom'));
  const journal = new Journal({ db: h.db, bus: h.bus, clock: h.clock });
  const chat = h.chats.create({ agentIds: ['ag_tom'], createdBy: HUMAN_ID });
  const lonely = h.chats.create({ agentIds: ['ag_tom'], createdBy: HUMAN_ID });
  const row = (conversationId: string, runId: string, end: { state: 'final' | 'failed' | 'stopped'; body?: string; silent?: boolean; error?: string }, local = true) => {
    if (local) journal.start({ id: runId, agentId: 'ag_tom', conversationId, trigger: 'message' });
    return h.chats.postAgentMessage(conversationId, 'ag_tom', runId, {
      body: end.body ?? '', state: end.state, ...(end.error ? { meta: { error: end.error } } : {}), ...(end.silent ? { silent: true } : {}),
    });
  };
  h.chats.send({ conversationId: chat.id, authorId: HUMAN_ID, body: 'Summarize the report' });
  const failed = row(chat.id, 'run_failed', { state: 'failed', error: 'Every account that can run a suitable model is limited right now.' });
  const cut = row(chat.id, 'run_cut', { state: 'stopped', error: 'Interrupted' });
  const personStop = row(chat.id, 'run_stop', { state: 'stopped', silent: true });
  const withText = row(chat.id, 'run_text', { state: 'stopped', body: 'The report covers three' });
  const synced = row(chat.id, 'run_remote', { state: 'failed', error: 'limited' }, false);
  h.chats.send({ conversationId: chat.id, authorId: 'ag_tom', authorKind: 'agent', body: 'Here is the summary.' });
  const unanswered = row(lonely.id, 'run_lonely', { state: 'failed', error: 'limited' });

  h.chats.reconcileStreaming();
  const gone = (message: Message) => h.chats.message(message.id) === undefined;
  assert.deepEqual([failed, cut].map(gone), [true, true], 'answered later: the empty failed and platform-stopped rows go');
  assert.deepEqual([personStop, withText, synced, unanswered].map(gone), [false, false, false, false], 'the rest stays');
  assert.deepEqual(h.of('message.removed').map((event) => event.id).sort(), [failed.id, cut.id].sort(), 'every client hears it');

  h.chats.reconcileStreaming();
  assert.equal(h.of('message.removed').length, 2, 'once');
});
