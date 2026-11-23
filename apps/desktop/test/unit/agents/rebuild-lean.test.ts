// B-089 (11.11.2026, live 10.11.: every model call re-sends the whole session; sessions sat at the window's ceiling) – the lean history
// (agents/rebuild.ts, context/ledger/window.ts leanMarks). At every native rebuild the tool work of finished runs keeps its call in
// place and leaves its output, their reasoning is hidden; chat lines, the agent's own words, the newest run, the open task's runs
// and pins stay.
// KI-Runde 17.11.2026: the lean history and the subconscious's marks ride on a rebuild that happens anyway – a warm session is
// never rebuilt for a saving (no weighing, no "does not pay yet" note); a session that rested past the cache starts anew with them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, view } from './rebuild-harness.ts';
import { leanKeep } from '../../../src/runtime/agents/rebuild.ts';
import { CACHE_COLD_MS } from '../../../src/runtime/agents/compaction-policy.ts';
import { LEAN_REASON, LEAN_TEXT, entryTokens, leanCost, leanMarks, leanText } from '../../../src/runtime/context/ledger/window.ts';
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
  assert.equal(marks[1].saves, 450);
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
  assert.ok(lean.before > 60_000 && lean.after < 18_000, JSON.stringify(lean));
  assert.equal(native.tokens, lean.after);
});

test('the same engine, warm: no rebuild for a saving – not for the lean history, not for waiting marks, however much they would take off; nothing is weighed, written or noted', async () => {
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
  ]).map((item) => ({ ...item, runId: item.itemId === 't20' || item.itemId === 'a21' ? 'run_newest' : 'run_old' })); // 144,000 tokens of finished output
  // Until 17.11.2026 this saving ("worth nine re-sends over the run's calls") rebuilt the warm session at once; measured, such
  // rebuilds took 11 % off and each paid a full cache write – a written token costs 40 read ones.
  h.ledgerState.need = undefined;
  h.send('Next');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 0, 'the lean saving waits for a rebuild that happens anyway');
  h.ledgerState.need = { since: 2, reason: '4 condensed', saves: 80_000 };
  h.send('Then');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 0, 'and so do the subconscious\'s marks');
  assert.equal(h.ledgerState.marks.length, 0, 'nothing written for a rebuild that does not run');
  assert.ok(![...h.notes('run_2'), ...h.notes('run_3')].some((note) => note.rebuild), 'no "does not pay yet" note: there is no weighing');
  assert.equal(h.codex.calls[2].session?.ref, 'codex-s1', 'the session goes on cached');

  h.clock.set(h.clock.now() + 61 * 60_000); // the session rested past a provider cache
  h.send('Later');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1, 'cold: the next call is uncached either way – the marks and the lean history land');
  const native = h.notes('run_4').find((note) => note.rebuild === 'native')!;
  assert.equal(native.why, 'cold');
  assert.equal((native.lean as { condensed: number }).condensed, 12, 'every finished output set aside at once');
  assert.ok((native.lean as { after: number }).after < 22_000, JSON.stringify(native.lean));
});

test('a cold session with a lean saving alone starts anew; one with nothing to set aside and no marks goes on as it is', async () => {
  const h = setup();
  condensing(h);
  h.send('Hello');
  await h.turn('codex');
  const seen = h.cursor();
  lastingView(h, seen, 6_000);
  h.ledgerState.need = undefined;
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1);
  h.send('Later');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1, 'the finished run\'s output is set aside: something lands');
  assert.deepEqual(h.ledgerState.marks.map((mark) => mark.itemId), ['t2', 'r3']);

  h.ledgerState.view = h.ledgerState.view.map((item) => ({ ...item, runId: 'run_newest' })); // nothing finished to set aside
  h.ledgerState.need = undefined;
  h.clock.set(h.clock.now() + CACHE_COLD_MS + 1);
  h.send('Much later');
  await h.turn('codex');
  assert.equal(h.codex.rebuilds.length, 1, 'the session holds the record as the ledger has it: it resumes');
  assert.equal(h.codex.calls[2].session?.ref, 'codex-r1');
});
