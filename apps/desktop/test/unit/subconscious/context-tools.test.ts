// The subconscious's hold on the main AI's transcript (subconscious/context-tools.ts): context.list pages older items, never the newest
// turn (B-080; the newest 2 until then); condense and hide refuse what is protected; a condensation may not name a value the original lacks and carries the stamp in
// the view; a hidden item leaves the view; restore shows the originals as a real call and pins them; a session-less history follows
// the marks (context/ledger/marks.ts). B-080 wave 3: sizes and savings are in window.ts tokensOf (3 characters per token);
// a condensed item given a longer text says what it costs more (not that it was hidden).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextTools, condensedProblem, inventedValues } from '../../../src/runtime/subconscious/context-tools.ts';
import { FLOW_TOOLS, toolList, type FlowRun } from '../../../src/runtime/subconscious/tools.ts';
import type { TraceCall } from '../../../src/shared/model/subconscious.ts';
import { marksCall, marksOf } from '../../../src/runtime/context/ledger/marks.ts';
import { mid, ledgerSetup } from '../context/ledger-fixture.ts';
import { rebuildItems } from '../../../src/runtime/agents/rebuild-items.ts';
import { tokensOf } from '../../../src/runtime/context/ledger/window.ts';

const tool = (name: string) => contextTools.find((entry) => entry.name === name)!;

function runOf(t: ReturnType<typeof ledgerSetup>): { run: FlowRun; shown: TraceCall[] } {
  const shown: TraceCall[] = [];
  const run = {
    services: t.services, agent: t.tom, conversationId: t.chat.id, thread: 'main', signal: new AbortController().signal,
    hits: new Map(), searches: [], show: (call: TraceCall) => { shown.push(call); }, finish: () => {},
  } as unknown as FlowRun;
  return { run, shown };
}

/** Four finished turns, each with one long tool output: t1, t2 and t3 are older than the newest turn. */
function fourTurns(t: ReturnType<typeof ledgerSetup>): void {
  for (let index = 1; index <= 4; index++) {
    const run = t.turn(t.say(`Step ${index} please, with some words.`).seq);
    t.ourCall(run, 'shell.exec', { command: `build ${index}` }, `build ${index} finished in 40${index} seconds\n${'log line\n'.repeat(400)}`, `c${index}`);
    t.done(run);
    t.clock.advance(1000);
  }
}

test('context.list shows only items older than the newest turn, bounded and paged; no chat, no list', async () => {
  const t = ledgerSetup();
  try {
    fourTurns(t);
    const { run } = runOf(t);
    const page = String(await tool('context.list').run({}, run));
    assert.match(page, /^\d+ older items in full, about \d+ tokens\./);
    assert.match(page, /\nt1 tool \d+t shell\.exec/);
    assert.match(page, /\nt2 tool /);
    assert.match(page, /\nt3 tool /, 'B-080: the turn before the newest is offered too');
    assert.doesNotMatch(page, /\nt4 tool /, 'the newest turn is not offered');
    assert.doesNotMatch(page, /log line/, 'titles only, never originals');
    const big = String(await tool('context.list').run({ minTokens: 500 }, run));
    assert.doesNotMatch(big, /\nm\d+ /, 'minTokens leaves the short lines out');
    assert.match(String(await tool('context.list').run({}, { ...run, thread: '' } as FlowRun)), /no chat/);
    assert.ok(page.length <= 4000, 'fits one step of the flow');
  } finally { t.cleanup(); }
});

test('context.list: a page fits one step\'s output, and the pointer to the next page follows its last line', async () => {
  const t = ledgerSetup();
  try {
    for (let index = 1; index <= 30; index++) {
      const run = t.turn(t.say(`Bitte lies im Arbeitsbereich die Akte akten/${String(index).padStart(2, '0')}-kunde-mit-langem-namen.md komplett.`).seq);
      t.ourCall(run, 'shell.exec', { command: `Get-Content -LiteralPath C:\\work\\akten\\${index}-kunde-mit-langem-namen.md -Encoding UTF8` }, `Zeile ${index}\n${'x'.repeat(3000)}`, `c${index}`);
      t.done(run);
      t.clock.advance(1000);
    }
    const { run } = runOf(t);
    const first = String(await tool('context.list').run({}, run));
    assert.ok(first.length <= 4000, `the page keeps within a step's output: ${first.length}`);
    const last = first.split('\n').at(-1)!.split(' ')[0];
    assert.match(first, new RegExp(`^\\d+ older items in full, about \\d+ tokens\\. Next page: after ${last}\\.`));
    const second = String(await tool('context.list').run({ after: last }, run));
    const next = second.split('\n')[1].split(' ')[0];
    const ids = t.ledger.items(t.tom.id, 'main').sort((a, b) => a.order - b.order).map((item) => item.itemId);
    assert.equal(ids.indexOf(next), ids.indexOf(last) + 1, 'nothing between the pages is lost');
  } finally { t.cleanup(); }
});

