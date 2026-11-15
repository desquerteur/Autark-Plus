// B-080 (context/ledger/window.ts): the chat lines' reach (13.11.2026: the last CHAT_DAYS, at most CHAT_TOKENS – older ones hidden),
// and the fit of the window hides the oldest tool work –
// never a chat line, the newest turn, a pin or a nested call – and nothing at all when hiding could not bring the history in.
// B-080 wave 3: sizes are in tokensOf (3 characters per token, the engines' own unit).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHARS_PER_TOKEN, CHAT_DAYS, CHAT_REASON, CHAT_TOKENS, FIT_REASON, entryTokens, fitHides, oldChatLines, tokensOf } from '../../../src/runtime/context/ledger/window.ts';
import type { LedgerItem, LedgerViewItem } from '../../../src/shared/model/context-ledger.ts';

test('the chat lines\' reach: older than CHAT_DAYS before the newest, or past CHAT_TOKENS of newer lines, are hidden – never the newest or a pin', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const row = (itemId: string, order: number, createdAt: number, tokens: number, extra: Partial<LedgerItem> = {}) =>
    ({ itemId, kind: 'message', order, createdAt, tokens, state: 'keep', title: itemId, ...extra }) as LedgerItem;
  const now = 10 * DAY;
  const rows = [
    row('m1', 1, now - 5 * DAY, 100), row('m2', 2, now - 3 * DAY, 100, { pinnedUntil: 0 }), row('t3', 3, now - 3 * DAY, 100, { kind: 'tool' }),
    row('m4', 4, now - DAY, CHAT_TOKENS), row('m5', 5, now - DAY, 100), row('m6', 6, now, 100), row('m7', 7, now, 50, { state: 'hidden' }),
  ];
  const hidden = oldChatLines(rows, new Set(['m2']));
  assert.deepEqual(hidden.map((mark) => mark.itemId).sort(), ['m1'], 'm1 is past 2 days; m2 is pinned; a tool item and a hidden line are no lines to hide here');
  assert.equal(hidden[0].reason, CHAT_REASON);
  const full = oldChatLines([...rows, row('m8', 8, now, CHAT_TOKENS)], new Set());
  assert.deepEqual(full.map((mark) => mark.itemId).sort(), ['m1', 'm2', 'm4', 'm5', 'm6'], 'the newest line alone fills the budget: every older one goes, the newest stays');
  assert.deepEqual(oldChatLines([row('m1', 1, 0, CHAT_TOKENS * 2)], new Set()), [], 'the newest line stays however big');
  assert.equal(CHAT_DAYS, 2);
});

const entry = (itemId: string, kind: LedgerViewItem['kind'], chars: number, extra: Partial<LedgerViewItem> = {}): LedgerViewItem => ({
  itemId, kind, role: kind === 'message' ? 'user' : 'tool', text: 'x'.repeat(chars), origin: {}, order: Number(itemId.slice(1)), state: 'keep',
  ...(kind === 'tool' ? { call: { name: 'shell', args: {}, callId: itemId, output: 'x'.repeat(chars) } } : {}), ...extra,
});

test('the fit hides the oldest tool work first and only as much as needed; lines, the newest turn, pins and nested calls stay', () => {
  const entries = [
    entry('m1', 'message', 40_000), entry('t2', 'tool', 40_000, { runId: 'r1' }), entry('t3', 'tool', 40_000, { runId: 'r1', nested: true }),
    entry('t4', 'tool', 40_000, { runId: 'r1' }), entry('t5', 'tool', 40_000, { runId: 'r2' }), entry('m6', 'message', 40_000), entry('t7', 'tool', 40_000, { runId: 'r3' }),
  ];
  assert.equal(entryTokens(entries[1]), 13_334, 'a call counts its arguments and output (40,002 characters)');
  assert.equal(entryTokens(entries[2]), 0, 'a nested call costs nothing');
  assert.deepEqual(fitHides(entries, 15_000, { newestRun: 'r3', pinned: new Set() }), ['t2', 't4'], 'oldest first, the nested one skipped, then stop');
  assert.deepEqual(fitHides(entries, 15_000, { newestRun: 'r3', pinned: new Set(['t2']) }), ['t4', 't5'], 'a pin stays');
  assert.deepEqual(fitHides(entries, 45_000, { newestRun: 'r3', pinned: new Set() }), [], 't2, t4 and t5 free 40k: not enough – nothing is hidden for nothing');
  assert.deepEqual(fitHides(entries, 0, { pinned: new Set() }), []);
  assert.match(FIT_REASON, /fit the model window/);
});

test('B-080 wave 3: one token unit, the engines\' own – a 30,000-character output is 10,000 tokens', () => {
  assert.equal(CHARS_PER_TOKEN, 3, 'measured 3.3–3.6 characters per token in the engines\' counts of 08.–09.11.2026');
  assert.equal(tokensOf(30_000), 10_000);
  assert.equal(tokensOf(1), 1, 'rounded up');
  assert.equal(entryTokens(entry('a1', 'assistant', 30_000)), 10_000, 'a text');
  const output = entry('t2', 'tool', 0, { call: { name: 'shell', args: '', callId: 't2', output: 'x'.repeat(30_000) } });
  assert.equal(entryTokens(output), 10_000, 'a call\'s output');
});
