// B-082 "nothing gets lost": voice.retranscribe (rpc/handlers/voice-retry.ts) hears my own sent audio-only message again
// whose hearing failed – the text lands in the body as plain text and `failed` goes; another author's message, one
// without a failed hearing, or a second failure answer with an error. ui.state returns a draft's kept files.
// Owns: these assertions only. Never: a network, real timers beyond setImmediate, or a real engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { Attachment } from '../../../src/shared/model/chat.ts';
import type { FileRef } from '../../../src/shared/model/system.ts';
import { HandlerTable, type HandlerContext } from '../../../src/runtime/rpc/table.ts';
import { register } from '../../../src/runtime/rpc/handlers/voice-retry.ts';
import { dictationOf } from '../../../src/runtime/media/dictation.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { sttSetup, transcriptResponse } from './stt-fixture.ts';
import { wav } from './fixtures.ts';
import { agent } from '../chat/harness.ts';
import { OWNER, TestClient, fakeExtras, rpcFixture } from '../rpc/s1-helpers.ts';

const asAttachment = (file: FileRef): Attachment => ({ fileId: file.id, name: file.name, mime: file.mime, size: file.size });

async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(label);
}

test('voice.retranscribe hears my failed recording again: plain body, marks beside it, `failed` gone', async () => {
  let down = true;
  const t = sttSetup({ respond: () => (down ? new Response('{"error":"busy"}', { status: 500 }) : transcriptResponse('Call ⟦?Ben|40%⟧ at noon.')) });
  try {
    const table = new HandlerTable();
    register(table);
    const ctx = { scope: OWNER, services: t.services, extras: fakeExtras(), topics: new Set(), signal: new AbortController().signal } as HandlerContext;
    const call = (messageId: string) => table.get('voice.retranscribe')!.handler({ messageId } as never, ctx);
    const file = await t.put(wav(1000), 'voice.wav', 'audio/wav');
    const message = t.h.chats.send({ conversationId: t.chat.id, body: '', authorId: 'human', attachments: [asAttachment(file)] });
    await until(() => Boolean(t.h.chats.message(message.id)?.meta.dictation), 'the failed hearing is marked');
    assert.deepEqual(t.h.chats.message(message.id)!.meta.dictation, { fileId: file.id, failed: true });

    await assert.rejects(Promise.resolve(call(message.id)), (error: unknown) => error instanceof WorkforceError && error.code === 'unavailable', 'heard nothing again');
    assert.deepEqual(t.h.chats.message(message.id)!.meta.dictation, { fileId: file.id, failed: true }, 'still failed, nothing lost');

    down = false;
    assert.deepEqual(await call(message.id), { ok: true });
    const stored = t.h.chats.message(message.id)!;
    assert.equal(stored.body, 'Call Ben at noon.');
    assert.deepEqual(stored.meta.marks, { uncertain: [{ start: 5, end: 8, pct: 40, alts: [] }] });
    assert.deepEqual(stored.meta.dictation, { fileId: file.id });

    await assert.rejects(Promise.resolve(call(message.id)), (error: unknown) => error instanceof WorkforceError && error.code === 'conflict', 'nothing failed any more');
    const typed = t.h.chats.send({ conversationId: t.chat.id, body: 'typed', authorId: 'human' });
    await assert.rejects(Promise.resolve(call(typed.id)), (error: unknown) => error instanceof WorkforceError && error.code === 'conflict');
    const theirs = t.h.chats.send({ conversationId: t.chat.id, body: 'mine', authorId: 'ag_ada' });
    await assert.rejects(Promise.resolve(call(theirs.id)), (error: unknown) => error instanceof WorkforceError && error.code === 'forbidden');
    await assert.rejects(Promise.resolve(call('msg_missing')), (error: unknown) => error instanceof WorkforceError && error.code === 'not_found');
  } finally { t.temp.cleanup(); }
});

test('review: a recording whose bytes are not here (and cannot be pulled) answers unavailable at once and leaves nothing running', async () => {
  const t = sttSetup({ respond: () => new Response('{"error":"busy"}', { status: 500 }) });
  try {
    const table = new HandlerTable();
    register(table);
    const ctx = { scope: OWNER, services: t.services, extras: fakeExtras(), topics: new Set(), signal: new AbortController().signal } as HandlerContext;
    const file = await t.put(wav(1000), 'voice.wav', 'audio/wav');
    const message = t.h.chats.send({ conversationId: t.chat.id, body: '', authorId: 'human', attachments: [asAttachment(file)] });
    await until(() => Boolean(t.h.chats.message(message.id)?.meta.dictation), 'the failed hearing is marked');
    rmSync(t.services.files.path(file.id), { force: true });
    const before = t.calls.count;
    await assert.rejects(Promise.resolve(table.get('voice.retranscribe')!.handler({ messageId: message.id } as never, ctx)),
      (error: unknown) => error instanceof WorkforceError && error.code === 'unavailable');
    assert.equal(t.calls.count, before, 'nothing was sent to be heard');
    assert.equal(dictationOf(t.services)?.busy(), false, 'no job left running');
    assert.deepEqual(t.h.chats.message(message.id)!.meta.dictation, { fileId: file.id, failed: true });
  } finally { t.temp.cleanup(); }
});

test('ui.state returns a draft\'s kept files (draftFiles), also for a draft without text', async (t) => {
  const f = rpcFixture();
  t.after(f.cleanup);
  f.org.add(agent('ag_ava', 'Ava'));
  const owner = new TestClient(f.server, OWNER);
  const a = f.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  const take: Attachment = { fileId: 'a'.repeat(64), name: 'Take 12-05.wav', mime: 'audio/wav', size: 64_044, durationMs: 2000 };
  await owner.call('ui.saveDraft', { conversationId: a.id, text: '', attachments: [take] });
  const state = await owner.call<{ drafts: Record<string, string>; draftFiles?: Record<string, Attachment[]> }>('ui.state');
  assert.deepEqual(state.drafts, {});
  assert.deepEqual(state.draftFiles, { [a.id]: [take] });
  await owner.call('ui.saveDraft', { conversationId: a.id, text: '', attachments: [] });
  assert.equal((await owner.call<{ draftFiles?: unknown }>('ui.state')).draftFiles, undefined, 'none left');
});