test('context.condense: the newest turn cannot be touched, a pinned item can – the main AI asked; invented values are refused; the view shows the stamp', async () => {
  const t = ledgerSetup();
  try {
    fourTurns(t);
    const { run } = runOf(t);
    assert.match(String(await tool('context.condense').run({ id: 't4', text: 'done' }, run)), /stays as it is: in the newest turn/);
    assert.match(String(await tool('context.condense').run({ id: 't1', text: 'took 999 seconds' }, run)), /values the original lacks: 999/);
    assert.match(String(await tool('context.condense').run({ id: 't1', text: '' }, run)), /empty/);
    const tokens = t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === 't1')!.tokens;
    // B-080 wave 3: captured and counted in the engines' unit (window.ts tokensOf) – the call's arguments plus its output
    assert.equal(tokens, tokensOf(JSON.stringify({ command: 'build 1' }).length) + tokensOf(`build 1 finished in 401 seconds\n${'log line\n'.repeat(400)}`.length));
    const said = 'build 1 finished in 401 seconds';
    assert.match(String(await tool('context.condense').run({ id: 't1', text: said }, run)), new RegExp(`^condensed t1: about ${tokens - tokensOf(said.length)} tokens saved`));
    const view = t.ledger.view(t.tom.id, 'main').find((entry) => entry.itemId === 't1')!;
    assert.equal(view.call?.output, `build 1 finished in 401 seconds\n{"compacted":"t1","was":"${tokens} tokens","restore":"context.restore"}`);
    assert.equal(t.ledger.original(t.tom.id, 'main', 't1')?.pruned, false, 'the original stays');
    t.ledger.mark(t.tom.id, 'main', [{ itemId: 't2', state: 'keep', reason: 'restored', by: 'restore' }]);
    // v1: every run is the main AI's own call – its own pin does not stop what it asked for (q-r3, q-r2d s15)
    assert.match(String(await tool('context.list').run({}, run)), /\nt2 tool \d+t \(the main AI brought it back\) shell\.exec/);
    assert.match(String(await tool('context.condense').run({ id: 't2', text: 'build 2 finished in 402 seconds' }, run)), /^condensed t2/);
    assert.equal(t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === 't2')!.state, 'condensed', 'the ledger takes the mark on its word');
  } finally { t.cleanup(); }
});

test('a hidden item leaves the view; restore shows the originals as a real call and pins them', async () => {
  const t = ledgerSetup();
  try {
    fourTurns(t);
    const { run, shown } = runOf(t);
    assert.match(String(await tool('context.hide').run({ ids: ['t1', 'nope'] }, run)), /^hidden: t1; left as they are: nope \(no such item\)/);
    assert.equal(t.ledger.view(t.tom.id, 'main').some((entry) => entry.itemId === 't1'), false);
    const need = t.ledger.needsRebuild(t.tom.id, 'main');
    assert.ok((need?.saves ?? 0) > 500, 'the mark counts for the savings rule');
    assert.equal(rebuildItems(t.ledger.view(t.tom.id, 'main')).items.some((item) => item.itemId === 't1'), false, 'a rebuild leaves it out');
    assert.match(String(await tool('context.read').run({ id: 't1' }, run)), /build 1 finished in 401 seconds/, 'read still shows the original');
    const back = String(await tool('context.restore').run({ ids: ['t1'] }, run));
    assert.match(back, /^Restored t1 – kept in my context for the next 3 turns\./);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].tool, 'context.restore');
    assert.deepEqual(shown[0].args, { ids: ['t1'] });
    assert.match(shown[0].output, /build 1 finished in 401 seconds/);
    const item = t.ledger.items(t.tom.id, 'main').find((entry) => entry.itemId === 't1')!;
    assert.equal(item.state, 'keep');
    assert.notEqual(item.pinnedUntil, undefined);
  } finally { t.cleanup(); }
});

test('q-r2a: a hidden item condensed again comes back – the tool says what it costs, and the run counts it so', async () => {
  const t = ledgerSetup();
  try {
    fourTurns(t);
    const { run } = runOf(t);
    const tally = { used: 0, saved: 0 };
    const counted = { ...run, tally } as FlowRun;
    await tool('context.hide').run({ ids: ['t1'] }, counted);
    const hiddenSaved = tally.saved;
    assert.ok(hiddenSaved > 500, String(hiddenSaved));
    assert.match(String(await tool('context.list').run({}, counted)), /\nt1 tool hidden \(was \d+t\) shell\.exec/);
    const out = String(await tool('context.condense').run({ id: 't1', text: 'build 1 finished in 401 seconds' }, counted));
    assert.match(out, new RegExp(`^condensed t1: it was hidden, so it comes back with about ${tokensOf(31)} tokens at the main AI's next turn`), 'B-080 wave 3: 31 characters');
    assert.ok(tally.saved < hiddenSaved, 'what came back is taken off what the run saved');
  } finally { t.cleanup(); }
});

