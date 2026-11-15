// B-089 (11.11.2026, live 10.11.: every model call re-sends the whole session; sessions sat at the window's ceiling) – the lean history
// and the rebuild for savings (agents/rebuild.ts, context/ledger/window.ts leanMarks). At every native rebuild the tool work of
// finished runs keeps its call in place and leaves its output, their reasoning is hidden; chat lines, the agent's own words, the
// newest run, the open task's runs and pins stay. On the same engine a rebuild for savings runs when it pays: a cold cache needs any
// saving, a warm one saves × calls ≥ 9 × resend. Review fixes (11.11.): the rows' estimate is weighed again with the view's figures and a
// refusal is remembered until the rows show clearly more; n is one run's calls (its stored count, else input over context); rows that
// size the rebuild no smaller than the live session read no view.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, view } from './rebuild-harness.ts';
import { CACHE_COLD_MS, leanKeep } from '../../../src/runtime/agents/rebuild.ts';
import { LEAN_REASON, LEAN_TEXT, entryTokens, leanCost, leanMarks, leanRows, leanText, rowTokens, rowsResend, type LeanMark } from '../../../src/runtime/context/ledger/window.ts';
import { compactStamp, type LedgerItem, type LedgerViewItem } from '../../../src/shared/model/context-ledger.ts';

const entry = (itemId: string, kind: LedgerViewItem['kind'], chars: number, extra: Partial<LedgerViewItem> = {}): LedgerViewItem => ({
  itemId, kind, role: kind === 'message' ? 'user' : kind === 'tool' ? 'tool' : 'assistant', text: 'x'.repeat(chars), origin: {}, order: Number(itemId.slice(1)), state: 'keep',
  ...(kind === 'tool' || kind === 'skill' || kind === 'file' ? { call: { name: 'shell', args: { command: 'npm test' }, callId: itemId, output: 'x'.repeat(chars) } } : {}), ...extra,
});

test('leanMarks: finished runs leave their outputs (call in place) and their reasoning; lines, own words, kept runs, pins, nested and small items stay', () => {
  const entries = [
    entry('m1', 'message', 9000, { runId: 'old' }), entry('t2', 'tool', 9000, { runId: 'old' }), entry('r3', 'reasoning', 900, { runId: 'old' }),
    entry('a4', 'assistant', 9000, { runId: 'old' }), entry('t5', 'tool', 9000, { runId: 'old', nested: true }), entry('t6', 'tool', 9000, { runId: 'old' }),
    entry('t7', 'tool', 10, { runId: 'old' }), entry('s8', 'skill', 9000, { runId: 'old' }), entry('t9', 'tool', 9000, { runId: 'old', state: 'condensed' }),
    entry('t10', 'tool', 9000), entry('t11', 'tool', 9000, { runId: 'task' }), entry('t12', 'tool', 9000, { runId: 'newest' }),
  ];
  const marks = leanMarks(entries, { runs: new Set(['newest', 'task']), pinned: new Set(['t6']) });
  assert.deepEqual(marks.map((mark) => [mark.itemId, mark.state]), [['t2', 'condensed'], ['r3', 'hidden']], 'a loaded skill (s8) stays: its body is instructions, not finished output');
  assert.equal(marks[0].saves, entryTokens(entries[1]) - leanCost(entries[1]), 'the saving is the output minus the condensed form');
  assert.equal(marks[1].saves, 300);
  assert.equal(marks[0].text, leanText(entries[1].call!.output), 'the condensed text is the output\'s lean text');
  const condensed = `${leanText(entries[1].call!.output)}\n${compactStamp('t2', entryTokens(entries[1]))}`;
  assert.equal(leanCost(entries[1]), entryTokens({ text: '', call: { name: '', args: { command: 'npm test' }, callId: '', output: condensed } }), 'arguments, text and stamp');
  assert.ok(leanCost(entries[6]) >= entryTokens(entries[6]), 't7 is smaller than its condensed form: it stays');
  assert.match(LEAN_REASON, /finished work/);
});

