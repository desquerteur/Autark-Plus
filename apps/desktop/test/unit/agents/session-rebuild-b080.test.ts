// B-080 – the native rebuild replays the agent's record and fits it to the window: the oldest tool work is hidden, chat lines,
// the newest turn and pins stay; only a history whose chat lines alone do not fit falls back.
// KI-Runde 17.11.2026: every size is in the ledger's unit (context/ledger/window.ts tokensOf, 2 characters per token) and read in
// the engine's own where it meets the window or the engine's count (shared/model/context-ledger.ts engineUnit: Codex 3.4
// characters per token) – the fit and the rebuilt binding's contextTokens (history plus prompt and tools); the measured case of
// that round (a record estimated at 787,902 that passed as fitting a 1M window) now gets its oldest work hidden. A rebuild that
// only timed out is tried again at the next turn, and a later turn never blocks an earlier rebuild after the fact. A session
// starts anew only where it does anyway – these cases let it rest past CACHE_COLD_MS or switch the engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, view } from './rebuild-harness.ts';
import { CHARS_PER_TOKEN, tokensOf } from '../../../src/runtime/context/ledger/window.ts';
import { CACHE_COLD_MS, fitLimit } from '../../../src/runtime/agents/compaction-policy.ts';

type Fit = { hidden: number; before: number; after: number; room: number };
type Row = Parameters<typeof view>[0][number];
/** Marks waiting in the ledger, so a cold session has something to land. */
const WAITING = { since: 1, reason: '1 condensed', saves: 10 };

test('B-080 fit: a history past the window hides its oldest tool work – the chat lines and the newest turn stay – and the rebuild lands', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('claude');
  const seen = h.cursor();
  const big = (n: number) => `${n} `.padEnd(340_000, 'x'); // 100k of Codex's tokens each (3.4 characters per token): two do not fit 80 % of the assumed 200k window
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
  h.ledgerState.view = view([[`m${seen}`, 'message', 'user', `[09:00] Alex: ${'y'.repeat(800_000)}`], ['a2', 'assistant', 'assistant', 'Done.']]); // 400k tokens
  h.send('Next');
  const outcome = await h.turn('codex');
  assert.equal(outcome.status, 'done');
  assert.equal(h.codex.rebuilds.length, 0);
  assert.deepEqual(h.ledgerState.marks, [], 'a chat line is never hidden by the fit');
  assert.deepEqual(h.notes('run_2').find((note) => note.rebuild), { rebuild: 'fallback', why: 'switch', reason: 'too_large' });
});

test('past the fit with a record that fits, the session starts anew with all of it – what the old session held beyond its record is not replayed, and nothing is renewed', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('codex');
  const seen = h.cursor();
  const big = (n: number) => `${n} `.padEnd(100_000, 'x'); // 50k tokens each
  h.ledgerState.view = view([
    [`m${seen}`, 'message', 'user', '[09:00] Alex: Hello'],
    ['t2', 'tool', 'tool', big(2), { name: 'shell', args: {}, callId: 'c2', output: big(2) }],
    ['t3', 'tool', 'tool', big(3), { name: 'shell', args: {}, callId: 'c3', output: big(3) }],
    ['a4', 'assistant', 'assistant', 'Done.'],
  ]).map((entry) => (entry.itemId === 't3' || entry.itemId === 'a4' ? { ...entry, runId: 'run_newest' } : entry));
  h.ledgerState.need = undefined;
  h.store.save({ ...h.binding('codex')!, contextTokens: 190_000 }); // measured past 80 % of 200k – far more than the record of about 100k: not the unit
  h.send('Next');
  await h.turn('codex');
  assert.deepEqual(h.ledgerState.marks, [], 'the record (~100k) fits even in the room shrunk by the most the unit can be off: nothing to hide');
  assert.equal(h.codex.rebuilds.length, 1, 'the rebuild lands');
  assert.deepEqual(h.codex.rebuilds[0].items.map((item) => item.itemId), [`m${seen}`, 't2', 't3', 'a4']);
  assert.equal(h.codex.calls[1].session?.ref, 'codex-r1');
  assert.equal(h.notes('run_2').find((note) => note.rebuild)?.why, 'fit');
  assert.equal(h.notes('run_2').some((note) => note.sessionRenewed), false, 'no renewal: the work stays');
});

