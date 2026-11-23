// B-080 – one head per part (splits/results.ts partHead), the same in the origin's "Split results" block, the full
// results, a dependant's notes and agents.split_results {steps}: every model the part's run ran on in order (its
// {failover} note – the steps before the switch and why; live 08.11.: Opus ran 103 steps, the CLI went silent, Luna
// finished and the head named Luna only) and its switches inside the turn ({modelSet:'in-turn'}), the model the part asked
// for when its run ran on another one no switch names (with the route's reason while no switch inside the turn followed),
// and – to its origin only – that a part started from text, not as me (the window reason also after a retry on the seeded
// run's session). A run without such notes keeps the one-model head. B-086: the origin's block and agents.split_results
// carry the part's "Asked: …" line under the head (asked-line.test.ts); a dependant's notes and {steps} do not.
// Owns: these checks. Never: an engine or the real dispatcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsText, workerNotes } from '../../../src/runtime/splits/results.ts';
import { PAST_WINDOW } from '../../../src/shared/model/splits.ts';
import type { ModelInfo } from '../../../src/shared/model/providers.ts';
import { CHAT, part, splitAndEnd, world, type World } from './fixture.ts';

const OPUS = 'claude:claude-opus-5-5';
const LUNA = 'codex:gpt-5.6-luna';
const SOL = 'codex:gpt-6.1-sol';
/** What pastFit measures: the context above FIT_SHARE of the window – it did not fit with room to work. */
const WINDOW_WHY = "my context did not fit its model's window with room to work";
const CHAIN = `### #1 Android – done · ${OPUS} · high, after 103 steps ${LUNA} · high (the engine stopped responding)`;

