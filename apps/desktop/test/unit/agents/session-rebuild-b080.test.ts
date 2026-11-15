// B-080 – the native rebuild replays the part of the chat ledger the session holds (after the lines the agent's own summary covers)
// and fits it to the window: the oldest tool work is hidden, chat lines, the newest turn and pins stay; only a history whose chat
// lines alone do not fit falls back. Moved here from session-rebuild.test.ts (B-080 wave 3, both files below 450 lines).
// B-080 wave 3: every size is in the engines' own unit (context/ledger/window.ts tokensOf, 3 characters per token) – the fit, the
// shrink guard and the rebuilt binding's contextTokens (history plus prompt and tools); a rebuild that only timed out is tried again
// at the next turn, and a later turn never blocks an earlier rebuild after the fact (an interrupted run, a changed prompt).
// B-089 (11.11.2026): a marks rebuild on the same engine runs when it pays; the shrink-guard case rests past CACHE_COLD_MS, where any saving pays.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, view } from './rebuild-harness.ts';
import { CHARS_PER_TOKEN, tokensOf } from '../../../src/runtime/context/ledger/window.ts';
import { CACHE_COLD_MS } from '../../../src/runtime/agents/rebuild.ts';

type Fit = { hidden: number; before: number; after: number; room: number };
type Row = Parameters<typeof view>[0][number];

test('B-080 fit: a history past the window hides its oldest tool work – the chat lines and the newest turn stay – and the rebuild lands', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('claude');
  const seen = h.cursor();
  const big = (n: number) => `${n} `.padEnd(400_000, 'x'); // about 133k tokens (chars/3): two do not fit 80 % of the assumed 200k window
  h.ledgerState.view = view([
    [`m${seen}`, 'message', 'user', '[09:00] Alex: Hello'],
    ['t2', 'tool', 'tool', big(2), { name: 'shell', args: {}, callId: 'c2', output: big(2) }],
    ['t3', 'tool', 'tool', big(3), { name: 'shell', args: {}, callId: 'c3', output: big(3) }],
    ['a4', 'assistant', 'assistant', 'Done.'],
  ]).map((entry) => (entry.itemId === 't3' || entry.itemId === 'a4' ? { ...entry, runId: 'run_newest' } : entry));
  h.send('Next');
  await h.turn('codex');
  assert.deepEqual(h.ledgerState.marks, [{ itemId: 't2', state: 'hidden', by: 'window' }], 'only the oldest tool work, only as much as needed');
  assert.equal(h.codex.rebuilds.length, 1, 'no fallback to a fresh session: the rebuild lands');
  const items = h.codex.rebuilds[0].items;
  assert.deepEqual(items.map((item) => item.itemId), [`m${seen}`, 't3', 'marks2', 'a4'], 'the line, the newest turn and the call naming what is hidden (named from the first change on)');
  assert.match(items[2].call?.output ?? '', /hidden t2 – get any back with tools\.call/);
  const fit = h.notes('run_2').find((note) => note.fit)?.fit as Fit;
  assert.equal(fit.hidden, 1);
  assert.ok(fit.before > fit.room && fit.after <= fit.room, JSON.stringify(fit));
});

test('B-080 fit: when the chat lines alone do not fit, nothing is hidden for nothing – the rebuild falls back (too_large) and the turn goes on', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('claude');
  const seen = h.cursor();
  h.ledgerState.view = view([[`m${seen}`, 'message', 'user', `[09:00] Alex: ${'y'.repeat(800_000)}`], ['a2', 'assistant', 'assistant', 'Done.']]); // about 267k tokens
  h.send('Next');
  const outcome = await h.turn('codex');
  assert.equal(outcome.status, 'done');
  assert.equal(h.codex.rebuilds.length, 0);
  assert.deepEqual(h.ledgerState.marks, [], 'a chat line is never hidden by the fit');
  assert.deepEqual(h.notes('run_2').find((note) => note.rebuild), { rebuild: 'fallback', why: 'switch', reason: 'too_large' });
});

test('B-080: a changed prompt rebuilds the session with its history first – no summary that would cut it to the last lines; the note says so', async () => {
  const h = setup();
  h.send('Build the export');
  await h.turn('claude');
  const seen = h.cursor();
  h.ledgerState.view = view([[`m${seen}`, 'message', 'user', '[09:00] Alex: Build the export'], ['t2', 'tool', 'tool', 'export written', { name: 'shell', args: {}, callId: 'c2', output: 'export written' }], ['a3', 'assistant', 'assistant', 'Done.']]);
  h.store.save({ ...h.binding('claude')!, promptKey: 'an older prompt' });
  h.send('And now the import');
  await h.turn('claude');
  assert.equal(h.claude.rebuilds.length, 1);
  assert.deepEqual(h.claude.rebuilds[0].items.map((item) => item.itemId), [`m${seen}`, 't2', 'a3']);
  assert.equal(h.claude.calls[1].session?.ref, 'claude-r1', 'the turn runs on the rebuilt session');
  assert.deepEqual(h.notes('run_2').find((note) => note.fresh), { fresh: 'prompt', history: 'rebuilt' });
});

