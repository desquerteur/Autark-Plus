// B-078 D14: the subconscious's own thoughts (subconscious/thoughts.ts): thought.keep appends dated keyword lines to the
// memory file agents/<id>/thoughts.md, a thought is kept once, a secret value stays out, the newest lines are what a run
// opens with; the temperature a runner gets reaches the engine turn (decision/engine-runner.ts). B-080: a thought and the
// person's agreements stand whole (live 08.11.2026: 6 of 7 thoughts ended mid-word, agreements past 12,000 were cut) – since v1
// (14.11.2026) in the agent's card, which stays short beside them.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCard, recentThoughts, thoughtTool, thoughtsPath } from '../../../src/runtime/subconscious/thoughts.ts';
import { fixture } from '../context/fixture.ts';
import { FLOW_TOOLS, type FlowRun } from '../../../src/runtime/subconscious/tools.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { MemoryWriteInput } from '../../../src/shared/model/memory.ts';
import { createEngineRunner } from '../../../src/runtime/decision/engine-runner.ts';

function memory() {
  const files = new Map<string, string>();
  const writes: MemoryWriteInput[] = [];
  const services = {
    clock: { now: () => Date.UTC(2026, 10, 6, 12) },
    settings: { get: () => ({ profile: { timezone: 'UTC' } }) },
    secrets: { redact: (text: string) => text.replace(/hunter2/g, 'secret://pw') },
    knowledge: {
      memoryRead: (file: string) => (files.has(file) ? { path: file, title: 'Thoughts', text: files.get(file)!, updated: 0 } : undefined),
      memoryWrite: (input: MemoryWriteInput) => { writes.push(input); files.set(input.path!, input.text); return { path: input.path!, outcome: 'updated' as const }; },
    },
  } as unknown as RuntimeServices;
  const run = { services, agent: { id: 'ag_v', name: 'Vic' } } as unknown as FlowRun;
  return { services, run, files, writes };
}

test('thought.keep: dated keyword lines in agents/<id>/thoughts.md, each thought once, no secret value; the newest open a run', async () => {
  const t = memory();
  assert.ok(FLOW_TOOLS.some((tool) => tool.name === 'thought.keep'), 'a flow tool of the subconscious');
  assert.equal(await thoughtTool.run({ text: 'invoices late again\n- Vic prefers short cuts' }, t.run), 'kept: 2');
  assert.equal(t.writes[0].path, thoughtsPath('ag_v'));
  assert.equal(t.writes[0].path, 'agents/ag_v/thoughts.md');
  assert.equal(t.files.get('agents/ag_v/thoughts.md'), '- 2026-11-06: invoices late again\n- 2026-11-06: Vic prefers short cuts');
  assert.equal(await thoughtTool.run({ text: 'invoices late again' }, t.run), 'kept already');
  assert.equal(await thoughtTool.run({ text: 'password is hunter2' }, t.run), 'kept: 1');
  assert.ok(!t.files.get('agents/ag_v/thoughts.md')!.includes('hunter2'));
  assert.equal(await thoughtTool.run({}, t.run), 'thought.keep needs a text.');
  for (let index = 0; index < 20; index++) await thoughtTool.run({ text: `thought ${index}` }, t.run);
  const recent = recentThoughts(t.services, 'ag_v').split('\n');
  assert.equal(recent.length, 12);
  assert.equal(recent.at(-1), '- 2026-11-06: thought 19');
});

test('B-080: a long thought is kept whole, never cut mid-word; up to five per call', async () => {
  const t = memory();
  const long = `Nur Kontaktdaten aus dem Registrierungsformular verwenden, ${'Status-Klärung der Journale und der Rechnungen '.repeat(6)}Ende.`;
  assert.ok(long.length > 300, String(long.length));
  assert.equal(await thoughtTool.run({ text: long }, t.run), 'kept: 1');
  assert.equal(t.files.get('agents/ag_v/thoughts.md'), `- 2026-11-06: ${long.replace(/\s+/g, ' ').trim()}`);
  assert.equal(await thoughtTool.run({ text: 'a\nb\nc\nd\ne\nf\ng' }, t.run), 'kept: 5');
});

test('v1: the card carries "What I have here" whole – past 12,000 characters too – and stays under 2,000 characters beside it; its role text stays out', () => {
  const f = fixture();
  const have = Array.from({ length: 190 }, (_, index) => `- Absprache ${index}: Rechnungen gehen am 3. raus, Angebote auf Englisch.`).join('\n');
  const agent = { ...f.vid, instructions: `## My role\n${'Ich schneide Videos für den Kanal. '.repeat(400)}\n\n## What I have here\n${have}\n- Stanislaus 07.11.: Ihr sollt jetzt autonom versenden.` };
  const text = agentCard(f.services, agent, { mode: 'video' });
  assert.ok(have.length > 12_000, String(have.length));
  assert.ok(text.includes('- Stanislaus 07.11.: Ihr sollt jetzt autonom versenden.'), 'the last line of "What I have here" stands');
  assert.doesNotMatch(text, /\[… cut\]|Ich schneide Videos/);
  assert.ok(text.length - have.length < 2000, String(text.length - have.length));
  assert.equal(agentCard(f.services, { ...f.vid, instructions: 'Password hunter2 is not for chats.' }, { mode: 'video' }), '# The agent I work beside\nVic – Video editor, team Marketing; it works in the mode Video.', 'without "What I have here" and without a run: who it is, nothing else');
});

test('a runner\'s temperature reaches the engine turn, clamped; without one the turn carries none', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const account = { id: 'acc', provider: 'openai' };
  const runner = createEngineRunner({
    engines: { get: () => ({ run: async (input: Record<string, unknown>) => { seen.push(input); return { stop: 'done', text: 'ok' }; } }) },
    router: { route: async () => ({ modelId: 'm', engine: 'compatible', accountId: 'acc', effort: 'low', category: 'chat', reason: '', by: 'rules', alternatives: [] }) },
    accounts: { get: () => account, markLimited() {}, markUnavailable() {}, updateLimits() {} },
    catalog: { get: () => ({ id: 'm', model: 'm', efforts: [] }) },
    paths: { temp: (await import('node:os')).tmpdir() },
    clock: { now: () => 0 },
  } as unknown as Parameters<typeof createEngineRunner>[0]);
  await runner({ purpose: 'test', system: 's', prompt: 'p', temperature: 3 });
  await runner({ purpose: 'test', system: 's', prompt: 'p' });
  assert.equal(seen[0].temperature, 2);
  assert.equal('temperature' in seen[1], false);
});
