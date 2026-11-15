// The main AI's own call (tools/builtin/subconscious.ts → SubconsciousImpl.ask): ask and context reach the flow, the answer
// is the tool's output, the spec stays short; the tool's mode reaches the run's skill list, and the routing call before a turn
// (v1, route-turn.ts) runs no loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { RESOURCES, fixture, model } from '../context/fixture.ts';
import { ROUTE_SYSTEM } from '../../../src/runtime/subconscious/route-turn.ts';
import { PromptTemplates } from '../../../src/runtime/context/templates.ts';
import { SubconsciousImpl } from '../../../src/runtime/subconscious/service.ts';
import { subconsciousTools, SUBCONSCIOUS_TOOL } from '../../../src/runtime/tools/builtin/subconscious.ts';
import { BASE_CORE } from '../../../src/runtime/tools/core-sets.ts';
import type { StructuredRunner } from '../../../src/runtime/decision/types.ts';
import type { ToolContext, ToolOutput } from '../../../src/runtime/tools/types.ts';
import type { ModeInfo } from '../../../src/shared/model/knowledge.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import { routable } from './routable.ts';

type Call = Parameters<StructuredRunner>[0];
const tool = subconsciousTools[0];
const textOf = (out: ToolOutput) => (out.content[0] as { text: string }).text;

function setup(steps: Array<{ tool: string; args?: Record<string, unknown> }>) {
  const f = fixture();
  f.services.prompts = new PromptTemplates(() => path.join(RESOURCES, 'prompts'));
  const calls: Call[] = [];
  const runner: StructuredRunner = async (call) => {
    calls.push(call);
    const next = steps.shift() ?? { tool: 'done' };
    const structured = { tool: next.tool, args: JSON.stringify(next.args ?? {}) };
    return { text: '', structured, by: 'fake' };
  };
  f.services.subconscious = new SubconsciousImpl({ services: () => f.services, runner });
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: 'human' });
  const ctx = (mode = 'general'): ToolContext => ({ agent: f.vid, runId: 'run_1', conversationId: chat.id, mode, services: f.services, signal: new AbortController().signal, status: () => {} });
  /** The mode keys the skill list of each run was built for (flow.ts skillList → skills.indexFor). */
  const modes: string[] = [];
  Object.assign(f.services.skills, { indexFor: (_agent: Agent, mode: ModeInfo) => { modes.push(mode.key); return []; } });
  return { f, calls, chat, ctx, modes };
}

test('the tool passes ask and the chat that goes along; the answer comes back as its output', async () => {
  const t = setup([{ tool: 'done', args: { answer: 'Die Rechnungen gehen am 3. raus.' } }]);
  t.f.chats.send({ conversationId: t.chat.id, authorId: 'human', body: 'Wir reden gerade über Rechnungen.' });
  const out = await tool.run({ ask: 'Wann gehen die Rechnungen raus?' }, t.ctx());
  assert.equal(out.isError, undefined);
  assert.equal(textOf(out), 'Die Rechnungen gehen am 3. raus.\n\n(This answer used no tool, only the text it was given.)');
  const prompt = t.calls[0].prompt;
  assert.ok(prompt.includes('The main AI asks: Wann gehen die Rechnungen raus?'), prompt);
  assert.ok(prompt.includes('Wir reden gerade über Rechnungen.'), 'recent is the default');
});

test('context none sends no chat; context chat sends the summary and more lines', async () => {
  const none = setup([]);
  none.f.chats.send({ conversationId: none.chat.id, authorId: 'human', body: 'Geheimer Plan Nummer eins.' });
  await tool.run({ ask: 'Thema Rechnungen', context: 'none' }, none.ctx());
  assert.ok(!none.calls[0].prompt.includes('Geheimer Plan'));

  const whole = setup([]);
  for (let i = 0; i < 20; i++) whole.f.chats.send({ conversationId: whole.chat.id, authorId: 'human', body: `Zeile ${i} im Chat.` });
  await tool.run({ ask: 'Fasse zusammen', context: 'recent' }, whole.ctx());
  assert.ok(!whole.calls[0].prompt.includes('Zeile 2 im Chat.'), 'recent: only the newest lines');
  await tool.run({ ask: 'Fasse zusammen', context: 'chat' }, whole.ctx());
  assert.ok(whole.calls.at(-1)!.prompt.includes('Zeile 2 im Chat.'), 'chat: the whole chat within its cap');
});

