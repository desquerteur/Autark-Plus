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
import type { StopKind, TurnRequest } from '../../../src/runtime/agents/turn-types.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { agent } from '../chat/harness.ts';
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

// 15.11.2026 privacy fix (found at the installed 0.3.6, chat/addressed.ts): the net answers only a person's line delivery gave
// this agent as its own. A colleague given a task in the person's chat had posted its closing text there – the person's line
// to the manager stood unseen in its input. Negative: a line to someone else (before or after the join, in the same
// millisecond, by @mention or by the responder pick); positive: a direct line and one addressed into a running task turn.
function room(agents: 'ida' | 'ida+tom', options: { sameTick?: boolean } = {}) {
  const h = setup();
  const logged: string[] = [];
  h.services.log = { ...h.services.log, info: (message: string) => { logged.push(message); } } as typeof h.services.log;
  const ida = h.org.add(agent('ag_ida', 'Ida'));
  const chat = h.chats.create({ title: 'Report', agentIds: agents === 'ida' ? [ida.id] : [ida.id, h.tom.id], createdBy: HUMAN_ID });
  const finish = async (reason: TurnRequest['reason'], options: { lastSeq?: number; steeredSeq?: number } = {}) => {
    const request = h.request({ conversationId: chat.id, reason, control: { lastSeq: options.lastSeq ?? 0, steeredSeq: options.steeredSeq ?? 0 } });
    const plan = (await planTurn(h.services, request))!;
    const seen = h.chats.messages(chat.id, { limit: 50 }).at(-1)!.seq;
    return finishTurn(h.services, plan, { ...h.routed(), lastSeq: options.lastSeq ?? seen }, request, h.attempt({ text: 'Done with the task.', stop: 'done' }));
  };
  const join = () => { if (!options.sameTick) h.clock.advance(1_000); h.chats.setMembers(chat.id, { add: [h.tom.id] }, ida.id); };
  const tomLines = () => h.chats.messages(chat.id, { limit: 50 }).filter((message) => message.authorId === h.tom.id && message.kind === 'text').map((message) => message.body);
  const net = () => logged.filter((message) => message === 'unaddressed answer posted').length;
  return { ...h, ida, chat, finish, join, tomLines, net };
}

test('privacy: a colleague given a task in the person\'s chat posts nothing – the person\'s line was the manager\'s (+1 s and the same tick)', async () => {
  for (const sameTick of [false, true]) {
    const h = room('ida', { sameTick });
    h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, body: 'Please have Tom collect three facts and tell me.' });
    h.join();
    await h.finish('task');
    assert.deepEqual(h.tomLines(), [], `the closing text stays in the run log (same tick: ${sameTick})`);
    assert.equal(h.net(), 0);
    const answer = h.items.find((item) => item.kind === 'note' && (item.data as { answer?: boolean }).answer);
    assert.equal((answer?.data as { visibility?: string } | undefined)?.visibility, 'internal');
  }
});

test('privacy: a member woken by a colleague posts nothing – the person\'s unseen line was to someone else (@mention, responder pick)', async () => {
  const mentioned = room('ida+tom');
  mentioned.chats.send({ conversationId: mentioned.chat.id, authorId: HUMAN_ID, body: '@Ida please write the report', mentions: ['ag_ida'] });
  mentioned.chats.send({ conversationId: mentioned.chat.id, authorId: 'ag_ida', body: '@Tom please start', mentions: [mentioned.tom.id] });
  await mentioned.finish('message');
  assert.deepEqual(mentioned.tomLines(), [], 'an @mention of Ida is never Tom\'s');
  assert.equal(mentioned.net(), 0);

  const picked = room('ida+tom'); // no decision model: the lead (Ida) takes a line without @
  picked.chats.send({ conversationId: picked.chat.id, authorId: HUMAN_ID, body: 'Who writes the report?' });
  await picked.finish('task');
  assert.deepEqual(picked.tomLines(), [], 'the responder is Ida, not Tom');
  assert.equal(picked.net(), 0);
});

test('privacy fix keeps the net: a person\'s line to the agent, and one addressed into its running task turn', async () => {
  const direct = room('ida+tom');
  direct.chats.send({ conversationId: direct.chat.id, authorId: HUMAN_ID, body: '@Tom how far are you?', mentions: [direct.tom.id] });
  await direct.finish('message');
  assert.deepEqual(direct.tomLines(), ['Done with the task.'], 'the line woke Tom');
  assert.equal(direct.net(), 1);

  const during = room('ida');
  during.join();
  const input = during.chats.messages(during.chat.id, { limit: 50 }).at(-1)!.seq;
  during.clock.advance(1_000);
  const asked = during.chats.send({ conversationId: during.chat.id, authorId: HUMAN_ID, body: '@Tom are you done?', mentions: [during.tom.id] });
  await during.finish('task', { lastSeq: input, steeredSeq: asked.seq });
  assert.deepEqual(during.tomLines(), ['Done with the task.'], 'the line addressed into the running task turn');
  assert.equal(during.net(), 1);
});
