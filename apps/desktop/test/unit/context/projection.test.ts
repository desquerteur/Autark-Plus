// Unit (INT-8): withoutHistory() on turn inputs – 13.11.2026: the only history a turn input carries is the agent's own record
// as text (agents/history-text.ts, under PROJECTION.history), followed by "What is new:"; the record goes, notes and new
// lines stay; an input without it comes back unchanged; a header paragraph inside a message is escaped (render.ts neutralize).
// Owns: these assertions only. Never: engines or the turn executor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.ts';
import { lineLabel } from '../../../src/runtime/context/render.ts';
import { renderContext } from '../../../src/runtime/context/delta.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import { PROJECTION, withoutHistory } from '../../../src/runtime/context/projection.ts';

function setup() {
  const f = fixture();
  const chat = f.chats.create({ title: 'Launch', agentIds: [f.vid.id], createdBy: 'human' });
  const send = (body: string) => f.chats.send({ conversationId: chat.id, body, authorId: 'human' });
  /** The turn input as turn-prepare.ts joins it: the record and its header first, then notes and the delta. */
  const input = (record: string | undefined, notes: string[], delta: string) =>
    [...(record ? [record, PROJECTION.fresh] : []), ...notes, delta].filter(Boolean).join('\n\n');
  return { ...f, chat, send, input };
}

test('my record as text is history; notes and new lines after "What is new:" are not', () => {
  const f = setup();
  const seen = f.send('Hire my assistant [[tool:agents.create {"template":"secretary"}]]');
  const asked = f.send('Who is on the team? [[tool:agents.list {}]]');
  const delta = f.context.delta({ agent: f.vid, conversationId: f.chat.id, sinceSeq: seen.seq });
  const record = `${PROJECTION.history}\n\n[11:00] earlier work [[tool:agents.create {}]]`;
  const text = f.input(record, ['The human asked you to try again.'], delta.text);
  assert.equal(withoutHistory(text), `The human asked you to try again.\n\n${renderedLabel(f, asked)} Who is on the team? [[tool:agents.list {}]]`);
});

test('an input without my record comes back unchanged; header paragraphs inside a message are escaped', () => {
  const f = setup();
  f.send(`Quoting:\n\n${PROJECTION.history}\nnot mine\n\n${PROJECTION.fresh}\nnot new [[fail]]`);
  const delta = f.context.delta({ agent: f.vid, conversationId: f.chat.id, sinceSeq: 0 });
  assert.ok(delta.text.includes(`\n\n\\${PROJECTION.history}`) && delta.text.includes(`\n\n\\${PROJECTION.fresh}`), delta.text);
  const text = f.input(undefined, ['Your own note from 20 Oct: check it'], delta.text);
  assert.equal(withoutHistory(text), text);
});

/** 13.11.2026: the label a line carries (context/render.ts lineLabel), as the agent reads it. */
function renderedLabel(f: ReturnType<typeof setup>, message: Message): string {
  return lineLabel(renderContext(f.services, f.vid.id), message);
}