test('the measured case of 17.11.2026 through the rebuild: a record the unit of before counted as 787,902 no longer passes as fitting a 1M window – its oldest tool work is hidden', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('claude');
  h.store.save({ ...h.binding('claude')!, contextWindow: 1_000_000 }); // what Claude Code reports for the 5.5 models
  const chars = 787_902 * 3;
  assert.equal(CHARS_PER_TOKEN, 2);
  assert.ok(Math.ceil(chars / 3) < fitLimit(1_000_000), 'at 3 characters per token the record passed the fit of 800,000 and came back as 1.2M real tokens');
  const work = (n: number) => `${n} `.padEnd(chars / 12 - 2, 'x');
  const tool = (n: number): Row => [`t${n}`, 'tool', 'tool', work(n), { name: 'shell', args: {}, callId: `c${n}`, output: work(n) }];
  h.ledgerState.view = view([...Array.from({ length: 12 }, (_unused, index) => tool(index + 1)), ['a13', 'assistant', 'assistant', 'Done.']])
    .map((entry) => (entry.itemId === 't12' || entry.itemId === 'a13' ? { ...entry, runId: 'run_newest' } : entry));
  h.ledgerState.need = WAITING;
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1);
  h.send('Next');
  await h.turn('claude');
  const fit = h.notes('run_2').find((note) => note.fit)?.fit as Fit | undefined;
  assert.ok(fit, 'the fit ran');
  assert.ok(fit.before >= tokensOf(chars) && fit.before > fit.room && fit.after <= fit.room, JSON.stringify(fit));
  assert.ok(fit.room <= fitLimit(1_000_000), 'the room is 80 % of the real window less the prompt and tools');
  assert.ok(fit.hidden >= 4, `${fit.hidden}: at least four of the twelve pieces (98,488 tokens each) go to take 381,856 and the prompt off`);
  assert.deepEqual(h.ledgerState.marks.slice(0, 4), ['t1', 't2', 't3', 't4'].map((itemId) => ({ itemId, state: 'hidden', by: 'window' })), 'the oldest first');
  assert.equal(h.claude.rebuilds.length, 1);
  assert.equal(h.claude.calls[1].session?.ref, 'claude-r1', 'the rebuilt session goes on – no renewal');
});

test('the rebuilt binding holds the whole context it starts with – the history plus the turn\'s prompt and tools', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('claude');
  h.ledgerState.view = view([['a1', 'assistant', 'assistant', 'x'.repeat(30_000)]]);
  let bound: number | undefined;
  h.codex.state.reply = () => { bound = h.binding('codex')?.contextTokens; return undefined; };
  h.send('Next');
  await h.turn('codex');
  const rebuild = h.codex.rebuilds[0];
  assert.equal(h.notes('run_2').find((note) => note.rebuild === 'native')?.tokens, 15_000, 'the history: 30,000 characters');
  const overhead = tokensOf(rebuild.system.stable.length + rebuild.system.volatile.length + JSON.stringify(rebuild.tools ?? []).length);
  assert.ok(overhead > 0);
  assert.equal(bound, Math.round((15_000 + overhead) / 1.7), 'in Codex\'s own tokens (3.4 characters each, the ledger counts 2) until the engine reports its own count');
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
  h.ledgerState.need = WAITING;
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1);
  h.send('Next');
  await h.turn('codex');
  assert.deepEqual(h.notes('run_2').find((note) => note.rebuild), { rebuild: 'fallback', why: 'cold', reason: TIMED_OUT });
  assert.equal(h.codex.calls[1].session?.ref, 'codex-s1', 'the session goes on as it is meanwhile');
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1);
  h.send('Again');
  await h.turn('codex');
  assert.equal(tries, 2, 'the next turn tried again');
  assert.equal(h.notes('run_3').find((note) => note.rebuild)?.rebuild, 'native');
  assert.equal(h.codex.calls.at(-1)?.session?.ref, 'codex-r1', 'the turn runs on the rebuilt session');
});

test('B-080 wave 3: an interrupted first run of a rebuilt session blocks nothing – the next turn that starts anew rebuilds natively', async () => {
  const h = setup();
  h.send('Hello');
  await h.turn('codex');
  h.ledgerState.view = view([['a1', 'assistant', 'assistant', 'Hi there.']]);
  // the agent's own model.set now:true, a Stop or a steer restart ends the rebuilt session's first run as interrupted
  h.codex.state.reply = (input) => (input.session?.ref === 'codex-r1' ? { text: '', stop: 'interrupted' } : undefined);
  h.ledgerState.need = WAITING;
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1);
  h.send('Next');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1);
  assert.equal(h.s.runs.get('run_2')?.status, 'interrupted');
  h.ledgerState.need = WAITING;
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1);
  h.send('Again');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 2, 'the next turn past the cache rebuilds natively');
  assert.equal(h.notes('run_3').find((note) => note.rebuild)?.rebuild, 'native');
  assert.ok(![...h.notes('run_2'), ...h.notes('run_3')].some((note) => note.reason === 'first_turn_error'), 'no first_turn_error from a later turn');
});
