// The person's line arrives whole (KI-Runde 17.11.2026, contract 5.10): a 21,000-character dictation whose ask is its last
// sentence reaches the turn that answers it uncut (context/render.ts renderMessages `suggestions`, BODY_CAP not applied
// to a person's new line), and chat.read {seq} returns that line alone, whole, past the output head cut (tools/outputs.ts
// whole). Older lines and an agent's long line keep their cap.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';
import { renderContext } from '../../../src/runtime/context/delta.ts';
import { BODY_CAP, renderMessages } from '../../../src/runtime/context/render.ts';
import { chatTools } from '../../../src/runtime/tools/builtin/chat.ts';
import { MAX_TEXT_CHARS, finalizeOutput } from '../../../src/runtime/tools/outputs.ts';
import { agent, harness } from '../chat/harness.ts';

const ASK = 'Bitte jetzt das bauen, was sehr einfach ist, und mir den Text in der Seitenleiste geben.';

test('a 21,000-character line of the person whose last sentence is the ask: whole in the turn and in chat.read', async () => {
  const h = harness();
  h.org.add(agent('ag_kon', 'Konrad'));
  const chat = h.chats.create({ agentIds: ['ag_kon'], createdBy: HUMAN_ID });
  const body = `${'Ich erzähle dir, wie das System arbeiten soll. '.repeat(Math.ceil((21_000 - ASK.length) / 47)).slice(0, 21_000 - ASK.length - 1)} ${ASK}`;
  assert.equal(body.length, 21_000);
  const line = h.chats.send({ conversationId: chat.id, authorId: HUMAN_ID, body });
  const rctx = renderContext(h.services as RuntimeServices, 'ag_kon');

  const turn = renderMessages(rctx, [line], { images: false, suggestions: true }).lines.join('\n');
  assert.ok(turn.endsWith(ASK), 'the turn that answers it reads the ask');
  assert.ok(!turn.includes('[truncated'));
  const later = renderMessages(rctx, [line], { images: false }).lines.join('\n');
  assert.ok(later.includes('[truncated') && later.length < BODY_CAP + 300, 'an older line keeps its cap');
  const agentLine = h.chats.send({ conversationId: chat.id, authorId: 'ag_kon', body });
  assert.ok(renderMessages(rctx, [agentLine], { images: false, suggestions: true }).lines.join('\n').includes('[truncated'), 'an agent\u2019s long line keeps its cap');

  const ctx = { agent: h.org.get('ag_kon')!, runId: 'run_kon', conversationId: chat.id, mode: 'general', services: h.services as RuntimeServices,
    signal: new AbortController().signal, status: () => {} } as unknown as ToolContext;
  const read = await chatTools.find((tool) => tool.name === 'chat.read')!.run({ seq: line.seq } as never, ctx);
  const files = { put: async () => ({ id: 'blob_1' }), path: () => 'C:/blobs/blob_1' } as unknown as Parameters<typeof finalizeOutput>[1]['files'];
  const { output, blobIds } = await finalizeOutput(read, { secrets: { redact: (value: string) => value } as never, files }, 'chat.read');
  const text = (output.content[0] as { text: string }).text;
  assert.ok(text.length > MAX_TEXT_CHARS - 4000 && text.endsWith(ASK), 'chat.read {seq} returns the line whole');
  assert.equal(text.split(ASK).length, 2, 'the text once, not the cut line plus the full text');
  assert.deepEqual(blobIds, [], 'no head cut, nothing stored aside');

  const longer = h.chats.send({ conversationId: chat.id, authorId: HUMAN_ID, body: `${'z '.repeat(15_000)}${ASK}` });
  const past = await finalizeOutput(await chatTools.find((tool) => tool.name === 'chat.read')!.run({ seq: longer.seq } as never, ctx), { secrets: { redact: (value: string) => value } as never, files }, 'chat.read');
  assert.ok((past.output.content[0] as { text: string }).text.endsWith(ASK), 'a line past the output cap comes whole too');

  const big = { content: [{ type: 'text' as const, text: 'x'.repeat(MAX_TEXT_CHARS + 10) }] };
  assert.equal(((await finalizeOutput(big, { secrets: { redact: (value: string) => value } as never, files }, 'shell.exec')).output.content[0] as { text: string }).text.length < MAX_TEXT_CHARS, true, 'any other big output is still cut');
});

