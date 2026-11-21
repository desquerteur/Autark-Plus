// A call line the voice handed over (delivery marked it as the agent's own) was not answered on the call. When the call
// ends before the work answers, that turn's answer still reaches the person: a person's direct line gets that turn's
// answer (FIXES-3b, owner 18.11.2026; wave-3b review R1). Owns: these assertions only. Never: real engines, accounts or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishTurn } from '../../../src/runtime/agents/turn-finish.ts';
import { TurnExecutor } from '../../../src/runtime/agents/turn.ts';
import { MessageRepo } from '../../../src/runtime/chat/message-repo.ts';
import { planTurn } from '../../../src/runtime/agents/turn-prepare.ts';
import { addressedSeqs, markAddressed } from '../../../src/runtime/chat/addressed.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { setup } from './fixture.ts';

test('a handed-over call line whose call ended before the work answered gets that turn\'s answer (wave-3b review R1)', async () => {
  const h = setup();
  h.chats.send({
    conversationId: h.chat.id, body: 'Call call_gone', kind: 'status', silent: true, authorId: 'system', authorKind: 'system',
    meta: { status: { type: 'note', text: 'Call call_gone' }, call: { id: 'call_gone', participant: 'device:pc', name: 'PC', startedAt: 1, endedAt: 5, lines: [] } },
  });
  const line = h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, authorKind: 'human', body: 'Ist die Märzrechnung schon bezahlt? Ich warte kurz.', silent: true, speech: { source: 'endpoint', live: true }, meta: { call: { id: 'call_gone', participant: 'device:pc', name: 'PC' } } } as never);
  markAddressed(h.services, line, [h.tom.id]); // the voice handed it over: delivery marked it as Tom's
  const request = h.request({ notes: [{ text: 'From the call: check whether the March invoice is paid.', at: 0 }] });
  const plan = (await planTurn(h.services, request))!;
  finishTurn(h.services, plan, { ...h.routed(), lastSeq: line.seq }, request, h.attempt({ text: 'Die Märzrechnung ist noch offen.', stop: 'done' }));
  assert.deepEqual(h.chats.messages(h.chat.id, { limit: 20 }).filter((message) => message.authorId === h.tom.id).map((message) => message.body), ['Die Märzrechnung ist noch offen.']);
});

test('a call that ends while its turn runs: the person\'s line still gets that turn\'s answer, as a normal line (wave-3b review R1/R2)', async () => {
  const h = setup();
  h.services.router = { route: async () => h.route } as typeof h.services.router;
  const row = h.chats.send({
    conversationId: h.chat.id, body: 'Call call_three', kind: 'status', silent: true, authorId: 'system', authorKind: 'system',
    meta: { status: { type: 'note', text: 'Call call_three' }, call: { id: 'call_three', participant: 'device:pc', name: 'You', startedAt: 1, lines: [] } },
  });
  const line = h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Spoken, then hung up', meta: { call: { id: 'call_three', participant: 'device:pc', name: 'You' } } });
  assert.ok(addressedSeqs(h.services, h.tom.id, h.chat.id).has(line.seq), 'delivery gave the line to Tom');
  h.state.script = async () => {
    new MessageRepo(h.services.db).update({ ...row, meta: { ...row.meta, call: { ...row.meta.call!, endedAt: 9 } } as typeof row.meta });
    return { text: 'Ready.', stop: 'done' };
  };
  const late = await new TurnExecutor(() => h.services).execute(h.request({ runId: 'run_late' }));
  assert.ok(late.messageId, 'the answer was posted');
  assert.equal(h.chats.message(late.messageId)?.body, 'Ready.');
  assert.equal(h.chats.message(late.messageId)?.meta.call, undefined, 'not spoken in the ended call');
});
