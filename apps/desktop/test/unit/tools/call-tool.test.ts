// B-081: chat.call (src/runtime/tools/builtin/call-tool.ts) with the real chat service and the rings (calls/ring.ts):
// it rings in the run's chat when the person is in it, else in my default 1:1 with the person; `with` takes agents of that
// chat only; a call that already rings or runs there is returned, not rung again (with the note that fits: ringing –
// read in the chat, running – read aloud); its texts speak in my own voice as an option.
// Owns: these assertions only. Never: a real push service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { callRecord } from '../../../src/shared/model/call.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';
import { callLogOf, createCalls, stopCalls } from '../../../src/runtime/calls/wiring.ts';
import { ALREADY_NOTE, CALL_NOTE, MOVED_NOTE, RINGING_NOTE, callTools } from '../../../src/runtime/tools/builtin/call-tool.ts';
import { agent, harness } from '../chat/harness.ts';
import { fakeVoice } from '../calls/voice-fake.ts';

const timers = { set: () => 0, clear: () => undefined };
const tool = callTools.find((one) => one.name === 'chat.call')!;

function setup() {
  const h = harness();
  const ava = h.org.add(agent('ag_ava', 'Ava'));
  h.org.add(agent('ag_ben', 'Ben'));
  h.org.add(agent('ag_lena', 'Lena'));
  Object.assign(h.services, { secrets: { redact: (text: string) => text }, settings: { get: () => ({ profile: { name: 'Gerd' } }) } });
  const services = h.services as RuntimeServices;
  createCalls(services, { voice: fakeVoice(() => '').opener, timers });
  const withPerson = h.chats.create({ agentIds: ['ag_ava', 'ag_ben'], createdBy: HUMAN_ID, lead: 'ag_ava' });
  const agentsOnly = h.chats.create({ agentIds: ['ag_ava', 'ag_lena'], humans: false, createdBy: 'ag_ava' });
  const ctx = (conversationId?: string): ToolContext => ({ agent: ava, runId: 'run_1', mode: 'general', services, signal: new AbortController().signal, status: () => undefined, ...(conversationId ? { conversationId } : {}) });
  const call = async (args: Record<string, unknown>, conversationId?: string) => {
    const out = await tool.run(args, ctx(conversationId));
    return { error: out.isError ? (out.content[0] as { text: string }).text : undefined, result: out.structured as Record<string, any> | undefined };
  };
  const ringRow = (conversationId: string) => h.chats.messages(conversationId, { limit: 20 }).map((m) => callRecord(m)).find(Boolean);
  return { ...h, services, withPerson, agentsOnly, call, ringRow, stop: () => stopCalls(services) };
}

test('it rings in the run\'s chat with the person, with the agents I bring; the result says what reaches them and what happens next', async (t) => {
  const h = setup();
  t.after(h.stop);
  const { result } = await h.call({ why: 'Logo decision', say: 'Gerd, kurz zum Logo.', with: ['Ben'] }, h.withPerson.id);
  assert.equal(result?.ok, true);
  assert.equal(result?.chatId, h.withPerson.id);
  assert.deepEqual(result?.online, { pcs: 1, phones: 0 });
  assert.equal(result?.until, new Date(h.clock.now() + 45_000).toISOString());
  assert.equal(result?.note, CALL_NOTE);
  const record = h.ringRow(h.withPerson.id)!;
  assert.equal(record.id, result?.callId);
  assert.deepEqual([record.ring?.by, record.ring?.why, record.ring?.say, record.agents], ['ag_ava', 'Logo decision', 'Gerd, kurz zum Logo.', ['ag_ava', 'ag_ben']]);
  const again = await h.call({ why: 'Something else' }, h.withPerson.id);
  assert.deepEqual(again.result, { ok: true, already: 'ringing', callId: record.id, chatId: h.withPerson.id, note: RINGING_NOTE });
  callLogOf(h.services)!.take(h.withPerson.id, record.id, { key: 'pc', name: 'Office PC' }); // they picked up
  const running = await h.call({ why: 'Something else' }, h.withPerson.id);
  assert.deepEqual(running.result, { ok: true, already: 'running', callId: record.id, chatId: h.withPerson.id, note: ALREADY_NOTE });
});

test('a run in a chat without the person rings in my default 1:1 with them; with takes agents of that chat only', async (t) => {
  const h = setup();
  t.after(h.stop);
  const refused = await h.call({ why: 'Budget', with: ['Lena'] }, h.agentsOnly.id);
  assert.match(refused.error ?? '', /Lena is no agent of this chat besides me/);
  const { result } = await h.call({ why: 'Budget' }, h.agentsOnly.id);
  assert.notEqual(result?.chatId, h.agentsOnly.id);
  const members = h.chats.members(result?.chatId).map((member) => member.memberId).sort();
  assert.deepEqual(members, [HUMAN_ID, 'ag_ava'].sort());
  assert.equal(h.ringRow(result?.chatId)?.ring?.why, 'Budget');
  assert.equal(result?.note, `${CALL_NOTE} ${MOVED_NOTE}`, 'the result says it rings in my 1:1, not in the chat I am in');
  const none = await h.call({ why: '  ' });
  assert.match(none.error ?? '', /why says what the call is about/);
});

test('the texts are mine: first person, an option, one hint line', () => {
  assert.match(tool.description, /^Rings the person on all their PCs and phones and talks with them in my live voice\. For what a talk settles faster than messages, when they likely have time; a decline or no answer comes back to me as a turn\.$/);
  for (const text of [tool.description, CALL_NOTE, RINGING_NOTE, ALREADY_NOTE, MOVED_NOTE]) assert.doesNotMatch(text, /\b(must|allowed|only if|ask first|never)\b/i);
  assert.match(CALL_NOTE, /my live voice/);
  assert.doesNotMatch(RINGING_NOTE, /read aloud/, 'lines written while it rings are read in the chat, not aloud');
});
