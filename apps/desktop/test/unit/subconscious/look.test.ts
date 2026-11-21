// Unterbewusstsein v2 (15.11.2026): what the subconscious reads and does before a turn besides the route (subconscious/look.ts through
// route-turn.ts routeTurn, the call the turn waits for, and condenseTurn, the call beside it nobody waits for). The word search's hits for what wakes the turn stand in its prompt and its answer's `open` lists them; each
// chosen one reaches the turn as the main AI's own knowledge.open – redacted, as many as the call chooses (no rule of three), never one
// it was not offered, and not again in the same version. The biggest items still whole in the agent's context stand there too – tool,
// file and skill items of at least ITEM_TOKENS, not of the newest finished run, never a message; the call says for every one whether
// its job is done (17.11.2026: one yes or no per item), a done one keeps its note and leanText's values (a note naming a value that
// stands neither in the original nor in what the call was shown is dropped), marked by the subconscious; the call has no way to hide
// (measured 15.11.: hiding lost the values). An effort decided already leaves out the effort, not the rest; the service hands the opened entries to the turn
// first. What another effort costs is said only where it costs something (17.11.2026: one hour, at the price table's write price). And (final6, 14.11.) the ledger keeps an
// entry the call opened whole like a loaded skill, while one the main AI opened itself goes lean.
// Owns: these assertions only. Never: real models, engines or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { fixture } from '../context/fixture.ts';
import { ledgerSetup } from '../context/ledger-fixture.ts';
import { cacheLife, condenseTurn, effortCost, effortKeepsCache, routeTurn } from '../../../src/runtime/subconscious/route-turn.ts';
import { ITEM_TOKENS, LOOK_REASON } from '../../../src/runtime/subconscious/look.ts';
import { LOOK_MS, ROUTE_WAIT_MS, SubconsciousImpl } from '../../../src/runtime/subconscious/service.ts';
import { leanMarks } from '../../../src/runtime/context/ledger/window.ts';
import { journalResult } from '../../../src/runtime/tools/journal.ts';
import type { StructuredRunner } from '../../../src/runtime/decision/types.ts';

type Call = Parameters<StructuredRunner>[0];
type Schema = { properties: Record<string, { items?: { enum?: string[]; properties?: { id?: { enum?: string[] } } } }> };
const enumOf = (call: Call, field: string): string[] => {
  const items = (call.schema as Schema).properties[field]?.items;
  return items?.enum ?? items?.properties?.id?.enum ?? [];
};

/** A decision model whose answer is made from the call it gets (the ids it was offered). */
function answering(answer: (call: Call) => Record<string, unknown>) {
  const calls: Call[] = [];
  const runner: StructuredRunner = async (call) => {
    calls.push(call);
    const structured = answer(call);
    return { text: JSON.stringify(structured), structured, by: 'fake' };
  };
  return { runner, calls };
}