test('"whole" has one bound: a 500,000-character line comes as its head and tail with the line naming the stored file between', async () => {
  const { WHOLE_CHARS } = await import('../../../src/runtime/tools/outputs.ts');
  const h = harness();
  h.org.add(agent('ag_kon', 'Konrad'));
  const chat = h.chats.create({ agentIds: ['ag_kon'], createdBy: HUMAN_ID });
  const line = h.chats.send({ conversationId: chat.id, authorId: HUMAN_ID, body: `START ${'log line 1234567890\n'.repeat(25_000)}${ASK}` });
  assert.ok(line.body.length > 400_000);
  const rctx = renderContext(h.services as RuntimeServices, 'ag_kon');

  const turn = renderMessages(rctx, [line], { images: false, suggestions: true }).lines.join('\n');
  assert.ok(turn.length < WHOLE_CHARS + 1_000, `the turn holds at most the bound (${turn.length})`);
  assert.ok(turn.includes('START') && turn.endsWith(ASK), 'its head and its tail with the ask');
  assert.match(turn, new RegExp(`chars of #${line.seq} left out here; chat\.read \{seq: ${line.seq}\}`), 'the line between names where all of it is');

  const ctx = { agent: h.org.get('ag_kon')!, runId: 'run_kon', conversationId: chat.id, mode: 'general', services: h.services as RuntimeServices,
    signal: new AbortController().signal, status: () => {} } as unknown as ToolContext;
  const stored: Uint8Array[] = [];
  const files = { put: async (bytes: Uint8Array) => { stored.push(bytes); return { id: 'blob_1' }; }, path: () => 'C:/blobs/blob_1' } as unknown as Parameters<typeof finalizeOutput>[1]['files'];
  for (const round of [1, 2]) {
    const read = await chatTools.find((tool) => tool.name === 'chat.read')!.run({ seq: line.seq } as never, ctx);
    const { output, blobIds } = await finalizeOutput(read, { secrets: { redact: (value: string) => value } as never, files }, 'chat.read');
    const text = (output.content[0] as { text: string }).text;
    assert.ok(text.length < WHOLE_CHARS + 1_000, `chat.read #${round} holds at most the bound (${text.length})`);
    assert.ok(text.includes('START') && text.endsWith(ASK), 'head and tail');
    assert.ok(text.includes('files.read path: "C:/blobs/blob_1"'), 'the line between names the file that holds all of it');
    assert.deepEqual(blobIds, ['blob_1']);
  }
  assert.ok(new TextDecoder().decode(stored[0]).includes(ASK) && stored[0].length > 400_000, 'the file holds the whole line');
});

test('a line of exactly the bound comes whole from chat.read too, its label beside it', async () => {
  const { WHOLE_CHARS } = await import('../../../src/runtime/tools/outputs.ts');
  const h = harness();
  h.org.add(agent('ag_kon', 'Konrad'));
  const chat = h.chats.create({ agentIds: ['ag_kon'], createdBy: HUMAN_ID });
  const body = `${'x'.repeat(WHOLE_CHARS - ASK.length - 1)} ${ASK}`;
  const line = h.chats.send({ conversationId: chat.id, authorId: HUMAN_ID, body });
  const rctx = renderContext(h.services as RuntimeServices, 'ag_kon');
  assert.ok(renderMessages(rctx, [line], { images: false, suggestions: true }).lines.join('\n').includes(body), 'the turn has it whole');
  const ctx = { agent: h.org.get('ag_kon')!, runId: 'run_kon', conversationId: chat.id, mode: 'general', services: h.services as RuntimeServices,
    signal: new AbortController().signal, status: () => {} } as unknown as ToolContext;
  const files = { put: async () => ({ id: 'blob_1' }), path: () => 'C:/blobs/blob_1' } as unknown as Parameters<typeof finalizeOutput>[1]['files'];
  const read = await chatTools.find((tool) => tool.name === 'chat.read')!.run({ seq: line.seq } as never, ctx);
  const { output, blobIds } = await finalizeOutput(read, { secrets: { redact: (value: string) => value } as never, files }, 'chat.read');
  assert.ok((output.content[0] as { text: string }).text.includes(body), 'chat.read has it whole as well');
  assert.deepEqual(blobIds, []);
});
