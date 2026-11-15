// The finish of a turn in the one-context model (13.11.2026, agents/turn-finish.ts): lines folded in from another chat
// are seen once the turn ends done (its queued wake there is stale); a failed turn moves nothing. The safety net: a
// person's line woke the turn and the turn addressed nothing – its final text goes into the chat of that person's newest
// line, counted in the log; a turn that addressed a chat posts nothing more. A shutdown cut posts nothing; the person's
// Stop posts what was written as a 'stopped' message.
// Owns: these assertions only. Never: real engines, accounts, timers or sleeps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishTurn } from '../../../src/runtime/agents/turn-finish.ts';
import { planTurn } from '../../../src/runtime/agents/turn-prepare.ts';
import { ChatOutbox } from '../../../src/runtime/agents/chat-out.ts';
import { isStaleMessageGroup, type WakeGroup } from '../../../src/runtime/agents/dispatch-groups.ts';
import type { StopKind } from '../../../src/runtime/agents/turn-types.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { setup } from './fixture.ts';

/** Tom works in his 1:1 (h.chat); chat B ("Launch") is another chat of his where the person wrote while he worked. */
function rig() {
  const h = setup();
  const logged: Array<{ message: string; data?: unknown }> = [];
  h.services.log = { ...h.services.log, info: (message: string, data?: unknown) => { logged.push({ message, data }); } } as typeof h.services.log;
  const asked = h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, body: 'Write the intro' });
  const other = h.chats.create({ title: 'Launch', agentIds: [h.tom.id], createdBy: HUMAN_ID });
  const folded = h.chats.send({ conversationId: other.id, authorId: HUMAN_ID, body: 'Is the launch still on Friday?' });
  const finish = async (result: EngineTurnResult, options: { stopKind?: StopKind; out?: ChatOutbox; noFold?: boolean } = {}) => {
    const others = options.noFold ? new Map() : new Map([[other.id, { seq: folded.seq }]]);
    const request = h.request({ control: { lastSeq: 0, steeredSeq: 0, others, ...(options.stopKind ? { stopKind: options.stopKind } : {}) } });
    const plan = (await planTurn(h.services, request))!;
    return finishTurn(h.services, plan, { ...h.routed(), lastSeq: asked.seq }, request, h.attempt(result), options.out);
  };
  const cursor = () => h.chats.members(other.id).find((member) => member.memberId === h.tom.id)!.readSeq;
  const group = (): WakeGroup => {
    const wakes = h.wakes.list(h.tom.id).filter((wake) => wake.conversationId === other.id && wake.reason === 'message');
    return { conversationId: other.id, wakes, reason: 'message', rank: 0, dueAt: 0, createdAt: 0, priority: 'normal', overdue: false } as unknown as WakeGroup;
  };
  const tomLines = (chatId: string) => h.chats.messages(chatId, { limit: 50 }).filter((message) => message.authorId === h.tom.id && message.kind === 'text');
  return { ...h, other, folded, asked, finish, cursor, group, tomLines, logged };
}

test('a folded line is seen once the turn ends done – its queued message wake is stale; a failed turn moves nothing', async () => {
  const h = rig();
  assert.equal(isStaleMessageGroup(h.chats, h.tom.id, h.group()), false);
  await h.finish({ text: '', stop: 'error', error: { code: 'internal', message: 'boom' } });
  assert.ok(h.cursor() < h.folded.seq, 'a failed turn is delivered again');
  await h.finish({ text: 'Done here.', stop: 'done' });
  assert.ok(h.cursor() >= h.folded.seq, 'seen (its own answer there moves it on)');
  assert.equal(isStaleMessageGroup(h.chats, h.tom.id, h.group()), true, 'one context saw it: no second turn');
});

test('safety net: nothing addressed – the final text goes to the chat of the newest person line, counted in the log', async () => {
  const h = rig();
  await h.finish({ text: 'Thinking aloud.\n\nFriday still holds.', stop: 'done' });
  assert.deepEqual(h.tomLines(h.other.id).map((message) => message.body), ['Thinking aloud.\n\nFriday still holds.'], 'the folded line is the newest');
  assert.deepEqual(h.tomLines(h.chat.id), []);
  assert.equal(h.logged.filter((entry) => entry.message === 'unaddressed answer posted').length, 1);
  const own = rig();
  await own.finish({ text: 'Here is the intro.', stop: 'done' }, { noFold: true });
  assert.deepEqual(own.tomLines(own.chat.id).map((message) => message.body), ['Here is the intro.'], 'without a fold: the wake chat');
});

test('safety net: a turn that addressed a chat posts nothing more – its text outside blocks stays in the run log', async () => {
  const h = rig();
  const out = new ChatOutbox(h.services, { agentId: h.tom.id, runId: 'run_1' });
  const text = `Checking the plan.\n<chat to="${h.other.id}">Yes, Friday 10:00.</chat>`;
  out.segment(text, true);
  await out.done();
  await h.finish({ text, stop: 'done' }, { out });
  assert.deepEqual(h.tomLines(h.other.id).map((message) => message.body), ['Yes, Friday 10:00.']);
  assert.deepEqual(h.tomLines(h.chat.id), []);
  assert.equal(h.logged.filter((entry) => entry.message === 'unaddressed answer posted').length, 0);
});

test('a shutdown cut posts nothing (the partial text is the journal\'s Answer); the person\'s Stop posts a stopped message', async () => {
  const h = rig();
  const request = h.request({ control: { lastSeq: 0, steeredSeq: 0, stopKind: 'shutdown' } });
  const plan = (await planTurn(h.services, request))!;
  finishTurn(h.services, plan, h.routed(), request, h.attempt({ text: '', stop: 'interrupted' }, { streamed: 'The intro starts with' }));
  assert.deepEqual(h.tomLines(h.chat.id), []);
  const answer = h.items.find((item) => item.kind === 'note' && (item.data as { answer?: boolean }).answer);
  assert.equal((answer?.data as { text?: string } | undefined)?.text, 'The intro starts with');
  const stop = h.request({ runId: 'run_2', control: { lastSeq: 0, steeredSeq: 0, stopKind: 'human' } });
  finishTurn(h.services, (await planTurn(h.services, stop))!, h.routed(), stop, h.attempt({ text: '', stop: 'interrupted' }, { streamed: 'The intro starts with' }));
  assert.deepEqual(h.tomLines(h.chat.id).map((message) => [message.state, message.body]), [['stopped', 'The intro starts with']]);
});