test('hits: the call reads the word search for what wakes the turn and opens what it chooses as the main AI\'s own knowledge.open, redacted, once per version', async () => {
  const f = fixture(); // its secrets service knows the value "hunter2"
  const ida = f.org.add(agent('ag_ida', 'Ida', { role: 'Assistant' }));
  f.knowledge.memoryWrite({ folder: 'company/partner', title: 'Larsen Marine Portal', text: 'Larsen Marine Portal: login lars.aune, password hunter2' });
  const said = 'Log in to the Larsen Marine Portal and download the invoices.';
  const brain = answering((call) => ({ open: [...enumOf(call, 'open').filter((id) => id.includes('larsen')), 'note:company:partner:made-up.md'].map((id) => ({ id, changes: 'the portal login it needs' })) }));
  const look = await routeTurn(f.services, brain.runner, { agent: ida, said, held: true, deadlineMs: ROUTE_WAIT_MS });
  const [call] = brain.calls;
  assert.match(call.prompt, /What the word search found in the agent's knowledge for this/);
  assert.match(call.prompt, / – begins: Larsen Marine Portal: login lars\.aune, password secret:\/\/sec_pw/, 'how it begins, redacted, without opening it');
  assert.deepEqual(Object.keys((call.schema as Schema).properties), ['open'], 'the effort is decided already: the call leaves it out – and it never names a model');
  assert.equal(look?.calls.length, 1, 'an id it was not offered opens nothing');
  const [opened] = look!.calls;
  assert.equal(opened.tool, 'knowledge.open');
  assert.match(String(opened.args.id), /larsen/);
  assert.doesNotMatch(opened.output, /hunter2/);
  assert.match(opened.output, /lars\.aune/, 'the rest of the note stays');
  const again = answering(() => ({}));
  await routeTurn(f.services, again.runner, { agent: ida, said, held: true, deadlineMs: ROUTE_WAIT_MS });
  assert.ok(!again.calls.some((item) => item.prompt.includes(String(opened.args.id))), 'shown once in this version: it stands in the context already');
});

test('hits: no rule of three – the call opens every hit it chooses, and none it leaves', async () => {
  const f = fixture();
  const ida = f.org.add(agent('ag_ida', 'Ida', { role: 'Assistant' }));
  for (const name of ['Nordlicht', 'Fjordblick', 'Seeufer', 'Bergwerk', 'Talgrund']) f.knowledge.memoryWrite({ folder: 'company/partner', title: `Lieferant ${name}`, text: `Lieferant ${name}: Rechnungen nur als PDF, Zahlungsziel 30 Tage.` });
  const brain = answering((call) => ({ open: enumOf(call, 'open').filter((id) => !id.includes('talgrund')).map((id) => ({ id, changes: 'its invoice rule' })) }));
  const look = await routeTurn(f.services, brain.runner, { agent: ida, said: 'Welche Lieferanten wollen Rechnungen nur als PDF?', held: true, deadlineMs: ROUTE_WAIT_MS });
  assert.equal(enumOf(brain.calls[0], 'open').filter((id) => id.includes('lieferant')).length, 5);
  assert.equal(look?.calls.length, 4);
  assert.ok(!look!.calls.some((item) => String(item.args.id).includes('talgrund')));
});

test('context: the biggest whole items are listed – not small ones, messages or the newest finished run – and the call says for each whether its job is done: a done one is condensed with its note and leanText, one it wants kept stays', async () => {
  const t = ledgerSetup();
  try {
    const big = (path: string, extra: string) => `Read ${path} for task_1m7fjar5fn992dvb3.\n${extra}\n${'Rows of the old offer table, now copied into the offer. '.repeat(120)}`;
    const old = t.turn();
    const offer = t.ourCall(old, 'files.read', { path: 'angebote/AN-2026-041.md' }, big('angebote/AN-2026-041.md', 'Total 18,400 EUR.'), 'c_offer');
    const status = t.ourCall(old, 'web.fetch', { url: 'https://status.example.com' }, `Status page: degraded.\n${'Old status lines. '.repeat(300)}`, 'c_status');
    t.ourCall(old, 'tasks.get', { id: 'task_1' }, 'small output', 'c_small');
    t.done(old);
    t.say('Bitte schick das Angebot an Larsen.');
    const newest = t.turn();
    t.ourCall(newest, 'files.read', { path: 'angebote/AN-2026-042.md' }, big('angebote/AN-2026-042.md', 'Total 9,900 EUR.'), 'c_newest');
    t.done(newest);
    await t.journal.settled();
    const rows = t.ledger.items(t.tom.id, 'main');
    const idOf = (callId: string) => t.ledger.view(t.tom.id, 'main').find((item) => item.call?.callId === callId)!.itemId;
    const [offerId, statusId, newestId] = [idOf(offer), idOf(status), idOf('c_newest')];
    assert.ok(rows.find((row) => row.itemId === offerId)!.tokens >= ITEM_TOKENS);
    // On the code before 17.11.2026 the answer was one list of items to condense; a model that listed an item to say "keep" had it condensed (35 measured).
    const brain = answering(() => ({
      items: [
        { id: offerId, done: true, note: 'Offer AN-2026-041 read and copied into the offer; total 18,400 EUR.' },
        { id: statusId, done: false, note: 'The status page stays relevant for the coming report; keep it whole.' },
        { id: newestId, done: true, note: 'the newest run' },
      ],
    }));
    const tidy = await condenseTurn(t.services, brain.runner, { agent: t.tom, said: 'Ist das Angebot raus?', thread: 'main', deadlineMs: LOOK_MS });
    const [call] = brain.calls;
    assert.deepEqual(enumOf(call, 'items').sort(), [offerId, statusId].sort(), 'only big tool work outside the newest finished run');
    assert.deepEqual((call.schema as unknown as { properties: { items: { items: { required: string[] } } } }).properties.items.items.required, ['id', 'done', 'note'], 'one yes or no per item');
    assert.match(call.prompt, /The biggest items still whole in the main AI's context/);
    assert.deepEqual([tidy.condensed, tidy.by], [1, 'fake'], 'an id it was not shown is not marked, an item it calls not done neither; the answering model rides along');
    assert.ok(!('hide' in (call.schema as Schema).properties), 'no way to hide');
    const after = new Map(t.ledger.items(t.tom.id, 'main').map((row) => [row.itemId, row]));
    const condensed = after.get(offerId)!;
    assert.deepEqual([condensed.state, condensed.markedBy, condensed.markReason], ['condensed', 'subconscious', LOOK_REASON]);
    assert.match(condensed.condensed!, /^Offer AN-2026-041 read and copied into the offer; total 18,400 EUR\.\n/);
    assert.match(condensed.condensed!, /task_1m7fjar5fn992dvb3/, 'leanText keeps the values under the note');
    assert.equal(after.get(statusId)!.state, 'keep', 'not done: it stays whole, whatever the note says');
    assert.equal(after.get(newestId)!.state, 'keep');
  } finally { t.cleanup(); }
});

test('service: the turn does not wait for the call that condenses its context; its marks land when it answers', async () => {
  const t = ledgerSetup();
  try {
    const run = t.turn();
    const callId = t.ourCall(run, 'files.read', { path: 'notes.md' }, `Notes for task_1m7fjar5fn992dvb3.\n${'Old meeting notes. '.repeat(250)}`, 'c1');
    t.done(run);
    t.done(t.turn());
    await t.journal.settled();
    const id = t.ledger.view(t.tom.id, 'main').find((item) => item.call?.callId === callId)!.itemId;
    const state = () => t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === id)!.state;
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const seen: Call[] = [];
    const tidies = (call: Call) => 'items' in (call.schema as Schema).properties;
    const runner: StructuredRunner = async (call) => {
      seen.push(call);
      if (!tidies(call)) { // the call the turn waits for: it answers at once
        const effort = { hardest: 'a status', misread: false, decide: false, effort: 'low', why: 'a status' };
        return { text: JSON.stringify(effort), structured: effort, by: 'fake' };
      }
      await gate;
      const structured = { items: [{ id, done: true, note: 'Meeting notes read, nothing open.' }] };
      return { text: JSON.stringify(structured), structured, by: 'fake' };
    };
    const impl = new SubconsciousImpl({ services: () => t.services, runner });
    assert.equal(await impl.beforeTurn({ agent: t.tom, thread: 'main', said: 'Wie weit ist der Bericht für Larsen Marine?' }), undefined);
    const condensing = seen.filter(tidies);
    assert.equal(condensing.length, 1, 'the condensing call runs');
    assert.equal(condensing[0].deadlineMs, LOOK_MS);
    assert.equal(state(), 'keep', 'the turn went on before it answered');
    release();
    await impl.settle();
    assert.equal(state(), 'condensed');
  } finally { t.cleanup(); }
});

test('context: a note naming a value that stands neither in the original nor in what the call was shown is dropped – leanText alone stands in its place; a value from the chat it read stays', async () => {
  const t = ledgerSetup();
  try {
    const run = t.turn();
    const callId = t.ourCall(run, 'files.read', { path: 'report.md' }, `Report for task_1m7fjar5fn992dvb3.\n${'Figures of the quarter. '.repeat(200)}`, 'c1');
    t.done(run);
    t.done(t.turn()); // a newer finished run: the report's run is no longer the newest
    await t.journal.settled();
    const id = t.ledger.view(t.tom.id, 'main').find((item) => item.call?.callId === callId)!.itemId;
    const brain = answering(() => ({ items: [{ id, done: true, note: 'Report done, invoice INV-77123 sent.' }] }));
    await condenseTurn(t.services, brain.runner, { agent: t.tom, said: 'Und weiter?', thread: 'main', deadlineMs: LOOK_MS });
    const row = t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === id)!;
    assert.equal(row.state, 'condensed');
    assert.doesNotMatch(row.condensed!, /INV-77123/);
    assert.match(row.condensed!, /^Output set aside when that piece of work was finished\./);

    // On the code before 17.11.2026 the note was checked against the item alone: a value the call took from the chat it was shown cost the note (418 of 2,472 measured).
    const second = t.turn();
    const otherCall = t.ourCall(second, 'files.read', { path: 'ledger.md' }, `Ledger for task_1m7fjar5fn992dvb3.\n${'Rows of the ledger. '.repeat(200)}`, 'c2');
    t.done(second);
    t.done(t.turn());
    await t.journal.settled();
    const otherId = t.ledger.view(t.tom.id, 'main').find((item) => item.call?.callId === otherCall)!.itemId;
    const shown = answering(() => ({ items: [{ id: otherId, done: true, note: 'Ledger read; the open point is invoice INV-77123.' }] }));
    await condenseTurn(t.services, shown.runner, { agent: t.tom, said: 'Ist die Rechnung INV-77123 jetzt raus?', thread: 'main', deadlineMs: LOOK_MS });
    const kept = t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === otherId)!;
    assert.equal(kept.state, 'condensed');
    assert.match(kept.condensed!, /^Ledger read; the open point is invoice INV-77123\.\n/, 'the value stood in what the call was shown');
  } finally { t.cleanup(); }
});