test('leanText (14.11.2026): a set-aside output keeps how it began and its values – ids, paths, file names, links, addresses – within its room', () => {
  const output = [
    'Script completed\nOutput:\n', 'x'.repeat(3000),
    '\nwrote C:\\Users\\me\\Workforce\\versand\\campaign-dnc.json and scoped-contact-holds.json for task_1m72jv1crkqkehda8;',
    ' mail to press@example.org, see https://example.com/press/123 and nora-betrieb/versand/outbox/r22.md\n', 'y'.repeat(3000),
  ].join('');
  const text = leanText(output);
  assert.ok(text.startsWith(`${LEAN_TEXT} It began: Script completed Output: x`), text.slice(0, 120));
  for (const value of ['C:\\Users\\me\\Workforce\\versand\\campaign-dnc.json', 'scoped-contact-holds.json', 'task_1m72jv1crkqkehda8', 'press@example.org', 'https://example.com/press/123', 'nora-betrieb/versand/outbox/r22.md']) {
    assert.ok(text.includes(value), `keeps ${value}`);
  }
  assert.ok(text.length < output.length * 0.4 + 120, 'within its share of the output');
  const many = Array.from({ length: 2000 }, (_, i) => `file-${i}.json`).join('\n');
  assert.ok(leanText(many).length <= 2000 + 120, 'at most 2,000 characters of start and values');
  assert.equal(leanText('   '), LEAN_TEXT, 'an empty output keeps only the line');
  const pad = 'z'.repeat(3000); // past the start, so only the values can hold what follows
  const spaced = leanText(`${pad} saved C:\\Users\\ann\\Projects\\My Shop App\\code\\apps\\x.ts and docs/Übersicht/plan.md, Bericht_März.pdf`);
  for (const value of ['C:\\Users\\ann\\Projects\\My Shop App\\code\\apps\\x.ts', 'docs/Übersicht/plan.md', 'Bericht_März.pdf']) assert.ok(spaced.includes(value), `keeps ${value} whole`);
  const shapes = leanText(`${pad} {"path":"C:\\\\Users\\\\me\\\\proj\\\\x.ts","ok":true} {"source":"read({path:\\"D:\\\\\\\\data\\\\\\\\y.ts\\"})"}`
    + ' wrote /home/user/project/src/file.ts, see (/docs/plan.md) and docs/U\u0308bersicht/plan.md, U\u0308bersicht.md, node read C:/Users/me/x.ts and C:/boot.ini'
    + ' at file:///C:/Users/me/app/main.mjs:12:5');
  for (const value of ['C:\\\\Users\\\\me\\\\proj\\\\x.ts', 'D:\\\\\\\\data\\\\\\\\y.ts', '/home/user/project/src/file.ts', '/docs/plan.md', 'docs/U\u0308bersicht/plan.md', 'U\u0308bersicht.md', 'C:/Users/me/x.ts', 'C:/boot.ini', 'file:///C:/Users/me/app/main.mjs:12:5']) {
    assert.ok(shapes.includes(value), `keeps ${value} whole (JSON-escaped once and twice, absolute, decomposed, a drive with slashes)`);
  }
  assert.ok(!shapes.includes(', /Users/me/x.ts'), 'a slash drive path keeps its drive');
  const listed = leanText(`${pad} files: C:\\a\\x.ts, C:\\a\\y.ts, and lib\\z.ts`);
  assert.ok(listed.endsWith('\nValues in it: C:\\a\\x.ts, C:\\a\\y.ts, z.ts'), `a comma ends a Windows path: ${listed.slice(-60)}`);
  const after = leanText(`${'s'.repeat(3000)} ${'a'.repeat(1000)}/${'b'.repeat(1500)}.md short/x.ts`);
  assert.ok(after.includes('short/x.ts') && !after.includes('b'.repeat(1500)), 'a short value after one too long for the room is kept');
  const started = Date.now();
  const long = leanText(`${'a.'.repeat(32_000)}\n${'f'.repeat(32_000)}`);
  const dots = '.'.repeat(64_000);
  const runs = ['a.'.repeat(32_000), 'x-'.repeat(32_000), `${'a'.repeat(64_000)}@`, 'a/'.repeat(32_000), `a/${dots}x`, `https://${dots}x`, `https://${';.'.repeat(32_000)}x`,
    `C:\\${'a\\\\\\'.repeat(16_000)}`, 'C:\\\\'.repeat(16_000), '/a'.repeat(32_000), 'a//'.repeat(21_000), 'a\u0308.'.repeat(21_000),
    'C:/'.repeat(21_000), `C:/${'a/'.repeat(32_000)}`, `file:///${dots}x`];
  for (const run of runs) leanText(run);
  assert.ok(Date.now() - started < 2_000, `linear on long runs of name and trailing characters (${Date.now() - started} ms)`);
  assert.ok(long.startsWith(LEAN_TEXT));
});

