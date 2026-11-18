// 18.11.2026 (Mika, window check of the installed build): a chat whose newest line was a quick question showed the raw
// word "[choice]" in the chat list. previewText labels a ui block by its title, else its question, else its type.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewText } from '../../../src/shared/text/chat-names.ts';

const block = (json: string) => `\`\`\`ui\n${json}\n\`\`\``;

test('a quick question is labelled by its question, a titled block by its title, a block with neither by its type', () => {
  assert.equal(previewText(block('{"type":"choice","question":"Install local.2 at 13:30?","options":["Yes","No"]}')), '[Install local.2 at 13:30?]');
  assert.equal(previewText(block('{"type":"form","title":"Account","fields":[]}')), '[Account]');
  assert.equal(previewText(block('{"type":"choice","title":"Window","question":"Which one?","options":["a"]}')), '[Window]', 'the title wins');
  assert.equal(previewText(block('{"type":"timer","seconds":60}')), '[timer]');
  assert.equal(previewText(block('{"type":"choice","options":["a","b"]}')), '[choice]');
});

test('an escaped quote in the question reads as the quote; a long question is cut', () => {
  assert.equal(previewText(block('{"type":"choice","question":"Say \\"yes\\" or no","options":["a"]}')), '[Say "yes" or no]');
  assert.ok(previewText(block(`{"type":"choice","question":"${'long '.repeat(80)}","options":["a"]}`)).length <= 120);
});