/** The fixture's world with Opus usable, so a part may name it. */
function opusWorld(): World {
  const w = world();
  const models = [{ id: 'codex:gpt-6.1-sol', model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', available: true }, { id: OPUS, model: 'claude-opus-5-5', name: 'Claude Opus 5.5', available: true }] as unknown as ModelInfo[];
  Object.assign(w.services, { catalog: { get: (id: string) => models.find((model) => model.id === id), list: () => models } });
  return w;
}

const note = (w: World, splitId: string, data: Record<string, unknown>) => w.runs.item(w.lanes.lanes.get(splitId)!.runId, { kind: 'note', data, effectStatus: 'none' });

test('a failover names both models in order, the steps before it and why – in all four places', () => {
  const w = opusWorld();
  const groupId = splitAndEnd(w, [part('Android', { model: OPUS, effort: 'high' }), part('Review', { after: [1] })]);
  const [android] = w.lanes.started;
  note(w, android, { stalled: { engine: 'claude', afterMs: 600_000 } });
  note(w, android, { failover: { from: OPUS, fromAccount: 'acc_claude', to: LUNA, toAccount: 'acc_codex', reason: 'unavailable', afterTools: 103 } });
  const runId = w.lanes.end(android, 'done', { answer: 'Published 0.3.6.' });
  w.runs.finish(runId, { status: 'done', model: LUNA, effort: 'high', route: { reason: 'failover', by: 'rules', category: 'coding' } }); // what turn-finish writes
  w.lanes.end(w.lanes.started[1], 'done', { answer: 'Looks right.' });
  const group = w.splits.list({ groupId })[0];
  assert.match(w.splits.pendingResults('ag_ava', CHAT)!.text, new RegExp(`${esc(CHAIN)}\\nAsked: Do android\\.\\nPublished 0\\.3\\.6\\.`), 'Split results');
  assert.match(w.splits.results('ag_ava', { groupId, idx: 1 }), new RegExp(`${esc(CHAIN)}\\nAsked: Do android\\.\\nPublished 0\\.3\\.6\\.$`), 'agents.split_results');
  const notes = workerNotes(w.runs, group, group.splits[1], group.splits);
  assert.match(notes[1].text, new RegExp(`${esc(CHAIN)}\\nPublished 0\\.3\\.6\\.`), "the dependant's notes");
  assert.match(stepsText(w.runs, group, 5, 1), new RegExp(`^${esc(CHAIN)}\\n`), 'agents.split_results {steps}');
  assert.doesNotMatch(w.splits.pendingResults('ag_ava', CHAT)!.text, /asked/, 'the chain already names the asked model');
});

test('the reason: without a stall the engine was unavailable; a usage limit; no failover note keeps the one-model head', () => {
  const w = opusWorld();
  splitAndEnd(w, [part('A', { model: OPUS }), part('B'), part('C')]);
  const [a, b, c] = w.lanes.started;
  note(w, a, { failover: { from: OPUS, to: 'codex:gpt-6.1-sol', reason: 'unavailable' } });
  note(w, b, { failover: { from: 'codex:gpt-6.1-sol', to: 'codex:gpt-6.1-sol', reason: 'limit', afterTools: 1 } });
  w.lanes.end(a, 'done', { answer: 'a' });
  w.lanes.end(b, 'done', { answer: 'b' });
  w.lanes.end(c, 'done', { answer: 'c' });
  const text = w.splits.pendingResults('ag_ava', CHAT)!.text;
  assert.match(text, new RegExp(`### #1 A – done · ${esc(OPUS)} · low, then codex:gpt-6\\.1-sol · low \\(the engine was unavailable\\)\\nAsked: Do a\\.\\na\\n`));
  assert.match(text, /### #2 B – done · codex:gpt-6\.1-sol · low, after 1 step on another account \(usage limit\)\nAsked: Do b\.\nb\n/, 'the same model: another account');
  assert.match(text, /### #3 C – done · codex:gpt-6\.1-sol · low\nAsked: Do c\.\nc$/);
});

test('a part that ran on another model than it asked for names the ask and the route reason', () => {
  const w = opusWorld();
  splitAndEnd(w, [part('Code', { model: OPUS, effort: 'high' }), part('Same', { model: 'codex:gpt-6.1-sol' })]);
  const [code, same] = w.lanes.started;
  const runId = w.lanes.end(code, 'done', { answer: 'Done.' });
  w.runs.finish(runId, { status: 'done', model: LUNA, effort: 'high', route: { reason: 'pinned model unavailable · chat · best value', by: 'rules', category: 'chat' } });
  w.lanes.end(same, 'done', { answer: 'Same.' });
  const text = w.splits.pendingResults('ag_ava', CHAT)!.text;
  assert.match(text, new RegExp(`### #1 Code – done · ${esc(LUNA)} · high – asked ${esc(OPUS)}: pinned model unavailable · chat · best value\\nAsked: Do code\\.\\nDone\\.`));
  assert.match(text, /### #2 Same – done · codex:gpt-6\.1-sol · low\nAsked: Do same\.\nSame\./, 'it ran on what it asked for');
});

test('a part that started from text says so (and why, when its context did not fit); native and brief heads stay', () => {
  const w = world();
  const groupId = splitAndEnd(w, [part('Luna'), part('Moved'), part('Forked'), part('Fresh', { context: 'brief' })]);
  const [luna, moved, forked, fresh] = w.lanes.started;
  note(w, luna, { splitSeed: 'text', fellBack: ["native: the parent session exceeds the worker model's limit"] });
  note(w, moved, { splitSeed: 'text', fellBack: ["native: the parent's turn ran on another engine"] });
  w.splits.markFork(luna, { how: 'text' });
  w.splits.markFork(moved, { how: 'text' });
  w.splits.markFork(forked, { how: 'native', engine: 'codex', accountId: 'acc_1', parentRef: 'thr_parent' });
  w.splits.markFork(fresh, { how: 'fresh' });
  for (const [splitId, answer] of [[luna, 'l'], [moved, 'm'], [forked, 'f'], [fresh, 'b']]) w.lanes.end(splitId, 'done', { answer });
  const window = `### #1 Luna – done · codex:gpt-6.1-sol · low · it started from my brief and a short text of my state, not as me: ${WINDOW_WHY}.\nAsked: Do luna.\nl`;
  const block = w.splits.pendingResults('ag_ava', CHAT)!.text;
  assert.ok(block.includes(window), block);
  assert.ok(block.includes('### #2 Moved – done · codex:gpt-6.1-sol · low · it started from my brief and a short text of my state, not as me.\nAsked: Do moved.\nm'));
  assert.ok(block.includes('### #3 Forked – done · codex:gpt-6.1-sol · low\nAsked: Do forked.\nf'));
  assert.ok(block.includes('### #4 Fresh – done · codex:gpt-6.1-sol · low\nAsked: Do fresh.\nb'));
  assert.ok(w.splits.results('ag_ava', { groupId, idx: 1 }).endsWith(window), 'agents.split_results');
});

test('a switch inside the turn is a leg too: to the asked model no "asked"; after one the start route\'s reason stays out', () => {
  const w = opusWorld();
  splitAndEnd(w, [part('Moved', { model: OPUS, effort: 'high' }), part('Own', { model: OPUS, effort: 'high' })]);
  const [moved, own] = w.lanes.started;
  assert.ok(w.splits.tune(moved, { model: SOL }), 'agents.split_tell {to: 1, model} on a working part stores the new model');
  note(w, moved, { modelSet: 'in-turn', from: OPUS, model: SOL, effort: 'medium' });
  note(w, own, { modelSet: 'in-turn', model: SOL, effort: 'medium' }); // model.set now, a note that names no start
  for (const [splitId, answer] of [[moved, 'm'], [own, 'o']]) {
    const runId = w.lanes.end(splitId, 'done', { answer });
    w.runs.finish(runId, { status: 'done', model: SOL, effort: 'medium', route: { reason: 'pinned · coding', by: 'rules', category: 'coding' } }); // the 'model' event moved the turn's route
  }
  const text = w.splits.pendingResults('ag_ava', CHAT)!.text;
  assert.ok(text.includes(`### #1 Moved – done · ${OPUS}, then ${SOL} · medium (switched inside its turn)\nAsked: Do moved.\nm`), text);
  assert.ok(text.includes(`### #2 Own – done · then ${SOL} · medium (switched inside its turn) – asked ${OPUS}\nAsked: Do own.\no`), text);
  assert.doesNotMatch(text, /pinned · coding/, "the start route's reason explains no model it ended on");
});

test("the window reason stays after a retry on the seeded run's session; a dependant's notes carry no start from text", () => {
  const w = world();
  const groupId = splitAndEnd(w, [part('Luna'), part('Check', { after: [1] })]);
  const [luna] = w.lanes.started;
  note(w, luna, { splitSeed: 'text', fellBack: [`native: ${PAST_WINDOW}`] });
  w.splits.markFork(luna, { how: 'text' });
  w.lanes.end(luna, 'failed', { retryable: true, error: 'The provider is busy.' });
  w.lanes.end(luna, 'done', { answer: 'l' }); // the retry resumed the first run's session: no seed note of its own
  const head = `### #1 Luna – done · ${SOL} · low · it started from my brief and a short text of my state, not as me: ${WINDOW_WHY}.`;
  assert.ok(w.splits.results('ag_ava', { groupId, idx: 1 }).endsWith(`${head}\nAsked: Do luna.\nl`), 'agents.split_results');
  const group = w.splits.list({ groupId })[0];
  assert.ok(stepsText(w.runs, group, 5, 1).startsWith(`${head}\n`), 'agents.split_results {steps}');
  const notes = workerNotes(w.runs, group, group.splits[1], group.splits);
  assert.ok(notes[1].text.includes(`### #1 Luna – done · ${SOL} · low\nl`), notes[1].text);
});

function esc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