test('leanKeep: this run, the newest run and every run on the open task stay in full; a done task keeps none of its runs', () => {
  const entries = [entry('t1', 'tool', 10, { runId: 'r_task' }), entry('t2', 'tool', 10, { runId: 'r_other' }), entry('t3', 'tool', 10, { runId: 'r_new' })];
  const runs = { get: (id: string) => ({ id, taskId: id === 'r_task' ? 'task_1' : undefined }) } as never;
  const open = leanKeep({ runs }, { task: { id: 'task_1', status: 'working' } as never }, entries, { newestRun: 'r_new', pinned: new Set(['a9']) }, 'r_this');
  assert.deepEqual([...open.runs].sort(), ['r_new', 'r_task', 'r_this']);
  assert.deepEqual([...open.pinned], ['a9']);
  const done = leanKeep({ runs }, { task: { id: 'task_1', status: 'done' } as never }, entries, { newestRun: 'r_new', pinned: new Set() }, 'r_this');
  assert.deepEqual([...done.runs].sort(), ['r_new', 'r_this']);
});

const rowOf = (item: LedgerViewItem, tokens = entryTokens(item)): LedgerItem => ({
  agentId: 'a', conversationId: 'c', itemId: item.itemId, kind: item.kind, order: item.order, createdAt: 0, tokens, title: '', state: item.state, origin: {},
  ...(item.runId ? { runId: item.runId } : {}), ...(item.nested ? { nested: true } : {}),
});

test('leanRows picks what leanMarks picks without reading an original; rowsResend sizes the lean history from the rows', () => {
  const entries = [
    entry('m1', 'message', 900, { runId: 'old' }), entry('t2', 'tool', 9000, { runId: 'old' }), entry('r3', 'reasoning', 900, { runId: 'old' }),
    entry('a4', 'assistant', 900, { runId: 'old' }), entry('t5', 'tool', 9000, { runId: 'old', nested: true }), entry('f6', 'file', 9000, { runId: 'old' }),
    entry('t7', 'tool', 9000, { runId: 'old', state: 'condensed' }), entry('t8', 'tool', 9000, { runId: 'new' }), entry('t9', 'tool', 9000, { runId: 'old' }),
  ];
  const keep = { runs: new Set(['new']), pinned: new Set(['t9']) };
  const rows = entries.map((item) => rowOf(item));
  const pick = (marks: LeanMark[]) => marks.map((mark) => [mark.itemId, mark.state]);
  assert.deepEqual(pick(leanRows(rows, keep)), pick(leanMarks(entries, keep)));
  assert.deepEqual(pick(leanRows(rows, keep)), [['t2', 'condensed'], ['r3', 'hidden'], ['f6', 'condensed']]);
  const huge = rowOf(entry('t2', 'tool', 9000, { runId: 'old' }), 400_000);
  assert.equal(rowTokens(huge, 24_000), 8_000, 'a row counts at most what a rebuild shows of it');
  const lean = leanRows(rows, keep);
  const resend = rowsResend(rows, lean);
  assert.ok(resend < rows.reduce((sum, row) => sum + row.tokens, 0) - 8_000 && resend > 2 * 3_000 + 600, `${resend}: t8, t9 and the lines in full, the rest short`);
});

type Harness = ReturnType<typeof setup>;
/** The fake ledger applies hides only and its rows carry no run or size; here a condensed mark also reaches the view as view.ts
 *  renders it, and the rows are the view's (run, state, size) plus the hidden ones. */
function condensing(h: Harness): void {
  const ledger = h.s.ledger as unknown as { mark: (a: string, c: string, marks: Array<{ itemId: string; state: string; by: string; condensed?: string }>) => void; items: (...args: unknown[]) => LedgerItem[] };
  ledger.items = (_a, _c, opts) => [...h.ledgerState.view.map((item) => rowOf(item)), ...h.ledgerState.marked]
    .filter((row) => row.order >= ((opts as { since?: number } | undefined)?.since ?? 0)).sort((a, b) => a.order - b.order);
  const mark = ledger.mark.bind(ledger);
  ledger.mark = (a, c, marks) => {
    mark(a, c, marks);
    for (const one of marks) {
      if (one.state !== 'condensed') continue;
      h.ledgerState.view = h.ledgerState.view.map((item) => {
        if (item.itemId !== one.itemId || !item.call) return item;
        const text = `${one.condensed}\n${compactStamp(item.itemId, entryTokens(item))}`;
        return { ...item, state: 'condensed', text, call: { ...item.call, output: text } };
      });
    }
  };
}