test('B-080: past the fit with nothing marked, the rebuild replays the part the session holds and the session goes on – no renewal', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('codex');
  const seen = h.cursor();
  const big = (n: number) => `${n} `.padEnd(160_000, 'x'); // about 53k tokens each by the estimate (chars/3)
  h.ledgerState.view = view([
    [`m${seen}`, 'message', 'user', '[09:00] Alex: Hello'],
    ['t2', 'tool', 'tool', big(2), { name: 'shell', args: {}, callId: 'c2', output: big(2) }],
    ['t3', 'tool', 'tool', big(3), { name: 'shell', args: {}, callId: 'c3', output: big(3) }],
    ['a4', 'assistant', 'assistant', 'Done.'],
  ]).map((entry) => (entry.itemId === 't3' || entry.itemId === 'a4' ? { ...entry, runId: 'run_newest' } : entry));
  h.ledgerState.need = undefined;
  h.store.save({ ...h.binding('codex')!, contextTokens: 190_000 }); // measured past 80 % of 200k – the old session held more than its part
  h.send('Next');
  await h.turn('codex');
  assert.deepEqual(h.ledgerState.marks, [], 'the part (~107k) fits: nothing to hide');
  assert.equal(h.codex.rebuilds.length, 1, 'the rebuild lands');
  assert.deepEqual(h.codex.rebuilds[0].items.map((item) => item.itemId), [`m${seen}`, 't2', 't3', 'a4']);
  assert.equal(h.codex.calls[1].session?.ref, 'codex-r1');
  assert.equal(h.notes('run_2').some((note) => note.sessionRenewed), false, 'no renewal: the work stays');
});

test('B-080 wave 3: past the fit by the engine\'s count (416,000 of 475,000), a part of 1,354,000 characters is fitted in that unit – the oldest tool work goes', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('codex');
  const seen = h.cursor();
  const work = (n: number) => `${n} `.padEnd(338_500, 'x'); // four: 1,354,000 characters – 338,500 tokens by chars/4, about 451,000 by the engines' count
  const tool = (n: number): Row => [`t${n}`, 'tool', 'tool', work(n), { name: 'shell', args: {}, callId: `c${n}`, output: work(n) }];
  h.ledgerState.view = view([
    [`m${seen}`, 'message', 'user', '[09:00] Alex: Hello'], tool(2), tool(3), tool(4), tool(5), ['a6', 'assistant', 'assistant', 'Done.'],
  ]).map((entry) => (entry.itemId === 't5' || entry.itemId === 'a6' ? { ...entry, runId: 'run_newest' } : entry));
  h.store.save({ ...h.binding('codex')!, contextTokens: 416_000, contextWindow: 475_000 }); // Lena 09.11.: what Codex reported, past 80 % (380,000)
  h.send('Next');
  await h.turn('codex');
  const fit = h.notes('run_2').find((note) => note.fit)?.fit as Fit | undefined;
  assert.ok(fit, 'the fit ran');
  assert.equal(CHARS_PER_TOKEN, 3);
  assert.ok(Math.ceil(1_354_000 / 4) < fit.room, `by chars/4 the part seemed to fit ${fit.room}: the same context went into a new, uncached thread`);
  assert.ok(fit.before >= tokensOf(1_354_000) && fit.before > fit.room && fit.after <= fit.room, JSON.stringify(fit));
  assert.deepEqual(h.ledgerState.marks, [{ itemId: 't2', state: 'hidden', by: 'window' }], 'the oldest tool work, as much as needed');
  assert.equal(h.codex.rebuilds.length, 1);
  assert.equal(h.codex.calls[1].session?.ref, 'codex-r1', 'the rebuilt session goes on – no renewal');
});

