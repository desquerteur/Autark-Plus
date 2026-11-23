// B-080 (live 07.11.2026: a cut at 1,500 characters hid 35% of the owner's words from the subconscious; the 12,000
// window of a step cut the head of the exchange): what a call is told about the chat (subconscious/exchange.ts askContext)
// stands whole – every line of the person's –, the window still bounds older agent lines, a step's prompt carries the whole
// context (flow.ts), and the same system text counts once against what a run sends.
// Owns: these assertions only. Never: a model or a real chat.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { askContext } from '../../../src/runtime/subconscious/exchange.ts';
import { runFlow, type FlowInput } from '../../../src/runtime/subconscious/flow.ts';
import type { StructuredRunner } from '../../../src/runtime/decision/types.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { Message } from '../../../src/shared/model/chat.ts';

const AGENT = { id: 'ag_a', name: 'Mara' } as FlowInput['agent'];

const person = (seq: number, body: string) => ({ seq, kind: 'text', authorId: 'human', authorKind: 'human', body }) as unknown as Message;
const agentLine = (seq: number, body: string) => ({ seq, kind: 'text', authorId: 'ag_a', authorKind: 'agent', body }) as unknown as Message;

function chat(messages: Message[]): RuntimeServices {
  return {
    chats: { messages: (_id: string, options: { beforeSeq?: number; limit?: number } = {}) => messages.filter((message) => options.beforeSeq === undefined || message.seq < options.beforeSeq).slice(-(options.limit ?? 200)) },
    org: { get: (id: string) => (id === 'ag_a' ? { name: 'Mara' } : undefined) },
    secrets: { redact: (text: string) => text.replace(/hunter2/g, 'secret://pw') },
  } as unknown as RuntimeServices;
}

test('a long line of the person\'s stands whole in what goes along with a call, redacted', () => {
  const dictation = `${'Für die neue Transkription will ich eigene Wörter und je Abschnitt eine Sicherheit in Prozent. '.repeat(55)}Am Ende zeigst du mir drei Beispiele, Passwort hunter2 bleibt draußen.`;
  assert.ok(dictation.length > 5000, String(dictation.length));
  const services = chat([agentLine(1, 'Soll ich die Transkription umbauen?'), person(2, dictation), agentLine(3, 'Mache ich.')]);
  const text = askContext(services, { agentId: 'ag_a', conversationId: 'ch_1' });
  assert.ok(text.includes('Am Ende zeigst du mir drei Beispiele, Passwort secret://pw bleibt draußen.'), 'its last sentence, redacted');
  assert.doesNotMatch(text, / …$|…\n/m, 'no line is cut');
});

test('the window bounds older agent lines, never the person\'s: an older person line outside 6,000 characters is still there', () => {
  const services = chat([
    person(1, `Erste Bitte: die Rechnungen an Müller bis Freitag, ${'mit Mahnung und Skonto. '.repeat(8)}`),
    agentLine(2, `Alte Antwort A ${'a'.repeat(2500)}`),
    agentLine(3, `Alte Antwort B ${'b'.repeat(2500)}`),
    person(4, 'Zweite Bitte: auch an Huber.'),
    agentLine(5, `Neue Antwort C ${'c'.repeat(2900)}`),
    agentLine(6, `Neueste Antwort D ${'d'.repeat(2900)}`),
  ]); // C, D and the second request fill all but about 110 of the 6,000 characters: the first request lies past the window
  const text = askContext(services, { agentId: 'ag_a', conversationId: 'ch_1' });
  assert.ok(text.includes('The person: Erste Bitte: die Rechnungen an Müller bis Freitag, mit Mahnung'), 'the oldest person line stands');
  assert.ok(text.includes('The person: Zweite Bitte: auch an Huber.'));
  assert.ok(text.includes('Neueste Antwort D') && text.includes('Neue Antwort C'), 'the newest agent lines stand');
  assert.ok(!text.includes('Alte Antwort A') && !text.includes('Alte Antwort B'), 'older agent lines past the window are left out');
  assert.ok(text.indexOf('Erste Bitte') < text.indexOf('Zweite Bitte') && text.indexOf('Zweite Bitte') < text.indexOf('Neue Antwort C'), 'in the chat\'s order');
});

test('a step carries the whole context – its first line too – and the same system text counts once against what a run sends', async () => {
  const prompts: string[] = [];
  let step = 0;
  const runner: StructuredRunner = async (input) => {
    prompts.push(input.prompt);
    step++;
    const structured = { why: 'x', tool: 'memory.browse', args: JSON.stringify({ folder: `f${step}` }) };
    return { text: '', structured, by: 'fake' };
  };
  const services = {
    clock: { now: () => Date.parse('2026-11-08T10:00:00Z') },
    settings: { get: () => ({ profile: { name: 'Alex' } }) },
    log: { debug() {}, warn() {} },
    prompts: { text: () => `${'I keep what holds up. '.repeat(3000)}\n{{tools}}` }, // about 66,000 characters
    paths: { workspace: tmpdir() },
    dispatcher: { activity: () => [] },
    knowledge: { memoryBrowse: () => ({ path: 'company', folders: [], files: [] }), memoryRead: () => undefined },
  } as unknown as RuntimeServices;
  const context = `The person: Erste Zeile, die zählt.\n${'Weiterer Text des Gesprächs. '.repeat(550)}`;
  assert.ok(context.length > 15_000, String(context.length));
  const result = await runFlow(services, runner, { agent: AGENT, conversationId: 'ch_1', thread: 'ch_1', context, maxSteps: 8 });
  assert.ok(prompts[0].includes('What happened:\nThe person: Erste Zeile, die zählt.'), 'the head of the exchange stands');
  assert.equal(result.end, 'steps', 'eight steps with a 66,000-character system text stay within the run\'s 400,000 characters');
  assert.equal(result.steps, 8);
});