const work = (chars: number) => 'w'.repeat(chars);
function lastingView(h: Harness, seen: number, oldChars: number): void {
  h.ledgerState.view = view([
    [`m${seen}`, 'message', 'user', '[09:00] Alex: Hello'],
    ['t2', 'tool', 'tool', work(oldChars), { name: 'shell', args: { command: 'npm test' }, callId: 'c2', output: work(oldChars) }],
    ['r3', 'reasoning', 'assistant', 'thinking about the tests'],
    ['a4', 'assistant', 'assistant', 'The tests pass.'],
    ['t5', 'tool', 'tool', work(30_000), { name: 'shell', args: { command: 'npm run build' }, callId: 'c5', output: work(30_000) }],
    ['a6', 'assistant', 'assistant', 'Built.'],
  ]).map((item) => ({ ...item, runId: Number(item.itemId.slice(1)) >= 5 ? 'run_newest' : 'run_old' }));
}

test('a switch rebuilds with the lean history: the finished run leaves its output and reasoning, the newest run and the words stay', async () => {
  const h = setup();
  condensing(h);
  h.send('Hello');
  await h.turn('claude');
  const seen = h.cursor();
  lastingView(h, seen, 90_000);
  h.send('Next');
  await h.turn('codex');
  assert.deepEqual(h.ledgerState.marks, [{ itemId: 't2', state: 'condensed', by: 'window' }, { itemId: 'r3', state: 'hidden', by: 'window' }]);
  const items = h.codex.rebuilds[0].items;
  assert.deepEqual(items.map((item) => item.itemId), [`m${seen}`, 't2', 'a4', 't5', 'marks2', 'a6']);
  assert.equal(items[1].call?.args && (items[1].call.args as { command: string }).command, 'npm test', 'the call with its arguments stays in place');
  assert.match(items[1].call?.output ?? '', /^Output set aside when that piece of work was finished\. It began: [^\n]* …\n\{"compacted":"t2"/);
  assert.equal(items[3].call?.output.length, 30_000, 'the newest run keeps its output');
  const native = h.notes('run_2').find((note) => note.rebuild === 'native')!;
  const lean = native.lean as { condensed: number; hidden: number; before: number; after: number };
  assert.deepEqual([lean.condensed, lean.hidden], [1, 1]);
  assert.ok(lean.before > 30_000 && lean.after < 12_000, JSON.stringify(lean));
  assert.equal(native.tokens, lean.after);
});

test('the same engine: a warm saving that does not pay waits (silent for a lean saving alone, a note while marks wait); a cold cache rebuilds; a restore alone does not', async () => {
  const h = setup();
  condensing(h);
  h.codex.state.reply = () => ({ usage: { inputTokens: 250_000, outputTokens: 10 }, contextTokens: 50_000 }); // five calls of ~50k
  h.send('Hello');
  await h.turn('codex');
  const seen = h.cursor();
  lastingView(h, seen, 6_000); // the finished run's output: 2,000 tokens
  h.ledgerState.need = undefined;
  h.send('Next');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 0);
  assert.equal(h.ledgerState.marks.length, 0, 'nothing written for a rebuild that does not run');
  assert.ok(!h.notes('run_2').some((note) => note.rebuild), 'a lean saving alone waits in silence');
  assert.equal(h.codex.calls[1].session?.ref, 'codex-s1', 'the session goes on cached');

  h.ledgerState.need = { since: 2, reason: '1 condensed', saves: 100, marked: true };
  h.send('Then');
  await h.turn('codex');
  const skipped = h.notes('run_3').find((note) => note.rebuild)!;
  const finished = h.s.runs.list(h.agent.id, 10).filter((run) => run.id !== 'run_3' && run.status === 'done');
  assert.deepEqual(finished.map((run) => run.inputTokens), [250_000, 250_000], 'two finished runs of five calls each lie behind it');
  assert.deepEqual([skipped.rebuild, skipped.why, skipped.calls], ['skipped', 'does not pay yet', 5], 'marks of the subconscious wait: the journal says why – the calls of one run, not of both');
  assert.ok(Number(skipped.saves) > 1_900 && Number(skipped.saves) * 5 < 9 * Number(skipped.resend), JSON.stringify(skipped));

  h.ledgerState.need = { since: 2, reason: '1 restored', saves: -400, marked: false };
  h.ledgerState.view = h.ledgerState.view.map((item) => ({ ...item, runId: 'run_newest' })); // nothing finished to set aside
  h.send('Again');
  await h.turn('codex');
  assert.ok(!h.notes('run_4').some((note) => note.rebuild), 'a restore alone rides along with the next saving');

  lastingView(h, seen, 6_000);
  h.ledgerState.need = undefined;
  h.clock.set(h.clock.now() + 61 * 60_000); // the session rested past a provider cache
  h.send('Later');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1, 'cold: the next call is uncached either way – the smaller session wins');
  assert.equal(h.notes('run_5').find((note) => note.rebuild)?.rebuild, 'native');
  assert.deepEqual(h.ledgerState.marks.map((mark) => mark.itemId), ['t2', 'r3']);
});

