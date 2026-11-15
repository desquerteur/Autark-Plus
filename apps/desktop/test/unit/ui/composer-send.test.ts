// The composer's one send path (src/ui/chat/composer/send.ts) with the level commands (composer/slash.ts,
// B-050 K4): Send and "/silent text" or "/important text" send the whole draft – its files, secret
// handles and reply – at their level, and the draft is fresh afterwards, so nothing goes out a second time
// with the next message; a failed send gives the draft back as it was typed. silent: true only for Silent.
// Owns: these assertions only. Never: a real runtime (rpc.call is a fake) or rendering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Attachment, ConversationSummary, MessageLevel } from '../../../src/shared/model/chat.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';

const sent: Array<Record<string, unknown>> = [];
let fail = false;
(rpc as unknown as { call: unknown }).call = async (method: string, params: Record<string, unknown>) => {
  if (method !== 'messages.send') return { ok: true };
  if (fail) throw new Error('offline');
  sent.push(params);
  return { id: 'msg_1' };
};
const { draftFor, updateDraft } = await import('../../../src/ui/chat/composer/draft.ts');
const { sendDraft } = await import('../../../src/ui/chat/composer/send.ts');
const { parseSlash, runSlash } = await import('../../../src/ui/chat/composer/slash.ts');
const { session } = await import('../../../src/ui/lib/session.ts');

const FILE: Attachment = { fileId: 'b'.repeat(64), name: 'report.pdf', mime: 'application/pdf', size: 12 };
const send = (conversationId: string, body: string, level: MessageLevel) => sendDraft({ conversationId, body, level, mentions: () => [] });

/** Types `text` into a draft that carries a file, a secret handle and a reply. */
function fill(conversationId: string, text: string, level: MessageLevel = 'normal'): void {
  updateDraft(conversationId, { text, attachments: [FILE], secrets: ['sec_1'], replyTo: 'msg_0', level });
}

/** The composer's Enter on a level command (Composer.tsx send → runSlash with its send). */
async function enter(conversationId: string): Promise<void> {
  const draft = draftFor(conversationId);
  const command = parseSlash(draft.peek().text);
  assert.ok(command, 'a level command');
  const clear = await runSlash(command, {
    chat: { id: conversationId } as ConversationSummary, openModelMenu: () => undefined,
    setLevel: (level) => updateDraft(conversationId, { level }),
    send: (body, options) => send(conversationId, body, options?.level ?? draft.peek().level),
  });
  if (clear) updateDraft(conversationId, { text: '' });
}

test('"/silent text" sends the draft\'s file, secret and reply silently, then the draft is fresh – the next message carries none of them', async () => {
  session.value = { kind: 'owner', capabilities: [], secure: true, allowedMethods: [] };
  sent.length = 0;
  fill('ch_slash', '/silent see attached');
  await enter('ch_slash');
  assert.equal(sent.length, 1);
  assert.deepEqual({ body: sent[0].body, attachments: sent[0].attachments, secrets: sent[0].secrets, replyTo: sent[0].replyTo, priority: sent[0].priority, silent: sent[0].silent },
    { body: 'see attached', attachments: [FILE], secrets: ['sec_1'], replyTo: 'msg_0', priority: 'normal', silent: true });
  const after = draftFor('ch_slash').peek();
  assert.deepEqual({ text: after.text, attachments: after.attachments, secrets: after.secrets ?? [], replyTo: after.replyTo, level: after.level },
    { text: '', attachments: [], secrets: [], replyTo: undefined, level: 'normal' });
  updateDraft('ch_slash', { text: 'next one' });
  await send('ch_slash', 'next one', draftFor('ch_slash').peek().level);
  assert.equal(sent[1].attachments, undefined, 'the file went out once');
  assert.equal(sent[1].secrets, undefined);
  assert.equal(sent[1].replyTo, undefined);
  assert.equal('silent' in sent[1], false, 'a normal message sends no silent key');
});

test('"/important text" goes out important with the draft; Send uses the draft\'s level', async () => {
  sent.length = 0;
  fill('ch_important', '/important call me');
  await enter('ch_important');
  assert.deepEqual([sent[0].body, sent[0].priority, sent[0].attachments], ['call me', 'important', [FILE]]);
  fill('ch_level', 'quiet note', 'silent');
  await send('ch_level', 'quiet note', draftFor('ch_level').peek().level);
  assert.deepEqual([sent[1].priority, sent[1].silent], ['normal', true]);
  assert.equal(draftFor('ch_level').peek().level, 'normal', 'back to normal once sent');
});

test('a failed send gives the draft back as typed – the command, its file, secret and reply', async () => {
  sent.length = 0;
  fail = true;
  fill('ch_fail', '/silent see attached');
  await enter('ch_fail');
  fail = false;
  const back = draftFor('ch_fail').peek();
  assert.deepEqual({ text: back.text, attachments: back.attachments, secrets: back.secrets, replyTo: back.replyTo },
    { text: '/silent see attached', attachments: [FILE], secrets: ['sec_1'], replyTo: 'msg_0' });
});

test('B-082: the hidden marks go out beside the plain body (only when there are some) and come back with a failed send', async () => {
  sent.length = 0;
  const text = 'ask Kodex now';
  const marks = { uncertain: [{ start: 4, end: 9, pct: 55, alts: [{ t: 'Codex', pct: 40 }] }], dictated: [{ start: 4, end: 13 }] };
  updateDraft('ch_marks', { text: `/important ${text}`, marks: { uncertain: marks.uncertain.map((m) => ({ ...m, start: m.start + 11, end: m.end + 11 })), dictated: [{ start: 15, end: 24 }] } });
  await enter('ch_marks');
  assert.equal(sent[0].body, text);
  assert.deepEqual(sent[0].marks, marks, 'moved to the sent text');
  assert.equal(draftFor('ch_marks').peek().marks, undefined, 'the fresh draft has none');
  updateDraft('ch_marks', { text: 'typed only' });
  await send('ch_marks', 'typed only', 'normal');
  assert.equal('marks' in sent[1], false, 'no marks key without marks');
  fail = true;
  updateDraft('ch_marks', { text, marks });
  await send('ch_marks', text, 'normal');
  fail = false;
  assert.deepEqual(draftFor('ch_marks').peek().marks, marks, 'back with the text');
  updateDraft('ch_marks', { text: `${text}!` });
  assert.deepEqual(draftFor('ch_marks').peek().marks, marks, 'typing after them keeps them (updateDraft moves marks along)');
  updateDraft('ch_marks', { text: 'ask Kodax now!' });
  assert.equal(draftFor('ch_marks').peek().marks?.uncertain, undefined, 'typing into the unsure word drops it');
});
