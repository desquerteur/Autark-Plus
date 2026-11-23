// The person's Forget reaches the context ledger (context/ledger/forget.ts via rpc knowledge.forget): a fact that sits only in a
// long tool output's blob (past the run item's first 4,000 characters), or in a condensed text, never comes back through
// context.restore or a native rebuild's view – nor through a title or lean text made from its original, also on a row the retention
// already pruned (its lean text lost its values at that prune). Unrelated items stay whole, their lean texts too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerSetup } from './ledger-fixture.ts';
import { journalRow } from '../../../src/runtime/context/ledger/originals.ts';
import { fingerprint, mentions } from '../../../src/runtime/privacy/mentions.ts';
import { LEDGER_FORGOTTEN } from '../../../src/runtime/context/ledger/forget.ts';
import { LEAN_REASON, LEAN_TEXT, leanText } from '../../../src/runtime/context/ledger/window.ts';

const FACT = 'Invoice INV-55821 for Brightwave is disputed';
const UNRELATED = `${'w'.repeat(6_000)}\nwrote dist/app.js and C:\\Users\\me\\proj\\out.json`;

async function setup() {
  const t = ledgerSetup();
  const run = t.turn();
  t.ourCall(run, 'web.fetch', { url: 'https://example.com/a' }, `${'x'.repeat(5_000)}\n${FACT}\n`, 'c1'); // t1: only in the blob
  t.ourCall(run, 'files.read', { path: 'notes.txt' }, `${FACT}\n${'y'.repeat(5_000)}`, 'c2'); // f2: in the row's first 4,000 too
  t.ourCall(run, 'shell.exec', { command: 'npm test' }, 'z'.repeat(6_000), 'c3'); // t3: unrelated, condensed below
  t.ourCall(run, 'shell.exec', { command: 'ls' }, UNRELATED, 'c4'); // t4: unrelated, its lean text and original stay whole
  await t.journal.settled();
  t.ledger.mark(t.tom.id, 'main', [
    { itemId: 't3', state: 'condensed', condensed: `tests pass; ${FACT}`, reason: 'log', by: 'subconscious' },
    { itemId: 't4', state: 'condensed', condensed: leanText(UNRELATED), reason: LEAN_REASON, by: 'window' },
  ]);
  const itemOf = (itemId: string) => journalRow(t.db, t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === itemId)!.ref!.slice(5))!;
  return { t, itemOf };
}

test('ledger.forget: blob originals that mention it are pruned and no longer named; condensed copies read [forgotten]; others stay', async () => {
  const { t, itemOf } = await setup();
  try {
    const { ledger, tom, chat } = t;
    const blob1 = itemOf('t1').data.outputBlob as string;
    const blob4 = itemOf('t4').data.outputBlob as string;
    const t4Before = ledger.items(tom.id, 'main').find((item) => item.itemId === 't4')!;
    assert.ok(t4Before.condensed?.includes('dist/app.js, C:\\Users\\me\\proj\\out.json'), 'before: t4\'s lean text keeps its values');
    assert.match(ledger.original(tom.id, 'main', 't1')!.text, /INV-55821/, 'before: the blob holds it');
    const print = fingerprint([FACT]);
    const result = ledger.forget((text) => mentions(text, print));
    assert.equal(result.truncated, false);
    assert.equal(result.originals, 2, 't1 (blob) and f2 (row and blob)');

    const t1 = ledger.original(tom.id, 'main', 't1')!;
    assert.equal(t1.pruned, true);
    assert.doesNotMatch(t1.text, /INV-55821|Brightwave/);
    assert.equal(itemOf('t1').data.outputBlob, undefined, 'the run item no longer names the blob');
    assert.ok(t.reclaimed.includes(blob1), 'the blob goes back to the clean-up');
    const t3 = ledger.items(tom.id, 'main').find((item) => item.itemId === 't3')!;
    assert.equal(t3.condensed, LEDGER_FORGOTTEN);
    const view = ledger.view(tom.id, 'main');
    for (const id of ['t1', 't3']) assert.doesNotMatch(JSON.stringify(view.find((item) => item.itemId === id)), /INV-55821|Brightwave/, `a rebuild carries none of ${id}`);
    assert.doesNotMatch(JSON.stringify(view.find((item) => item.itemId === 'f2')), /INV-55821|Brightwave/, 'f2 stayed in full until now; a rebuild carries none of it');
    assert.equal(itemOf('t4').data.outputBlob, blob4);
    assert.equal(ledger.original(tom.id, 'main', 't4')!.text, UNRELATED, 'an unrelated original stays whole');
    const t4 = ledger.items(tom.id, 'main').find((item) => item.itemId === 't4')!;
    assert.deepEqual([t4.condensed, t4.title, t4.state], [t4Before.condensed, t4Before.title, 'condensed'], 'an unrelated lean text and title stay');
    assert.ok(!t.reclaimed.includes(blob4));
  } finally { t.cleanup(); }
});