test('the same engine, warm: a saving worth nine re-sends over the run\'s calls rebuilds at once', async () => {
  const h = setup();
  condensing(h);
  h.codex.state.reply = () => ({ usage: { inputTokens: 250_000, outputTokens: 10 }, contextTokens: 120_000 }); // two calls of ~120k
  h.send('Hello');
  await h.turn('codex');
  const seen = h.cursor();
  const old = Array.from({ length: 12 }, (_, index) => {
    const id = `t${index + 2}`;
    return [id, 'tool', 'tool', work(24_000), { name: 'shell', args: { command: `step ${index}` }, callId: id, output: work(24_000) }] as const;
  });
  h.ledgerState.view = view([
    [`m${seen}`, 'message', 'user', '[09:00] Alex: Hello'], ...old.map((row) => [...row] as Parameters<typeof view>[0][number]),
    ['t20', 'tool', 'tool', work(30_000), { name: 'shell', args: {}, callId: 'c20', output: work(30_000) }], ['a21', 'assistant', 'assistant', 'Built.'],
  ]).map((item) => ({ ...item, runId: item.itemId === 't20' || item.itemId === 'a21' ? 'run_newest' : 'run_old' })); // 96,000 tokens of finished output
  h.ledgerState.need = undefined;
  h.send('Next');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1);
  const native = h.notes('run_2').find((note) => note.rebuild === 'native')!;
  assert.equal(native.why, 'marks');
  assert.ok((native.lean as { after: number }).after < 15_000, JSON.stringify(native.lean));
});

/** Counts the fake ledger's view reads (each reads every original in the real ledger). */
function viewReads(h: Harness): { count: number } {
  const ledger = h.s.ledger as unknown as { view: (...args: unknown[]) => LedgerViewItem[] };
  const read = ledger.view.bind(ledger);
  const counter = { count: 0 };
  ledger.view = (...args) => { counter.count++; return read(...args); };
  return counter;
}
type Row = Parameters<typeof view>[0][number];
/** `count` finished calls of run `run` with long arguments and a one-line output (the rows count the arguments, the lean form keeps them). */
const longArgs = (from: number, count: number): Row[] => Array.from({ length: count }, (_, index) => {
  const id = `t${from + index}`;
  return [id, 'tool', 'tool', 'ok', { name: 'files.write', args: { path: `src/f${index}.ts`, content: 'c'.repeat(6_000) }, callId: id, output: 'ok' }];
});

test('weighed again with the view: long arguments and one-line outputs pass the rows but save nothing – no rebuild, nothing written, the view not read again until the rows show clearly more', async () => {
  const h = setup();
  condensing(h);
  const reads = viewReads(h);
  h.codex.state.reply = () => ({ usage: { inputTokens: 1_000_000, outputTokens: 10 }, contextTokens: 50_000 }); // twenty calls of ~50k
  h.send('Hello');
  await h.turn('codex');
  const seen = h.cursor();
  const build = (count: number) => {
    h.ledgerState.view = view([[`m${seen}`, 'message', 'user', '[09:00] Alex: Write the files'], ...longArgs(2, count), ['a90', 'assistant', 'assistant', 'Written.']])
      .map((item) => ({ ...item, runId: item.itemId === 'a90' ? 'run_newest' : 'run_old' }));
  };
  build(12);
  h.ledgerState.need = undefined;
  reads.count = 0;
  h.send('Next');
  await h.turn('codex');
  assert.equal(reads.count, 1, 'the rows estimate passed: the view was read once');
  assert.equal(h.codex.rebuilds.length, 0, 'the view finds nothing to save');
  assert.equal(h.ledgerState.marks.length, 0, 'nothing written');
  assert.ok(!h.notes('run_2').some((note) => note.rebuild), 'no marks of the subconscious wait: silent');

  h.send('Again');
  await h.turn('codex');
  assert.equal(reads.count, 1, 'the same rows: the refusal holds, no view read');

  build(14); // about 17 % more by the rows: not clearly more
  h.send('A bit more');
  await h.turn('codex');
  assert.equal(reads.count, 1, 'below 1.25× the refused saving: still no view read');

  build(24); // twice the refused saving
  h.send('Much more');
  await h.turn('codex');
  assert.equal(reads.count, 2, 'clearly more: read again');
  assert.equal(h.codex.rebuilds.length, 0, 'and refused again – the arguments stay in the lean form');
});

