// Unterbewusstsein v2 (15.11.2026): what the subconscious reads and does before a turn besides the route (subconscious/look.ts through
// route-turn.ts routeTurn, the call the turn waits for, and condenseTurn, the call beside it nobody waits for). The word search's hits for what wakes the turn stand in its prompt and its answer's `open` lists them; each
// chosen one reaches the turn as the main AI's own knowledge.open – redacted, as many as the call chooses (no rule of three), never one
// it was not offered, and not again in the same version. The biggest items still whole in the agent's context stand there too – tool,
// file and skill items of at least ITEM_TOKENS, not of the newest finished run, never a message; what it condenses keeps its note and
// leanText's values (a note naming a value the original lacks is dropped), marked by the subconscious; the call has no way to hide
// (measured 15.11.: hiding lost the values). A request that holds the turn leaves out the route, not the rest; the service hands the opened entries to the turn
// first. The switch line says per engine and model whether another effort keeps the cache. And (final6, 14.11.) the ledger keeps an
// entry the call opened whole like a loaded skill, while one the main AI opened itself goes lean.
// Owns: these assertions only. Never: real models, engines or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { fixture } from '../context/fixture.ts';
import { ledgerSetup } from '../context/ledger-fixture.ts';
import { condenseTurn, routeTurn, effortKeepsCache, switchLine } from '../../../src/runtime/subconscious/route-turn.ts';
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
  assert.ok(!('model' in (call.schema as Schema).properties), 'a request holds the route: the call leaves it out');
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

test('context: the biggest whole items are listed – not small ones, messages or the newest finished run – and the call condenses with its note and leanText', async () => {
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
    const brain = answering(() => ({
      condense: [{ id: offerId, note: 'Offer AN-2026-041 read and copied into the offer; total 18,400 EUR.' }, { id: newestId, note: 'the newest run' }],
    }));
    const condensedCount = await condenseTurn(t.services, brain.runner, { agent: t.tom, said: 'Ist das Angebot raus?', thread: 'main', deadlineMs: LOOK_MS });
    const [call] = brain.calls;
    assert.deepEqual(enumOf(call, 'condense').sort(), [offerId, statusId].sort(), 'only big tool work outside the newest finished run');
    assert.match(call.prompt, /The biggest items still whole in the main AI's context/);
    assert.equal(condensedCount, 1, 'an id it was not shown is not marked');
    assert.ok(!('hide' in (call.schema as Schema).properties), 'no way to hide');
    const after = new Map(t.ledger.items(t.tom.id, 'main').map((row) => [row.itemId, row]));
    const condensed = after.get(offerId)!;
    assert.deepEqual([condensed.state, condensed.markedBy, condensed.markReason], ['condensed', 'subconscious', LOOK_REASON]);
    assert.match(condensed.condensed!, /^Offer AN-2026-041 read and copied into the offer; total 18,400 EUR\.\n/);
    assert.match(condensed.condensed!, /task_1m7fjar5fn992dvb3/, 'leanText keeps the values under the note');
    assert.equal(after.get(statusId)!.state, 'keep', 'what the call leaves stays for code');
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
    const runner: StructuredRunner = async (call) => {
      seen.push(call);
      await gate;
      const structured = { condense: [{ id, note: 'Meeting notes read, nothing open.' }] };
      return { text: JSON.stringify(structured), structured, by: 'fake' };
    };
    const impl = new SubconsciousImpl({ services: () => t.services, runner });
    assert.equal(await impl.beforeTurn({ agent: t.tom, thread: 'main', said: 'Wie weit ist der Bericht für Larsen Marine?' }), undefined);
    assert.equal(seen.length, 1, 'the condensing call runs');
    assert.equal(seen[0].deadlineMs, LOOK_MS);
    assert.equal(state(), 'keep', 'the turn went on before it answered');
    release();
    await impl.settle();
    assert.equal(state(), 'condensed');
  } finally { t.cleanup(); }
});

test('context: a note naming a value the original lacks is dropped – leanText alone stands in its place', async () => {
  const t = ledgerSetup();
  try {
    const run = t.turn();
    const callId = t.ourCall(run, 'files.read', { path: 'report.md' }, `Report for task_1m7fjar5fn992dvb3.\n${'Figures of the quarter. '.repeat(200)}`, 'c1');
    t.done(run);
    t.done(t.turn()); // a newer finished run: the report's run is no longer the newest
    await t.journal.settled();
    const id = t.ledger.view(t.tom.id, 'main').find((item) => item.call?.callId === callId)!.itemId;
    const brain = answering(() => ({ condense: [{ id, note: 'Report done, invoice INV-77123 sent.' }] }));
    await condenseTurn(t.services, brain.runner, { agent: t.tom, said: 'Und weiter?', thread: 'main', deadlineMs: LOOK_MS });
    const row = t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === id)!;
    assert.equal(row.state, 'condensed');
    assert.doesNotMatch(row.condensed!, /INV-77123/);
    assert.match(row.condensed!, /^Output set aside when that piece of work was finished\./);
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

test('the switch line says whether another effort keeps the cache on the engine and model the agent ran on', () => {
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
  assert.match(switchLine(f.services, f.vid, now), /is still cached on it\. Staying keeps that cache; another model first reads it once uncached at its own input price\. Another effort on GPT-6\.1 Sol keeps it\.$/);
  Object.assign(f.services, { runs: { list: () => [{ model: 'anthropic:claude-opus-5-5', engine: 'anthropic', effort: 'high', endedAt: now - 2 * 60_000 }] } });
  assert.match(switchLine(f.services, f.vid, now), /Another effort on anthropic:claude-opus-5-5 reads it uncached too, like another model\.$/);
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
