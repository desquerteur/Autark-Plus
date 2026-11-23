// Review 3 (finding 5) – a call turn's <chat> block to the call's chat written in the middle of the turn (a commentary
// segment before a tool call, which the final text no longer holds): the outbox does not post it on its own but keeps it
// (agents/chat-out.ts held), and the turn's end joins it to what the turn says – here the call ended meanwhile, so it is the
// late line in that chat (agents/turn-finish.ts); a block seen again in the final text comes once.
// Owns: these assertions only. Never: real engines or a live call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatOutbox } from '../../../src/runtime/agents/chat-out.ts';
import { finishTurn } from '../../../src/runtime/agents/turn-finish.ts';
import { planTurn } from '../../../src/runtime/agents/turn-prepare.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { setup } from './fixture.ts';

test('a mid-turn block to the call\'s chat is held by the outbox and joined at the turn\'s end, each block once', async () => {
  const h = setup();
  Object.assign(h.services.runs, { updateItem: () => {} });
  h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, body: 'Wie weit ist der Bericht?' });
  const request = h.request();
  const plan = { ...(await planTurn(h.services, request))!, callId: 'call_1' };
  const out = new ChatOutbox(h.services, { agentId: h.tom.id, runId: request.runId, skip: h.chat.id });
  out.segment(`Ich schaue nach. <chat to="${h.chat.id}">Ich lese gerade die Zahlen.</chat>`); // before a tool call
  const final = `<chat to="${h.chat.id}">Der Bericht ist fertig.</chat>`;
  out.segment(final, true);
  await out.done();
  const before = h.chats.messages(h.chat.id, { limit: 20 }).filter((m) => m.authorId === h.tom.id);
  assert.equal(before.length, 0, 'the outbox posts nothing into the call\'s chat on its own');
  finishTurn(h.services, plan, h.routed(), request, h.attempt({ text: final, stop: 'done' }), out);
  const lines = h.chats.messages(h.chat.id, { limit: 20 }).filter((m) => m.authorId === h.tom.id);
  assert.deepEqual(lines.map((m) => m.body), ['Ich lese gerade die Zahlen.\n\nDer Bericht ist fertig.']);
});