test('B-080 wave 3: a condensed item condensed again with a longer text says what it costs more – it was never hidden', async () => {
  const t = ledgerSetup();
  try {
    fourTurns(t);
    const { run } = runOf(t);
    const short = 'build 1 finished in 401 seconds';
    assert.match(String(await tool('context.condense').run({ id: 't1', text: short }, run)), /^condensed t1: about \d+ tokens saved/);
    const longer = `${short}; the command was build 1 and it printed one log line after another`;
    const out = String(await tool('context.condense').run({ id: 't1', text: longer }, run));
    assert.equal(out.split('\n')[0], `condensed t1: the new text is longer, so it costs about ${tokensOf(longer.length) - tokensOf(short.length)} tokens more at the main AI's next turn`);
    assert.doesNotMatch(out, /hidden/);
  } finally { t.cleanup(); }
});

test('a condensed message of the person is labelled as keywords, not their words', async () => {
  const t = ledgerSetup();
  try {
    const asked = t.say('Please remember that the launch moves to Friday because the supplier needs another week for the parts. '.repeat(2));
    const first = t.turn(asked.seq);
    t.done(first);
    for (let index = 0; index < 3; index++) { t.clock.advance(1000); t.done(t.turn(t.say(`Go on ${index}, please do.`).seq)); }
    const { run } = runOf(t);
    const id = mid(t.db, asked);
    assert.match(String(await tool('context.condense').run({ id, text: 'launch moves to Friday, supplier' }, run)), /^condensed/);
    const view = t.ledger.view(t.tom.id, 'main').find((entry) => entry.itemId === id)!;
    assert.match(view.text, /^Keywords \(not the person's words\): launch moves to Friday, supplier\n\{"compacted":"m/);
    // B-080 wave 3: the cost is counted on the stored text, its prefix included – a slightly longer text costs more
    const prefix = "Keywords (not the person's words): ";
    const longer = 'launch moves to Friday, supplier, parts';
    const again = String(await tool('context.condense').run({ id, text: longer }, run)).split('\n')[0];
    const more = tokensOf(prefix.length + longer.length) - tokensOf(prefix.length + 'launch moves to Friday, supplier'.length);
    assert.equal(again, `condensed ${id}: the new text is longer, so it costs about ${more} tokens more at the main AI's next turn`);
  } finally { t.cleanup(); }
});

test('session-less history: earlier lines follow the marks, one call names them; condensed values are checked', () => {
  const t = ledgerSetup();
  try {
    const a = t.say('Keep this line.');
    const b = t.say('Condense this line of many words.');
    const c = t.say('Hide this line.');
    t.done(t.turn(c.seq));
    t.ledger.mark(t.tom.id, 'main', [
      { itemId: mid(t.db, b), state: 'condensed', condensed: 'condensed line', reason: 'old', by: 'subconscious' },
      { itemId: mid(t.db, c), state: 'hidden', reason: 'old', by: 'subconscious' },
    ]);
    // 13.11.2026: the record (the ledger's view, also as text in agents/history-text.ts) carries the marks: a hidden line leaves no trace
    const lines = t.ledger.view(t.tom.id, 'main').filter((item) => item.kind === 'message');
    assert.deepEqual(lines.map((item) => item.itemId), [mid(t.db, a), mid(t.db, b)]);
    assert.match(lines[1].text, /condensed line\n\{"compacted":"m\d+","was":"\d+ tokens","restore":"context\.restore"\}$/);
    const call = marksCall(marksOf(t.services, t.tom.id, 'main'));
    assert.equal(call?.tool, 'subconscious', 'named after the main AI\'s own tool');
    assert.match(call?.output ?? '', /^My context, kept small: condensed m\d+; hidden m\d+ – get any back with tools\.call \{"name":"context\.restore"/);
    assert.doesNotMatch(call?.output ?? '', /Hide this line/, 'a hidden item\'s words stay out');
    assert.deepEqual(inventedValues('took 40 seconds at /tmp/a/b', 'took 40 seconds at /tmp/a/b'), []);
    assert.deepEqual(inventedValues('took 40 seconds', 'took 41 seconds'), ['41']);
    assert.deepEqual(inventedValues('Hilfs-, System- und Kompaktierungsaufrufe, keine Bindung an Seiten, Hosts oder Shops', 'Hilfs-/System-/Kompaktierung, keine Seiten-/Host-/Shopbindung'), [], 'live 01.11.: a paraphrase is no path');
    assert.deepEqual(inventedValues('see the log', 'see /var/log/app.log'), ['/var/log/app.log'], 'a real path still counts');
    assert.deepEqual(inventedValues('exec: files__read({path:"C:\\\\Users\\\\Tom\\\\docs\\\\VISION.md"})', 'VISION.md (C:\\Users\\Tom\\docs\\VISION.md): a vision'), [], 'live 02.11.: a path as a script\'s JSON text wrote it, and a bracket after it');
    assert.deepEqual(inventedValues('C:\\Users\\Tom\\a.md', 'C:\\Users\\Ann\\a.md'), ['C:\\Users\\Ann\\a.md']);
    assert.equal(condensedProblem('short', 'short and longer'), 'it saves too little');
  } finally { t.cleanup(); }
});

test('the prompt lists the context tools; their lines stay short', () => {
  const list = toolList(FLOW_TOOLS);
  for (const name of ['context.list', 'context.read', 'context.condense', 'context.hide', 'context.restore']) assert.match(list, new RegExp(`- ${name.replace('.', '\\.')} `));
  const chars = toolList(contextTools).length;
  assert.ok(chars < 1250, String(chars)); // 13.11.2026: the owner's commands hide {before, keep} and condense {texts} add their words
});

test('live 02.11.: a hidden item can be condensed without a restore in between', async () => {
  const t = ledgerSetup();
  try {
    fourTurns(t);
    const { run, shown } = runOf(t);
    await tool('context.hide').run({ ids: ['t1'] }, run);
    assert.match(String(await tool('context.condense').run({ id: 't1', text: 'build 1 finished in 401 seconds' }, run)), /^condensed t1/);
    const view = t.ledger.view(t.tom.id, 'main').find((entry) => entry.itemId === 't1')!;
    assert.match(view.text, /^build 1 finished in 401 seconds\n\{"compacted":"t1"/);
    assert.deepEqual(shown, [], 'nothing was shown to the main AI on the way');
  } finally { t.cleanup(); }
});

test('live 02.11.: a path the call named is no invented value when its output is condensed', async () => {
  const t = ledgerSetup();
  try {
    fourTurns(t);
    const { run } = runOf(t);
    const said = 'build 1 finished in 401 seconds; the command was: build 1';
    assert.match(String(await tool('context.condense').run({ id: 't1', text: said }, run)), /^condensed t1/);
  } finally { t.cleanup(); }
  const t2 = ledgerSetup();
  try {
    const turn = t2.turn(t2.say('Read it please, with some words.').seq);
    t2.ourCall(turn, 'files.read', { path: 'C:\\Users\\Tom\\docs\\VISION.md' }, `Our vision is one app.\n${'more text\n'.repeat(400)}`, 'c1');
    t2.done(turn);
    t2.clock.advance(1000);
    for (let index = 2; index <= 4; index++) { const run = t2.turn(t2.say(`Step ${index} please, with some words.`).seq); t2.done(run); t2.clock.advance(1000); }
    await t2.journal.settled();
    const { run } = runOf(t2);
    const id = t2.ledger.items(t2.tom.id, 'main').find((item) => item.kind !== 'message')!.itemId;
    assert.match(String(await tool('context.condense').run({ id, text: 'C:\\Users\\Tom\\docs\\VISION.md: one app.' }, run)), /^condensed /);
    assert.match(String(await tool('context.condense').run({ id, text: 'C:\\Users\\Ann\\VISION.md: one app.' }, run)), /values the original lacks/);
  } finally { t2.cleanup(); }
});

test('13.11.2026: context.hide {before, keep} hides everything older but what I keep and what stays out of reach; context.condense {texts} puts my own words in place', async () => {
  const t = ledgerSetup();
  try {
    fourTurns(t);
    const { run } = runOf(t);
    const out = String(await tool('context.hide').run({ before: 't3', keep: ['t1'] }, run));
    assert.match(out, /^hidden \d+ items before t3 \(m\d+…\w+\), kept t1/);
    const state = (id: string) => t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === id)!.state;
    assert.deepEqual([state('t1'), state('t2'), state('t3'), state('t4')], ['keep', 'hidden', 'keep', 'keep'], 'older but kept, older, the edge, the newest turn');
    assert.match(String(await tool('context.hide').run({ before: 'nope' }, run)), /No such item: nope/);

    const said = String(await tool('context.condense').run({ texts: { t1: 'build 1 finished in 401 seconds' } }, run));
    assert.match(said, /condensed t1: about \d+ tokens saved/);
    const view = t.ledger.view(t.tom.id, 'main').find((item) => item.itemId === 't1')!;
    assert.match(view.call?.output ?? view.text, /build 1 finished in 401 seconds\n\{"compacted":"t1"/, 'marked condensed with its stamp for the main AI');
    assert.match(String(await tool('context.condense').run({ texts: { t3: 'build 3 took 999 seconds' } }, run)), /names values the original lacks: 999/);
  } finally { t.cleanup(); }
});