test('ledger.forget (14.11.2026): a lean text keeps an original\'s values without the words around them – when the original goes, its condensed text goes too', async () => {
  const t = ledgerSetup();
  try {
    const run = t.turn();
    t.ourCall(run, 'files.read', { path: 'contacts.txt' }, `Anna Schmidt E-Mail: anna.schmidt@example.de\n${'v'.repeat(5_000)}`, 'c1');
    await t.journal.settled();
    t.ledger.mark(t.tom.id, 'main', [{ itemId: 'f1', state: 'condensed', condensed: 'Output set aside when that piece of work was finished.\nValues in it: anna.schmidt@example.de', reason: 'finished work, kept as a trace', by: 'window' }]);
    const print = fingerprint(['Anna Schmidt E-Mail: anna.schmidt@example.de']);
    assert.equal(mentions('Output set aside when that piece of work was finished.\nValues in it: anna.schmidt@example.de', print), false, 'the lean text alone does not match the fact');
    t.ledger.forget((text) => mentions(text, print));
    const f1 = t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === 'f1')!;
    assert.equal(f1.condensed, LEDGER_FORGOTTEN);
    assert.doesNotMatch(JSON.stringify(t.ledger.view(t.tom.id, 'main')), /anna\.schmidt/);
  } finally { t.cleanup(); }
});

const CONTACT = 'Anna Schmidt E-Mail: anna.schmidt@example.de';
const CONTACTS = `Kontakte gelesen.\n${'Eintrag ohne Bezug. '.repeat(20)}\nTreffer: Anna Schmidt, E-Mail anna.schmidt@example.de\n${'v'.repeat(5_000)}`;

test('ledger.forget: a title made from the original (the call\'s summary names the address alone) goes with it, and a rebuild no longer replays it', async () => {
  const t = ledgerSetup();
  try {
    const run = t.turn();
    t.ourCall(run, 'contacts.find', { query: 'anna.schmidt@example.de' }, CONTACTS, 'c1');
    await t.journal.settled();
    const print = fingerprint([CONTACT]);
    const before = t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === 't1')!;
    assert.match(before.title, /anna\.schmidt@example\.de/);
    assert.equal(mentions(before.title, print), false, 'the title alone does not match the fact');
    const result = t.ledger.forget((text) => mentions(text, print));
    assert.deepEqual([result.items, result.originals], [1, 1]);
    assert.equal(t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === 't1')!.title, LEDGER_FORGOTTEN);
    assert.doesNotMatch(JSON.stringify(t.ledger.view(t.tom.id, 'main')), /anna\.schmidt/);
  } finally { t.cleanup(); }
});

