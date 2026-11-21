// Owner 13.11.2026 ("die letzte Nachricht wird automatisch der Main-Sitzung zurückgegeben", "dass es wirklich wieder
// verschmelzen kann"): each part returns to its origin on its own as soon as it ends – a wake while its sibling still
// works, a "Split results" block with only what has not reached the origin yet, gathered per part – and carries what it
// did on the way: its context ledger as its marks left it (splits/digest.ts – condensed text, else the title,
// hidden steps out, only its own runs).
// Owns: these checks. Never: an engine or the real dispatcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerItem } from '../../../src/shared/model/context-ledger.ts';
import { splitThread } from '../../../src/shared/model/splits.ts';
import { DID_LEAD } from '../../../src/runtime/splits/results.ts';
import { CHAT, part, splitAndEnd, world } from './fixture.ts';

test('a part comes back on its own while its sibling works; the group closes once both reached the origin', () => {
  const w = world();
  const groupId = splitAndEnd(w, [part('Answer the CEO'), part('Long job')]);
  const [quick, long] = w.lanes.started;
  w.lanes.end(quick, 'done', { answer: 'The CEO has the numbers.' });
  const wakes = w.wakes.list('ag_ava');
  assert.equal(wakes.length, 1, 'the origin wakes at once');
  assert.match(wakes[0].note ?? '', /^My part #1 "Answer the CEO" .* ended \(done\)\./);

  const first = w.splits.pendingResults('ag_ava', CHAT)!;
  assert.equal(first.splitIds.length, 1);
  assert.match(first.text, /## .* – 2 parts: 1 done, 1 running/);
  assert.match(first.text, /### #1 Answer the CEO – done[^\n]*\nAsked: [^\n]*\nThe CEO has the numbers\./);
  assert.doesNotMatch(first.text, /### #2/, 'the working part is not in the block');

  w.splits.markGathered('run_next', first.splitIds);
  assert.equal(w.splits.list({ groupId })[0].status, 'running', 'its sibling still works');
  assert.equal(w.wakes.list('ag_ava').length, 0, 'nothing else waits: the wake is withdrawn');
  assert.equal(w.splits.pendingResults('ag_ava', CHAT), undefined);

  w.lanes.end(long, 'done', { answer: 'Long job finished.' });
  assert.equal(w.wakes.list('ag_ava').length, 1, 'the second part wakes the origin too (one wake for its return and the group end)');
  const second = w.splits.pendingResults('ag_ava', CHAT)!;
  assert.match(second.text, /### #2 Long job – done/);
  assert.doesNotMatch(second.text, /### #1/, 'what reached the origin stays out');
  w.splits.markGathered('run_after', second.splitIds);
  const group = w.splits.list({ groupId })[0];
  assert.equal(group.status, 'gathered');
  assert.equal(w.wakes.list('ag_ava').length, 0);
});

test('what a part did comes with its last words: condensed steps as condensed, kept ones by title, hidden and foreign ones out', () => {
  const w = world();
  splitAndEnd(w, [part('Research')]);
  const runId = w.lanes.end(w.lanes.started[0], 'done', { answer: 'Found three suppliers.' });
  const splitId = w.splits.list({ agentId: 'ag_ava' })[0].splits[0].id;
  const item = (n: number, patch: Partial<LedgerItem>): LedgerItem => ({
    agentId: 'ag_ava', conversationId: splitThread(splitId), itemId: `i${n}`, kind: 'tool', runId, order: n, createdAt: n,
    tokens: 10, title: `step ${n}`, state: 'keep', origin: {} as LedgerItem['origin'], ...patch,
  });
  const seen: string[] = [];
  (w.services as unknown as { ledger: unknown }).ledger = {
    items: (agentId: string, thread: string) => {
      seen.push(`${agentId}|${thread}`);
      return [
        item(1, { runId: 'run_parent_before_split', title: 'my origin\'s step' }),
        item(2, { title: 'web.search suppliers' }),
        item(3, { state: 'condensed', condensed: 'Compared 7 suppliers; 3 deliver within a week.' }),
        item(4, { state: 'hidden', title: 'a dead end' }),
      ];
    },
  };
  const block = w.splits.pendingResults('ag_ava', CHAT)!.text;
  assert.deepEqual(seen, [`ag_ava|${splitThread(splitId)}`], 'its own thread');
  assert.ok(block.includes(`Found three suppliers.\n${DID_LEAD}\n- web.search suppliers\n- Compared 7 suppliers; 3 deliver within a week.`), block);
  assert.doesNotMatch(block, /a dead end|my origin's step/);
});
