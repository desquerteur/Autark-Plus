// chat.notes.write: the one write of a chat's shared notes – a whole write replaces the text, append adds at the end
// (several writers lose nothing); an empty append changes nothing.
// Owns: these assertions only. Never: real engines or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxFor, setup } from './helpers.ts';
import { notesTools } from '../../../src/runtime/tools/builtin/notes.ts';
import { getNotes } from '../../../src/runtime/notes/store.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';

const write = notesTools.find((tool) => tool.name === 'chat.notes.write')!;

test('chat.notes.write replaces the whole text, or adds at the end with append; there is no second write tool', async () => {
  const h = setup();
  const services = h.services as RuntimeServices;
  assert.deepEqual(notesTools.map((tool) => tool.name), ['chat.notes.read', 'chat.notes.write']);
  assert.equal((await write.run({ text: 'Plan: launch Friday.' }, ctxFor(h))).isError, undefined);
  assert.equal((await write.run({ text: 'Ben: venue booked.', append: true }, ctxFor(h))).isError, undefined);
  assert.equal(getNotes(services, h.chat.id).text, 'Plan: launch Friday.\n\nBen: venue booked.\n');
  assert.equal((await write.run({ text: '  ', append: true }, ctxFor(h))).isError, true, 'nothing to add');
  await write.run({ text: 'Fresh start.' }, ctxFor(h));
  assert.equal(getNotes(services, h.chat.id).text, 'Fresh start.');
});