test('service: the entries the call opened come first in the turn\'s trace; a held turn still gets them', async () => {
  const f = fixture();
  const ida = f.org.add(agent('ag_ida', 'Ida', { role: 'Assistant' }));
  f.knowledge.memoryWrite({ folder: 'company/partner', title: 'Studio Bellavista', text: 'Studio Bellavista: no calls before 10:00, video preferred.' });
  const brain = answering((call) => ({ open: enumOf(call, 'open').map((id) => ({ id, changes: 'no calls before 10:00' })) }));
  const impl = new SubconsciousImpl({ services: () => f.services, runner: brain.runner });
  impl.putBack(ida.id, 'main', { calls: [{ tool: 'knowledge.find', args: { query: 'x' }, output: 'kept' }] });
  const trace = await impl.beforeTurn({ agent: ida, thread: 'main', said: 'Ruf bitte Studio Bellavista an.' });
  assert.deepEqual(trace?.calls.map((item) => item.tool), ['knowledge.open', 'knowledge.find']);
  assert.match(trace!.calls[0].output, /no calls before 10:00/);
});

test('what another effort costs is said only where it costs something: while the cache of its engine lives, on an engine where the effort shapes the prompt, at the price table\'s write price', () => {
  assert.equal(effortKeepsCache('claude', 'claude:claude-opus-5-5'), true);
  assert.equal(effortKeepsCache('claude', 'claude:claude-fable-5-2'), true);
  assert.equal(effortKeepsCache('claude', 'claude:claude-opus-4-7'), false, 'Claude Code: each effort has its own cache on older models');
  assert.equal(effortKeepsCache('codex', 'codex:gpt-6.1-sol'), true);
  assert.equal(effortKeepsCache('codex', 'codex:gpt-5.5'), undefined);
  assert.equal(effortKeepsCache('anthropic', 'anthropic:claude-opus-5-5'), false, 'our own API engine sends the effort at the top of the request');
  assert.equal(effortKeepsCache(undefined, 'codex:gpt-6.1-sol'), undefined);
  const f = fixture();
  const now = f.clock.now();
  Object.assign(f.services, { runs: { list: () => [{ model: 'codex:gpt-6.1-sol', engine: 'codex', effort: 'medium', endedAt: now - 2 * 60_000 }] } });
  assert.equal(effortCost(f.services, f.vid, now), '', 'Codex keeps the cache over an effort change: nothing to weigh');
  const api = (minutes: number) => Object.assign(f.services, { runs: { list: () => [{ model: 'anthropic:claude-opus-5-5', engine: 'anthropic', effort: 'high', endedAt: now - minutes * 60_000 }] } });
  // On the code before 17.11.2026 a cache was called warm for 5 minutes and "maybe" up to an hour, and a re-read was priced "uncached at its own input price".
  // review 17.11.2026: our API engines send cache_control without a ttl – the five-minute cache, not an hour
  api(4);
  const line = effortCost(f.services, f.vid, now);
  assert.match(line, /^What another effort costs now: the main AI's last turn ran 4 min ago on anthropic:claude-opus-5-5 at effort high, and its cache lives five minutes\. On this engine another effort writes the whole context into the cache again – \$[\d.]+ per 1M tokens written against \$[\d.]+ read; the same effort reads it from there\.$/);
  const [written, read] = [...line.matchAll(/\$([\d.]+)/g)].map((match) => Number(match[1]));
  assert.ok(written > read * 10, `${written} written against ${read} read: the price table's own numbers`);
  api(6);
  assert.equal(effortCost(f.services, f.vid, now), '', 'past its five minutes the cache is gone: any effort costs the same');
  assert.deepEqual([cacheLife('claude').text, cacheLife('codex').text, cacheLife('anthropic').text, cacheLife('openai').ms], ['an hour', 'an hour', 'five minutes', 5 * 60_000]);
});

test('final6, 14.11.: an entry the call opened is kept whole in the ledger like a loaded skill; a note the main AI opened itself goes lean', async () => {
  const t = ledgerSetup();
  try {
    const rule = `Studio Bellavista: no calls before 10:00, video preferred.\n${'Background on the studio. '.repeat(40)}`;
    const run = t.turn();
    t.journal.item(run, { kind: 'tool_call', name: 'knowledge.open', data: { callId: 'c1', args: JSON.stringify({ id: 'note:company:partner:studio-bellavista.md' }), summary: 'Subconscious: knowledge.open', subconscious: true }, effectStatus: 'none', idemKey: `${run}:c1` });
    journalResult(t.services, run, 'knowledge.open', 'c1', `${run}:c1:result`, { content: [{ type: 'text', text: rule }] }, []);
    t.ourCall(run, 'knowledge.open', { id: 'note:company:partner:larsen-marine.md' }, `Larsen Marine: prices only in NOK.\n${'More text. '.repeat(120)}`, 'c2');
    t.done(run);
    await t.journal.settled();
    const items = t.ledger.view(t.tom.id, 'main');
    const traced = items.find((item) => item.call?.callId === 'c1')!;
    const own = items.find((item) => item.call?.callId === 'c2')!;
    assert.equal(traced.kind, 'skill');
    assert.match(t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === traced.itemId)!.title, /^Note company:partner:studio-bellavista\.md/);
    assert.equal(own.kind, 'tool');
    const marks = leanMarks(items, { runs: new Set(['run_newer']), pinned: new Set() });
    assert.ok(!marks.some((mark) => mark.itemId === traced.itemId), 'the rule stays in the context after a rebuild');
    assert.ok(marks.some((mark) => mark.itemId === own.itemId && mark.state === 'condensed'), 'the main AI\'s own open is finished work');
  } finally { t.cleanup(); }
});
