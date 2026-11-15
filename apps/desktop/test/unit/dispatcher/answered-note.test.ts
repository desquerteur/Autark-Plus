// B-050 (agents/dispatch-groups.ts answeredNote): work that reaches an agent after it already wrote in that chat without
// the task carries a note naming those lines – for a task created for it (its anchor) and one given to it (the give line).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answeredNote, type WakeGroup } from '../../../src/runtime/agents/dispatch-groups.ts';
import type { Message } from '../../../src/shared/model/chat.ts';

const line = (seq: number, extra: Partial<Message>): Message => ({ seq, authorId: 'ag_ida', kind: 'text', meta: {}, ...extra } as unknown as Message);
const group = { conversationId: 'ch_1', taskId: 'task_1', wakes: [{ taskId: 'task_1', reason: 'task' }] } as unknown as WakeGroup;
const chats = (messages: Message[]) => ({ messages: () => messages });

test('a task created for me: my lines after its anchor are named', () => {
  const note = answeredNote(chats([line(1, { kind: 'task', taskId: 'task_1', authorId: 'ag_jonas' }), line(2, {})]), 'ag_ida', group);
  assert.match(note ?? '', /^I already wrote in this chat after this task reached me \(#2\)/);
});

test('a task given to me: my lines after the give line are named; before it, nothing', () => {
  const give = line(3, { kind: 'status', taskId: 'task_1', authorId: 'ag_jonas', meta: { status: { type: 'handoff', details: { to: 'ag_ida' } } } as never });
  assert.match(answeredNote(chats([line(1, { kind: 'task', taskId: 'task_1' }), line(2, {}), give, line(4, {})]), 'ag_ida', group) ?? '', /\(#4\)/);
  assert.equal(answeredNote(chats([give]), 'ag_ida', group), undefined);
});