/** A lean row whose original the retention pruned (budget 1 byte, 15 days after the mark): its row as it stands then. */
async function prunedLean(output: string) {
  const t = ledgerSetup({ budget: 1 });
  const run = t.turn();
  t.ourCall(run, 'files.read', { path: 'contacts.txt' }, output, 'c1');
  t.ourCall(run, 'shell.exec', { command: 'ls' }, 'z'.repeat(6_000), 'c2');
  await t.journal.settled();
  const lean = leanText(output);
  t.ledger.mark(t.tom.id, 'main', [{ itemId: 'f1', state: 'condensed', condensed: lean, reason: LEAN_REASON, by: 'window' }]);
  t.clock.set(t.clock.now() + 15 * 24 * 60 * 60_000);
  t.ledger.mark(t.tom.id, 'main', [{ itemId: 't2', state: 'hidden', reason: 'x', by: 'window' }]); // a later mark runs the retention
  const f1 = () => t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === 'f1')!;
  return { t, lean, f1 };
}

test('ledger.forget: a lean row whose original the retention already pruned still loses what its lean text kept', async () => {
  const { t, lean, f1 } = await prunedLean(CONTACTS);
  try {
    assert.ok(lean.includes('anna.schmidt@example.de'), 'the lean text kept the address');
    assert.equal(f1().pruned, true, 'before: the retention pruned the original');
    assert.ok(!f1().condensed?.includes('anna.schmidt@example.de') && f1().condensed?.startsWith(LEAN_TEXT), 'the prune took its values, its start stays');
    const print = fingerprint([CONTACT]);
    const result = t.ledger.forget((text) => mentions(text, print));
    assert.deepEqual([result.items, result.originals], [1, 0], 'the row\'s copies go; its original was pruned before');
    assert.deepEqual([f1().condensed, f1().title], [LEDGER_FORGOTTEN, LEDGER_FORGOTTEN]);
    assert.doesNotMatch(JSON.stringify(t.ledger.view(t.tom.id, 'main')), /anna\.schmidt/);
  } finally { t.cleanup(); }
});

test('ledger.forget (14.11.2026): a value a pruned row\'s lean text took from past the run item\'s first 4,000 characters is gone already', async () => {
  const { t, lean, f1 } = await prunedLean(`Kontakte gelesen.\n${'v'.repeat(5_000)}\nTreffer: Anna Schmidt, E-Mail anna.schmidt@example.de`);
  try {
    assert.ok(lean.includes('anna.schmidt@example.de'), 'the lean text kept the address from past character 5,000');
    const print = fingerprint([CONTACT]);
    const result = t.ledger.forget((text) => mentions(text, print));
    assert.equal(result.items, 0, 'the run item holds only the first 4,000 characters: nothing left to match');
    assert.equal(f1().pruned, true);
    assert.doesNotMatch(JSON.stringify(t.ledger.items(t.tom.id, 'main')), /anna\.schmidt/, 'the prune took the values');
    assert.doesNotMatch(JSON.stringify(t.ledger.view(t.tom.id, 'main')), /anna\.schmidt/, 'a rebuild carries none of it');
  } finally { t.cleanup(); }
});

test('ledger.forget: a fact only in a call\'s arguments (knowledge.remember) leaves a rebuild too, its pair stays', async () => {
  const t = ledgerSetup();
  try {
    const run = t.turn();
    t.ourCall(run, 'knowledge.remember', { title: 'Dispute', body: FACT }, 'saved', 'c1');
    await t.journal.settled();
    assert.match(JSON.stringify(t.ledger.view(t.tom.id, 'main')), /INV-55821/, 'before: the call names it');
    const print = fingerprint([FACT]);
    t.ledger.forget((text) => mentions(text, print));
    const view = t.ledger.view(t.tom.id, 'main');
    assert.doesNotMatch(JSON.stringify(view), /INV-55821|Brightwave/);
    assert.equal(view[0].call?.callId, 'c1', 'the pair stays whole');
    assert.equal(typeof view[0].call?.output, 'string');
    assert.equal(t.ledger.original(t.tom.id, 'main', view[0].itemId)?.pruned, true);
  } finally { t.cleanup(); }
});
