// ToolOutput → MCP CallToolResult (mcp/convert.ts). B-080: the result carries the text and images only – Claude Code
// hands an agent nothing but structuredContent when it is there, so a page snapshot or a UI tree read as {"url","tab"}.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorResult, toCallResult } from '../../../src/runtime/mcp/convert.ts';

test('a tool result reaches the agent as its text and images, never as structuredContent', () => {
  const page = toCallResult({ content: [{ type: 'text', text: 'Tab t1 · my own browser · https://kuwaittimes.com/ · "Kuwait Times"\n- heading "News" [ref=e1]' }], structured: { url: 'https://kuwaittimes.com/', tab: 't1' } });
  assert.deepEqual(page, { content: [{ type: 'text', text: 'Tab t1 · my own browser · https://kuwaittimes.com/ · "Kuwait Times"\n- heading "News" [ref=e1]' }], isError: false });
  assert.equal('structuredContent' in page, false);
  const shot = toCallResult({ content: [{ type: 'image', mime: 'image/jpeg', dataBase64: 'AAAA' }, { type: 'text', text: '' }], structured: { width: 1 } });
  assert.deepEqual(shot, { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }], isError: false }, 'empty text parts are dropped');
  assert.deepEqual(toCallResult({ content: [], isError: true, structured: { a: 1 } }), { content: [{ type: 'text', text: 'The tool failed.' }], isError: true });
  assert.deepEqual(errorResult(''), { content: [{ type: 'text', text: 'The tool failed.' }], isError: true });
});