test('what it told and picked is part of the answer; with nothing it says so plainly', async () => {
  const told = setup([{ tool: 'agent.tell', args: { text: 'Frau Berger bekommt die Mahnungen.' } }]);
  assert.equal(textOf(await tool.run({ ask: 'Wer bekommt die Mahnungen?' }, told.ctx())), 'Frau Berger bekommt die Mahnungen.');
  const empty = setup([]);
  assert.equal(textOf(await tool.run({ ask: 'Wer bekommt die Mahnungen?' }, empty.ctx())), 'The subconscious has nothing to add.');
});

test('the turn\'s mode reaches the run\'s card: the tool\'s (a split turn\'s); neither the run nor the routing call before a turn opens a skill list', async () => {
  const asked = setup([]);
  await tool.run({ ask: 'Welcher Schnitt passt?' }, asked.ctx('video'));
  assert.match(asked.calls[0].system, /; it works in the mode Video\./, `the tool's mode, not the agent's own (${asked.f.vid.mode})`);
  assert.deepEqual(asked.modes, [], 'v1: the card in place of the main AI\'s prompt builds no skill list');

  const impl = asked.f.services.subconscious as SubconsciousImpl;
  asked.calls.length = 0;
  routable(asked.f.services, [model('codex:luna', 'small', 'Luna')]); // one connected work model the router runs
  await impl.beforeTurn({ agent: asked.f.vid, thread: 'main', conversationId: asked.chat.id, mode: 'video', said: 'Mein Steuerberater heißt Jonas Weber.' });
  assert.equal(asked.calls.length, 1, 'one routing call');
  assert.equal(asked.calls[0].system, ROUTE_SYSTEM);
  assert.ok(asked.calls[0].prompt.includes("The person's new message:\nMein Steuerberater heißt Jonas Weber."), asked.calls[0].prompt);
  assert.deepEqual(asked.modes, [], 'no loop: no skill list is built');
});

test('it is a core tool in every mode with a short spec', () => {
  assert.equal(tool.name, SUBCONSCIOUS_TOOL);
  assert.ok(Object.hasOwn(BASE_CORE, SUBCONSCIOUS_TOOL));
  assert.equal(tool.anyMode, true);
  const { name, description, inputSchema } = tool;
  const chars = JSON.stringify({ name, description, inputSchema }).length;
  assert.ok(chars / 4 <= 110, `spec: ${chars} characters, about ${Math.round(chars / 4)} tokens`);
});

test('live 01.11.: an asked run may not end with an empty done: the brain is told to answer or say so', async () => {
  const f = fixture();
  f.services.prompts = new PromptTemplates(() => path.join(RESOURCES, 'prompts'));
  const prompts: string[] = [];
  const replies = [{ tool: 'done', args: '{}' }, { tool: 'done', args: '{"answer":"Nichts gefunden."}' }];
  const runner: StructuredRunner = async ({ prompt }) => { prompts.push(prompt); return { text: '', structured: replies.shift(), by: 'fake' }; };
  const impl = new SubconsciousImpl({ services: () => f.services, runner });
  assert.equal(await impl.ask({ agent: f.vid, ask: 'Was wissen wir über die Rechnungen?', context: 'none' }), 'Nichts gefunden.\n\n(This answer used no tool, only the text it was given.)');
  assert.match(prompts[1], /waits for my answer/);
});