test('calls of one run: a stored count of model calls is n (0 counts as unknown and falls back to input over context)', async () => {
  const h = setup();
  condensing(h);
  h.codex.state.reply = () => ({ usage: { inputTokens: 250_000, outputTokens: 10 }, contextTokens: 50_000 }); // input over context: 5
  h.send('Hello');
  await h.turn('codex');
  lastingView(h, h.cursor(), 6_000);
  h.ledgerState.need = { since: 2, reason: '1 condensed', saves: 100, marked: true };
  h.s.runs.finish('run_1', { status: 'done', modelCalls: 3 });
  h.send('Next');
  await h.turn('codex');
  assert.equal(h.notes('run_2').find((note) => note.rebuild)?.calls, 3, 'the stored count');
  h.s.runs.finish('run_2', { status: 'done', modelCalls: 0 });
  h.send('Again');
  await h.turn('codex');
  assert.equal(h.notes('run_3').find((note) => note.rebuild)?.calls, 5, '0 is unknown: input over context');
});

test('the saving of finished runs builds up over warm turns until saves × calls ≥ 9 × resend – then one rebuild', async () => {
  const h = setup();
  condensing(h);
  h.codex.state.reply = () => ({ usage: { inputTokens: 250_000, outputTokens: 10 }, contextTokens: 50_000 }); // five calls a run
  h.send('Hello');
  await h.turn('codex');
  const seen = h.cursor();
  const finishedOutputs: Row[] = [];
  let rebuiltAt = 0;
  for (let turn = 1; turn <= 30 && !rebuiltAt; turn++) {
    finishedOutputs.push([`t${turn + 1}`, 'tool', 'tool', work(3_000), { name: 'shell', args: { command: `step ${turn}` }, callId: `c${turn}`, output: work(3_000) }]); // 1,000 tokens
    h.ledgerState.view = view([[`m${seen}`, 'message', 'user', '[09:00] Alex: Go on'], ...finishedOutputs, ['a99', 'assistant', 'assistant', 'Next step.']])
      .map((item) => ({ ...item, runId: item.itemId === 'a99' ? 'run_newest' : 'run_old' }));
    h.ledgerState.need = undefined;
    h.send(`Step ${turn}`);
    await h.turn('codex');
    if (h.codex.rebuilds.length) rebuiltAt = turn;
  }
  assert.ok(rebuiltAt > 1, `the first finished output alone did not pay; rebuilt at turn ${rebuiltAt}`);
  assert.equal(h.codex.rebuilds.length, 1, 'one rebuild');
  const native = h.notes(`run_${rebuiltAt + 1}`).find((note) => note.rebuild === 'native')!;
  assert.equal((native.lean as { condensed: number }).condensed, rebuiltAt, 'every finished output set aside at once');
});

test('rows that already size the rebuilt history no smaller than the live session read no view', async () => {
  const h = setup();
  condensing(h);
  const reads = viewReads(h);
  h.codex.state.reply = () => ({ usage: { inputTokens: 25_000, outputTokens: 10 }, contextTokens: 5_000 }); // the engine's own small count
  h.send('Hello');
  await h.turn('codex');
  lastingView(h, h.cursor(), 6_000); // the newest run alone holds 10,000 tokens: more than the live 5,000
  h.ledgerState.need = { since: 2, reason: '1 condensed', saves: 100, marked: true };
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1); // cold: any saving would pay – only the size check stands between it and the view
  reads.count = 0;
  h.send('Next');
  await h.turn('codex');
  assert.equal(reads.count, 0, 'no original read for a rebuild that could not make the session smaller');
  assert.equal(h.codex.rebuilds.length, 0);
  assert.equal(h.codex.calls[1].session?.ref, 'codex-s1');
});