test('B-080 wave 3: a marks rebuild of 1,293,552 characters is not smaller than a live 338,000 – skipped, the session goes on', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('codex');
  h.ledgerState.view = view([['a1', 'assistant', 'assistant', 'x'.repeat(1_293_552)], ['t2', 'tool', 'tool', 'short {"compacted":"t2"}', { name: 'shell', args: { command: 'npm i' }, callId: 'c1', output: 'short' }]]);
  h.ledgerState.marked = [{ agentId: 'a', conversationId: 'c', itemId: 't2', kind: 'tool', order: 2, createdAt: 0, tokens: 9000, title: 'npm install log', state: 'condensed', origin: {} }];
  h.ledgerState.need = { since: 2, reason: '1 condensed', saves: 20_000 };
  h.store.save({ ...h.binding('codex')!, contextTokens: 338_000, contextWindow: 475_000 }); // Lena 09.11. 11:09: below the fit (380,000)
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1); // B-089: rested past the cache, so only the shrink guard decides
  h.send('Next');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 0, 'by chars/4 (323,388 + prompt) it passed, and the real context grew to 395,712');
  const skipped = h.notes('run_2').find((note) => note.rebuild)!;
  assert.deepEqual([skipped.rebuild, skipped.why, skipped.live], ['skipped', 'not smaller than the live context', 338_000]);
  assert.ok(Number(skipped.rebuilt) > tokensOf(1_293_552), String(skipped.rebuilt));
  assert.equal(h.codex.calls[1].session?.ref, 'codex-s1', 'the session goes on as it is');
});

test('B-080 wave 3: the rebuilt binding holds the whole context it starts with – the history plus the turn\'s prompt and tools', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('claude');
  h.ledgerState.view = view([['a1', 'assistant', 'assistant', 'x'.repeat(30_000)]]);
  let bound: number | undefined;
  h.codex.state.reply = () => { bound = h.binding('codex')?.contextTokens; return undefined; };
  h.send('Next');
  await h.turn('codex');
  const rebuild = h.codex.rebuilds[0];
  assert.equal(h.notes('run_2').find((note) => note.rebuild === 'native')?.tokens, 10_000, 'the history: 30,000 characters');
  const overhead = tokensOf(rebuild.system.stable.length + rebuild.system.volatile.length + JSON.stringify(rebuild.tools ?? []).length);
  assert.ok(overhead > 0);
  assert.equal(bound, 10_000 + overhead, 'until the engine reports its own count');
});

const TIMED_OUT = 'thread/inject_items refused chunk 1: codex did not answer thread/inject_items';

test('B-080 wave 3: a rebuild that only timed out is tried again at the next turn – no 6 h block', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('codex');
  h.ledgerState.view = view([['a1', 'assistant', 'assistant', 'Hi there.']]);
  let tries = 0;
  const rebuild = h.codex.engine.rebuild!.bind(h.codex.engine);
  h.codex.engine.rebuild = async (input) => {
    if (++tries === 1) throw new Error(TIMED_OUT); // a busy app-server (codex/rpc.ts -32000)
    return rebuild(input);
  };
  h.store.save({ ...h.binding('codex')!, promptKey: 'an older prompt' });
  h.send('Next');
  await h.turn('codex');
  assert.deepEqual(h.notes('run_2').find((note) => note.rebuild), { rebuild: 'fallback', why: 'no_session', reason: TIMED_OUT });
  h.store.save({ ...h.binding('codex')!, promptKey: 'another older prompt' });
  h.send('Again');
  await h.turn('codex');
  assert.equal(tries, 2, 'the next turn tried again');
  assert.equal(h.notes('run_3').find((note) => note.rebuild)?.rebuild, 'native');
  assert.equal(h.codex.calls.at(-1)?.session?.ref, 'codex-r1', 'the turn runs on the rebuilt session');
});

test('B-080 wave 3: an interrupted first run of a rebuilt session, then a turn under a changed prompt, blocks nothing', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('codex');
  h.ledgerState.view = view([['a1', 'assistant', 'assistant', 'Hi there.']]);
  // the agent's own model.set now:true, a Stop or a steer restart ends the rebuilt session's first run as interrupted
  h.codex.state.reply = (input) => (input.session?.ref === 'codex-r1' ? { text: '', stop: 'interrupted' } : undefined);
  h.store.save({ ...h.binding('codex')!, promptKey: 'an older prompt' });
  h.send('Next');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1);
  assert.equal(h.s.runs.get('run_2')?.status, 'interrupted');
  h.store.save({ ...h.binding('codex')!, promptKey: 'another older prompt' });
  h.send('Again');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 2, 'the next turn under a changed prompt rebuilds natively');
  assert.equal(h.notes('run_3').find((note) => note.rebuild)?.rebuild, 'native');
  assert.ok(![...h.notes('run_2'), ...h.notes('run_3')].some((note) => note.reason === 'first_turn_error'), 'no first_turn_error from a later turn');
});
