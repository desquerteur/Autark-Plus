// Lost <chat> blocks (BEFUND-RUNTIME-JAN §1, 17.11.2026): the shapes seen in workforce.db on 16./17.11. – a block left open
// right before a tool call, a stale open block in the stream buffer, `<chat>` named in prose, files="a;b" – and the line a
// running turn gets at once when a mid-turn block did not arrive. Each case failed before the fix (repro R1–R4 in
// workspace\jan-chat-delivery-20261117\repro).
// Owns: these assertions only. Never: real engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatOutbox, chatBlocks, notMemberNote } from '../../../src/runtime/agents/chat-out.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { agent, harness } from '../chat/harness.ts';

function room() {
  const h = harness();
  h.org.add(agent('ag_lena', 'Lena'));
  h.org.add(agent('ag_noah', 'Noah'));
  const konrad = h.chats.create({ title: 'Konrad', agentIds: ['ag_lena'], createdBy: HUMAN_ID });
  const noah = h.chats.create({ title: 'Noah', agentIds: ['ag_lena'], createdBy: HUMAN_ID });
  const foreign = h.chats.create({ title: 'Other', agentIds: ['ag_noah'], createdBy: HUMAN_ID });
  h.services.runs = { item: () => undefined } as never;
  const mine = (id: string) => h.chats.messages(id, { limit: 50 }).filter((m) => m.authorId === 'ag_lena').map((m) => m.body);
  return { h, konrad, noah, foreign, mine };
}

// The Claude stream feeds one mid-turn text twice: its deltas (out.text) and, at the tool call, the whole text (out.segment).
function midTurn(out: ChatOutbox, text: string) {
  for (let i = 0; i < text.length; i += 7) out.text(text.slice(i, i + 7));
  out.segment(text);
}

test('R1 (Lena 16.11 09:57, Theo 17.11 19:24): a block left open right before a tool call is posted at the end of its text', async () => {
  const { h, konrad, mine } = room();
  const out = new ChatOutbox(h.services, { agentId: 'ag_lena', runId: 'run_r1' });
  midTurn(out, `<chat to="${konrad.id}" push>Zwischenstand nach Schritt 2 und 3, vor dem Push. Ich warte auf deine Freigabe.`);
  out.segment('Fertig, der Rest steht im Task.', true);
  await out.done();
  assert.deepEqual(mine(konrad.id), ['Zwischenstand nach Schritt 2 und 3, vor dem Push. Ich warte auf deine Freigabe.']);
});

test('R2: an open block never takes the next block\'s closing tag – each chat gets exactly its own text', async () => {
  const { h, konrad, noah, mine } = room();
  const out = new ChatOutbox(h.services, { agentId: 'ag_lena', runId: 'run_r2' });
  midTurn(out, `<chat to="${konrad.id}" push>Push erledigt, warte auf Freigabe.`);
  midTurn(out, `Weiter.\n<chat to="${noah.id}">Noah, der Key ist rotiert.</chat>`);
  await out.done();
  assert.deepEqual(mine(konrad.id), ['Push erledigt, warte auf Freigabe.']);
  assert.deepEqual(mine(noah.id), ['Noah, der Key ist rotiert.']);
});

test('R2b (Codex): deltas of a sampling that never completed do not glue onto the next attempt\'s block', async () => {
  const { h, konrad, noah, mine } = room();
  const out = new ChatOutbox(h.services, { agentId: 'ag_lena', runId: 'run_r2b' });
  out.text(`<chat to="${konrad.id}">Halber Satz aus einer verworfenen`); // dropped for a steered line: no commentary follows
  out.text(`\n<chat to="${noah.id}">Noah, `); // the new sampling, same attempt, streams on
  out.text('der Key ist rotiert.</chat>');
  await out.done();
  assert.deepEqual(mine(konrad.id), [], 'the dropped text never posts');
  assert.deepEqual(mine(noah.id), ['Noah, der Key ist rotiert.']);
  out.attach(undefined); // a new attempt starts with an empty buffer
  out.text(`<chat to="${konrad.id}">Rest`);
  out.attach(undefined);
  out.text(' danach.</chat>');
  await out.done();
  assert.deepEqual(mine(konrad.id), []);
});

test('R3 (Lena 17.11 15:11): `<chat>` named in prose is no opener – the real block after it arrives', async () => {
  const { h, konrad, mine } = room();
  const out = new ChatOutbox(h.services, { agentId: 'ag_lena', runId: 'run_r3' });
  midTurn(out, `In dieser Sitzung kommen \`<chat>\`-Blöcke nicht an, auch <chat> ohne Adresse.\n<chat to="${konrad.id}">Konrad, Paket 1 ist live.</chat>`);
  await out.done();
  assert.deepEqual(mine(konrad.id), ['Konrad, Paket 1 ist live.']);
  const quoted = chatBlocks('Schreib so: `<chat to="ch_x">Text</chat>` und fertig.', { final: true });
  assert.deepEqual(quoted.blocks, [], 'a block shown as an example in backticks is prose');
});

test('R4 (Ben 17.11 13:56, Theo 17.11 19:42): files= splits at ; and line breaks as well as commas', () => {
  const { blocks } = chatBlocks('<chat to="ch_x" files="C:\\w\\a.md;C:\\w\\b.md, C:\\w\\c.png">Hier.</chat>');
  assert.deepEqual(blocks[0].files, ['C:\\w\\a.md', 'C:\\w\\b.md', 'C:\\w\\c.png']);
});

test('a whole text with two blocks and no closing tags: each ends where the next begins', () => {
  const { blocks, rest } = chatBlocks('Vorab.\n<chat to="ch_a">Erstens.\n<chat to="ch_b" quiet>Zweitens.', { final: true });
  assert.deepEqual(blocks.map((block) => [block.to[0], block.level, block.body]), [['ch_a', 'normal', 'Erstens.'], ['ch_b', 'quiet', 'Zweitens.']]);
  assert.equal(rest, 'Vorab.');
});

test('a mid-turn block that did not arrive is told to the running turn at once; the final text\'s is left to the repair note', async () => {
  const { h, konrad, foreign, mine } = room();
  const told: string[] = [];
  const out = new ChatOutbox(h.services, { agentId: 'ag_lena', runId: 'run_tell' });
  out.attach((line) => told.push(line));
  midTurn(out, `<chat to="${foreign.id}">Hallo</chat>`);
  (h.services as { paths?: unknown }).paths ??= {}; // the harness has no data folder
  midTurn(out, `<chat to="${konrad.id}" files="https://example.org/bericht.md">Bericht anbei.</chat>`);
  await out.done();
  assert.equal(told.length, 2, told.join(' | '));
  assert.equal(told[0], `[chat delivery] ${notMemberNote(foreign.id)}`);
  assert.match(told[1], /^\[chat delivery\] Files of my block to .*without them\.$/);
  assert.deepEqual(mine(konrad.id), ['Bericht anbei.'], 'the text itself went out');
  out.segment(`<chat to="${foreign.id}">Nochmal am Ende</chat>`, true);
  await out.done();
  assert.equal(told.length, 2, 'the final text is not steered – the turn is over');
  assert.equal(out.notes.length, 3, 'every miss stays a repair note for the next turn');
});
